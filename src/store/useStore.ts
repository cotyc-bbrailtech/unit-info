import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { BASE_FLEET, defaultSubs } from '../lib/fleet'
import { recordKey } from '../lib/records'
import {
  blankPart,
  EMPTY_OVERRIDES,
  migrateOverrides,
  nextPartId,
  normaliseSubCode,
  partId,
  partsFor,
  subCodeError,
  subNameError,
  withIds,
} from '../lib/overrides'
import type { Overrides, SubOverride, UnitOverride } from '../lib/overrides'
import type {
  Line,
  PartSpec,
  RecordEntry,
  Records,
  SerialSlot,
  SubCode,
  SubKind,
  Unit,
} from '../lib/types'

export type View = 'fleet' | 'machine' | 'phone' | 'vue' | 'subs'

/**
 * Not a security control. The app is a static public bundle with no server, so
 * this PIN ships in the JavaScript and anyone can read it. It exists to stop an
 * auditor changing the master parts list by accident, nothing more — see README.
 */
export const ADMIN_PIN = '4471'

/**
 * Bumped when the persisted shape changes. v1 folded the old `overrides.parts`
 * map into `overrides.subs`, so a subassembly's name, kind and parts live in
 * one record. Records and the sync queue are untouched by that migration.
 */
export const PERSIST_VERSION = 1

interface State {
  view: View
  unitId: string
  openGroups: Partial<Record<SubCode, boolean>>
  sel: string | null
  records: Records
  step: number
  pending: string[]
  lastSyncAt: number | null
  requirePhoto: boolean

  /** Admin edit mode. Deliberately not persisted — a reload re-locks. */
  admin: boolean
  overrides: Overrides

  setView: (view: View) => void
  openUnit: (unitId: string) => void
  toggleGroup: (code: SubCode, firstSub: SubCode | undefined) => void
  select: (lineKey: string) => void
  setRecord: (unit: Unit, line: Line, patch: RecordEntry) => void
  setStep: (step: number) => void
  sync: () => void
  setRequirePhoto: (on: boolean) => void

  unlock: (pin: string) => boolean
  lock: () => void
  editPart: (code: SubCode, id: string, patch: Partial<PartSpec>) => void
  addPart: (code: SubCode) => string
  removePart: (code: SubCode, id: string) => void
  fitSub: (unitId: string, code: SubCode) => void
  strikeSub: (unitId: string, code: SubCode) => void
  editUnit: (unitId: string, patch: { vin?: string; serials?: Partial<Record<SerialSlot, string>> }) => void
  /** A revision for this machine alone. Empty clears it back to the master part. */
  setUnitRev: (unitId: string, lineKey: string, rev: string) => void
  resetOverrides: () => void
  applyMasterData: (overrides: Overrides) => void

  createSub: (code: SubCode, name: string, kind: SubKind) => boolean
  renameSub: (code: SubCode, name: string) => void
  setSubKind: (code: SubCode, kind: SubKind) => void
  /** Drops a built-in's override so it tracks src/data/subassemblies.ts again. */
  revertSub: (code: SubCode) => void
  movePart: (code: SubCode, id: string, delta: -1 | 1) => void
  setVariant: (code: SubCode, id: string, rev: string, variant: string | null) => void
}

function withSub(o: Overrides, code: SubCode, fn: (s: SubOverride) => SubOverride): Overrides {
  return { ...o, subs: { ...o.subs, [code]: fn(o.subs?.[code] ?? {}) } }
}

/** Rewrites one subassembly's parts list, materialising ids on first edit. */
function withParts(
  o: Overrides,
  code: SubCode,
  fn: (parts: PartSpec[]) => PartSpec[],
): Overrides {
  return withSub(o, code, (s) => ({ ...s, parts: fn(s.parts ?? withIds(partsFor(code, o))) }))
}

/**
 * Merges a patch into one machine's override, dropping keys that were cleared
 * and the machine's entry itself once nothing is left. Without the prune an
 * emptied override lingers as `{}` and the machine still reads as edited.
 */
function withUnit(o: Overrides, unitId: string, patch: Partial<UnitOverride>): Overrides {
  const merged = { ...o.units[unitId], ...patch } as Record<string, unknown>
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k]

  const units = { ...o.units }
  if (Object.keys(merged).length) units[unitId] = merged as UnitOverride
  else delete units[unitId]
  return { ...o, units }
}

/** What survives a reload. `admin` is absent on purpose — a reload re-locks. */
export const persistedFields = (s: State) => ({
  records: s.records,
  pending: s.pending,
  lastSyncAt: s.lastSyncAt,
  unitId: s.unitId,
  step: s.step,
  requirePhoto: s.requirePhoto,
  overrides: s.overrides,
})

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      view: 'fleet',
      unitId: BASE_FLEET[0].id,
      openGroups: {},
      sel: null,
      records: {},
      step: 0,
      pending: [],
      lastSyncAt: null,
      requirePhoto: true,
      admin: false,
      overrides: EMPTY_OVERRIDES,

      setView: (view) => set({ view }),
      openUnit: (unitId) => set({ view: 'machine', unitId, sel: null, openGroups: {}, step: 0 }),
      toggleGroup: (code, firstSub) =>
        set((s) => ({
          openGroups: { ...s.openGroups, [code]: !isGroupOpen(s.openGroups, code, firstSub) },
        })),
      select: (sel) => set({ sel }),
      setRecord: (unit, line, patch) =>
        set((s) => {
          const key = recordKey(unit.id, line.key)
          return {
            records: { ...s.records, [key]: { ...s.records[key], ...patch } },
            pending: s.pending.includes(key) ? s.pending : [...s.pending, key],
          }
        }),
      setStep: (step) => set({ step }),
      // Records live offline until this runs. Wiring to GitHub and the OneDrive
      // workbook (Microsoft Graph) still needs credentials — see README.
      sync: () => set({ pending: [], lastSyncAt: Date.now() }),
      setRequirePhoto: (requirePhoto) => set({ requirePhoto }),

      unlock: (pin) => {
        const ok = pin === ADMIN_PIN
        if (ok) set({ admin: true })
        return ok
      },
      // The subassembly page only exists while unlocked, so locking must leave it.
      lock: () => set((s) => ({ admin: false, view: s.view === 'subs' ? 'fleet' : s.view })),

      editPart: (code, id, patch) =>
        set((s) => ({
          overrides: withParts(s.overrides, code, (parts) =>
            parts.map((p) => (partId(p) === id ? { ...p, ...patch } : p)),
          ),
        })),
      addPart: (code) => {
        const parts = partsFor(code, get().overrides)
        const id = nextPartId(code, parts)
        set((s) => ({
          overrides: withParts(s.overrides, code, (ps) => [...ps, blankPart(id)]),
          // Open the group so the new row is actually visible.
          openGroups: { ...s.openGroups, [code]: true },
        }))
        return `${code}:${id}`
      },
      removePart: (code, id) =>
        set((s) => ({
          overrides: withParts(s.overrides, code, (parts) =>
            parts.filter((p) => partId(p) !== id),
          ),
          sel: s.sel === `${code}:${id}` ? null : s.sel,
        })),

      fitSub: (unitId, code) =>
        set((s) => {
          const current = s.overrides.units[unitId]?.subs ?? defaultSubs(unitId)
          if (current.includes(code)) return s
          return { overrides: withUnit(s.overrides, unitId, { subs: [...current, code] }) }
        }),
      strikeSub: (unitId, code) =>
        set((s) => {
          const current = s.overrides.units[unitId]?.subs ?? defaultSubs(unitId)
          return {
            overrides: withUnit(s.overrides, unitId, {
              subs: current.filter((c) => c !== code),
            }),
          }
        }),
      editUnit: (unitId, patch) =>
        set((s) => ({
          overrides: withUnit(s.overrides, unitId, {
            ...(patch.vin !== undefined ? { vin: patch.vin } : {}),
            ...(patch.serials
              ? { serials: { ...s.overrides.units[unitId]?.serials, ...patch.serials } }
              : {}),
          }),
        })),
      setUnitRev: (unitId, lineKey, rev) =>
        set((s) => {
          const revs = { ...s.overrides.units[unitId]?.revs }
          // Blank clears it, so the line goes back to the master part (or the
          // machine's Vue revision) rather than being pinned to an empty string.
          if (rev.trim()) revs[lineKey] = rev.trim()
          else delete revs[lineKey]
          return {
            overrides: withUnit(s.overrides, unitId, {
              revs: Object.keys(revs).length ? revs : undefined,
            }),
          }
        }),
      resetOverrides: () => set({ overrides: EMPTY_OVERRIDES }),

      // Records are deliberately untouched: they are keyed to part ids, so any
      // that the workbook drops go inert rather than being deleted, and return
      // if the id comes back. Selection is cleared because the line it pointed
      // at may no longer exist.
      applyMasterData: (overrides) => set({ overrides, sel: null, openGroups: {}, step: 0 }),

      createSub: (code, name, kind) => {
        const c = normaliseSubCode(code)
        if (subCodeError(c, get().overrides) || subNameError(name)) return false
        set((s) => ({
          overrides: withSub(s.overrides, c, () => ({ name: name.trim(), kind, parts: [] })),
        }))
        return true
      },
      // Name and kind only. The code is identity — every audit record under this
      // subassembly is keyed by it, so changing it would detach all of them.
      renameSub: (code, name) => set((s) => ({ overrides: withSub(s.overrides, code, (x) => ({ ...x, name })) })),
      setSubKind: (code, kind) =>
        set((s) => ({ overrides: withSub(s.overrides, code, (x) => ({ ...x, kind })) })),
      revertSub: (code) =>
        set((s) => {
          const subs = { ...s.overrides.subs }
          delete subs[code]
          return { overrides: { ...s.overrides, subs }, sel: null }
        }),

      movePart: (code, id, delta) =>
        set((s) => ({
          overrides: withParts(s.overrides, code, (parts) => {
            const at = parts.findIndex((p) => partId(p) === id)
            const to = at + delta
            if (at < 0 || to < 0 || to >= parts.length) return parts
            const out = [...parts]
            ;[out[at], out[to]] = [out[to], out[at]]
            return out
          }),
        })),
      setVariant: (code, id, rev, variant) =>
        set((s) => ({
          overrides: withParts(s.overrides, code, (parts) =>
            parts.map((p) => {
              if (partId(p) !== id) return p
              const byRev = { ...p.byRev }
              if (variant === null) delete byRev[rev]
              else byRev[rev] = variant
              return Object.keys(byRev).length ? { ...p, byRev } : { ...p, byRev: undefined }
            }),
          ),
        })),
    }),
    {
      name: 'unit-info',
      version: PERSIST_VERSION,
      partialize: persistedFields,
      storage: createJSONStorage(webOrMemory),
      migrate: (persisted, from) => {
        const s = (persisted ?? {}) as Partial<State>
        return (from ?? 0) >= PERSIST_VERSION
          ? (s as State)
          : ({ ...s, overrides: migrateOverrides(s.overrides) } as State)
      },
    },
  ),
)

/**
 * localStorage where it works, memory where it doesn't — private browsing, a
 * locked-down browser, or a test runner. Records survive the session either
 * way, and the queue still tells the user what hasn't been pushed.
 */
function webOrMemory(): Storage {
  try {
    const probe = '__unit_info__'
    globalThis.localStorage.setItem(probe, probe)
    globalThis.localStorage.removeItem(probe)
    return globalThis.localStorage
  } catch {
    return memoryStorage()
  }
}

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  }
}

/** The first subassembly of a unit defaults open. */
export function isGroupOpen(
  openGroups: Partial<Record<SubCode, boolean>>,
  code: SubCode,
  firstSub: SubCode | undefined,
): boolean {
  return openGroups[code] ?? firstSub === code
}
