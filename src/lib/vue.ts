import { parseCsvRows } from './csv'
import vueCsv from '../data/vue-licenses.csv?raw'
// Type-only, and deliberately so: this keeps the edge to overrides.ts erased at
// compile time, so overrides.ts never has to know about the Vue domain.
import type { Overrides, VueOverride } from './overrides'
import type { BuiltInSubCode, VueLicense, VueSystem, VueUnit } from './types'

export type { VueLicense, VueSystem, VueUnit }

/**
 * Mostly transcribed from "Vue license notes.docx". The TeamViewer IDs and
 * passwords in that sheet are deliberately NOT imported — this app is served
 * publicly from GitHub Pages. Keep them out of the repo.
 *
 * The sheet lists 000-20230822-0228 on two rows with the same TeamViewer ID;
 * it is one unit and appears here once.
 *
 * 000-20240222-0421 (T-53) is NOT from that sheet — it postdates every serial
 * in it, so the notes are out of date. Expect more systems to be missing from
 * them, and treat the unlocated rows as a floor rather than the full backlog.
 *
 * This is the sheet as shipped. Anything an admin changes lives in
 * `Overrides.vue` and is merged by `vueSystems`.
 */
export const VUE_CSV: VueUnit[] = parseCsvRows(vueCsv).map((r) => ({
  serial: r.vue_serial,
  license: r.license as VueLicense,
  rev: r.revision,
  notes: r.notes,
  locationEstimate: r.location_estimate,
  locationConfirmed: r.location_confirmed,
}))

export const VUE_CSV_BY_SERIAL: Map<string, VueUnit> = new Map(
  VUE_CSV.map((v) => [v.serial, v]),
)

/** The subassembly a licence tier corresponds to, if any. */
export function subForLicense(license: VueLicense): BuiltInSubCode | null {
  if (license === 'Tie Detection') return 'VT'
  if (license === 'VGR premium' || license === 'VGR enterprise') return 'VG'
  return null
}

const UNIT_ID = /^T-\d+$/

export const isUnitId = (s: string): boolean => UNIT_ID.test(s)

/** The location the sheet records: confirmed wins over the estimate. */
export function locationOf(v: VueUnit): string {
  return v.locationConfirmed || v.locationEstimate
}

/** `"t-32"`, `"T32"`, `" T-32 "` -> `"T-32"`. Anything else is just trimmed. */
export function normaliseVueLocation(raw: string): string {
  const s = raw.trim()
  const m = /^t-?\s*(\d+)$/i.exec(s)
  return m ? `T-${m[1]}` : s
}

/**
 * Every Vue system: the sheet's rows patched by any admin edit, then the
 * systems an admin added, in the order they were added.
 */
export function vueSystems(o: Overrides): VueSystem[] {
  const patches = o.vue ?? {}

  const resolve = (row: VueUnit, patch: VueOverride | undefined): VueSystem => {
    const sheetLocation = locationOf(row)
    return {
      ...row,
      license: patch?.license ?? row.license,
      rev: patch?.rev ?? row.rev,
      notes: patch?.notes ?? row.notes,
      // Presence, not truthiness: an explicit '' un-assigns a system the sheet
      // placed, where undefined means "keep tracking the sheet".
      location: patch?.location !== undefined ? patch.location : sheetLocation,
      sheetLocation,
      assigned: patch?.location !== undefined,
      added: false,
    }
  }

  const fromSheet = VUE_CSV.map((row) => resolve(row, patches[row.serial]))

  const added = Object.keys(patches)
    .filter((serial) => !VUE_CSV_BY_SERIAL.has(serial))
    .map((serial) => {
      const p = patches[serial]
      return {
        serial,
        license: p.license ?? '',
        rev: p.rev ?? '',
        notes: p.notes ?? '',
        locationEstimate: '',
        locationConfirmed: '',
        location: p.location ?? '',
        sheetLocation: '',
        assigned: p.location !== undefined,
        added: true,
      } satisfies VueSystem
    })

  return [...fromSheet, ...added]
}

// Resolving 18 rows is cheap, but `defaultSubs` runs once per machine inside
// `buildFleet`, so without this it would run 37 times per rebuild. Overrides is
// always replaced wholesale, so identity is a sound cache key — the same
// assumption App.tsx's useMemo already makes.
let byUnitCache: { key: Overrides; map: Map<string, VueSystem> } | null = null

/**
 * unit id -> the system on it. When two systems claim the same machine the
 * FIRST wins and the rest are dropped; `doubleBooked` is what surfaces that,
 * rather than the old `new Map` behaviour of silently keeping the last.
 */
export function vueByUnit(o: Overrides): Map<string, VueSystem> {
  if (byUnitCache?.key === o) return byUnitCache.map
  const map = new Map<string, VueSystem>()
  for (const v of vueSystems(o)) {
    if (isUnitId(v.location) && !map.has(v.location)) map.set(v.location, v)
  }
  byUnitCache = { key: o, map }
  return map
}

export const vueOn = (unitId: string, o: Overrides): VueSystem | undefined =>
  vueByUnit(o).get(unitId)

export const vueSystem = (serial: string, o: Overrides): VueSystem | undefined =>
  vueSystems(o).find((v) => v.serial === serial)

/** Machines with more than one system claiming them. */
export function doubleBooked(o: Overrides): { unitId: string; serials: string[] }[] {
  const byUnit = new Map<string, string[]>()
  for (const v of vueSystems(o)) {
    if (!isUnitId(v.location)) continue
    byUnit.set(v.location, [...(byUnit.get(v.location) ?? []), v.serial])
  }
  return [...byUnit]
    .filter(([, serials]) => serials.length > 1)
    .map(([unitId, serials]) => ({ unitId, serials }))
}

/**
 * Writes one system's override, dropping any field that matches the sheet and
 * the record itself once nothing differs — so the store's idea of "changed"
 * matches the workbook importer's minimal diff exactly.
 */
export function withVue(
  o: Overrides,
  serial: string,
  fn: (v: VueOverride) => VueOverride,
): Overrides {
  const patch = fn(o.vue?.[serial] ?? {})
  const row = VUE_CSV_BY_SERIAL.get(serial)

  const pruned: VueOverride = { ...patch }
  if (row) {
    if (pruned.location === locationOf(row)) delete pruned.location
    if (pruned.license === row.license) delete pruned.license
    if (pruned.rev === row.rev) delete pruned.rev
    if (pruned.notes === row.notes) delete pruned.notes
  }
  for (const k of Object.keys(pruned) as (keyof VueOverride)[]) {
    if (pruned[k] === undefined) delete pruned[k]
  }

  const vue = { ...o.vue }
  // An added system with nothing on it would vanish, so it always keeps a record.
  if (Object.keys(pruned).length || !row) vue[serial] = pruned
  else delete vue[serial]
  return { ...o, vue }
}
