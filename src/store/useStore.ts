import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { BASE_FLEET, defaultSubs } from '../lib/fleet'
import { recordKey } from '../lib/records'
import {
  blankPart,
  EMPTY_OVERRIDES,
  nextPartId,
  partId,
  partsFor,
  withIds,
} from '../lib/overrides'
import type { Overrides } from '../lib/overrides'
import type { Line, PartSpec, RecordEntry, Records, SerialSlot, SubCode, Unit } from '../lib/types'

export type View = 'fleet' | 'machine' | 'phone' | 'vue'

/**
 * Not a security control. The app is a static public bundle with no server, so
 * this PIN ships in the JavaScript and anyone can read it. It exists to stop an
 * auditor changing the master parts list by accident, nothing more — see README.
 */
export const ADMIN_PIN = '4471'

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
  resetOverrides: () => void
}

/** Rewrites one subassembly's parts list, materialising ids on first edit. */
function withParts(
  o: Overrides,
  code: SubCode,
  fn: (parts: PartSpec[]) => PartSpec[],
): Overrides {
  const current = o.parts[code] ?? withIds(partsFor(code, o))
  return { ...o, parts: { ...o.parts, [code]: fn(current) } }
}

function withUnit(o: Overrides, unitId: string, patch: Partial<Overrides['units'][string]>): Overrides {
  return { ...o, units: { ...o.units, [unitId]: { ...o.units[unitId], ...patch } } }
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
      lock: () => set({ admin: false }),

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
      resetOverrides: () => set({ overrides: EMPTY_OVERRIDES }),
    }),
    { name: 'unit-info', partialize: persistedFields, storage: createJSONStorage(webOrMemory) },
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
