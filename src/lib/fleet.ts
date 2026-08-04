import { parseCsvRows } from './csv'
import { EMPTY_OVERRIDES, partId, partsFor, subName, withUnit } from './overrides'
import type { Overrides } from './overrides'
import { isUnitId, subForLicense, vueByUnit, vueSystems } from './vue'
import type { BuiltInSubCode, Line, SubCode, Unit } from './types'
import unitsCsv from '../data/units.csv?raw'

/**
 * Fitted to every machine before any admin edit. Deliberately a list of
 * literals and NOT derived from `kind`: `kind` is descriptive, and deriving
 * fitment from it would refit the whole fleet the moment someone re-kinds a
 * subassembly on the design page. New subassemblies are fitted per machine,
 * explicitly, through `fitSub`.
 */
const COMMON: BuiltInSubCode[] = ['RG', 'LD', 'MG']

/** FNV-1a, normalised to 0..1 — a stable stand-in until the real per-unit
 *  option list and audit dates are imported. */
function hash(s: string): number {
  let x = 2166136261
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i)
    x = Math.imul(x, 16777619)
  }
  return (x >>> 0) / 4294967295
}

interface CsvRow {
  unit: string
  vin: string
  front: string
  rear: string
  loader: string
}

export function parseUnitsCsv(csv: string): CsvRow[] {
  return parseCsvRows(csv)
    .map((r) => ({
      unit: r.unit,
      vin: r.chassis_vin,
      front: r.rail_gear_front_serial,
      rear: r.rail_gear_rear_serial,
      loader: r.serco_loader_serial,
    }))
    .filter((r) => r.unit)
}

/**
 * `T-16` -> 16. Sorting on this rather than the string keeps T-9 before T-10
 * if a single-digit or three-digit machine ever joins the fleet.
 */
export function unitNumber(id: string): number {
  const m = /\d+/.exec(id)
  return m ? Number.parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER
}

/**
 * The subassemblies a machine carries before any admin edit to its fitment.
 *
 * `overrides` is required, with no default: vision comes from the Vue system
 * assigned to the machine, so a caller that skipped it would silently get
 * sheet-only vision. Making it required means the compiler lists every site.
 */
export function defaultSubs(unitId: string, overrides: Overrides): BuiltInSubCode[] {
  const r = (k: string) => hash(unitId + k)

  // Vision follows the Apera Vue system on the machine. Robot and Conveyor are
  // still placeholders derived from the unit id.
  const vue = vueByUnit(overrides).get(unitId)
  const visionSub = vue ? subForLicense(vue.license) : null

  const subs = [...COMMON]
  if (visionSub) subs.push(visionSub)
  if (r('rb') > 0.78) subs.push('RB')
  if (r('cv') > 0.55) subs.push('CV')
  return subs
}

const sameSet = (a: SubCode[], b: SubCode[]) =>
  a.length === b.length && new Set(b).size === new Set([...a, ...b]).size

/**
 * Drops a machine's fitment pin once it says nothing the defaults don't already
 * say, so the machine starts tracking again.
 *
 * Set-based and order-insensitive on purpose: a pin written by hand before a Vue
 * system was assigned stops masking the default the moment the assignment makes
 * the two agree. It can never fit or unfit anything — the drop precondition is
 * set-equality with the very value `buildFleet` then falls back to. The only
 * visible effect is group order settling into the canonical one.
 */
export function normaliseFitment(o: Overrides, unitId: string): Overrides {
  const pinned = o.units[unitId]?.subs
  if (!pinned) return o
  if (!sameSet(pinned, defaultSubs(unitId, o))) return o
  return withUnit(o, unitId, { subs: undefined })
}

export function linesFor(unit: Omit<Unit, 'lines'>, overrides: Overrides = EMPTY_OVERRIDES): Line[] {
  return unit.subs.flatMap((code) => {
    const name = subName(code, overrides)
    return partsFor(code, overrides).map((p) => {
      const key = `${code}:${partId(p)}`

      // Revision precedence, most specific first:
      //   1. a revision an admin set for this machine alone
      //   2. the machine's Vue revision, for parts the Vue system drives
      //   3. the master part's own revision
      // The byRev variant follows whichever wins, because rev is what selects
      // it — so an admin correcting a revision also corrects which part the
      // audit tells someone to look for.
      const vueDriven = p.slot === 'vue' || !!p.byRev
      const rev = unit.revs?.[key] ?? (vueDriven ? (unit.vueRev ?? p.rev) : p.rev)
      const variant = p.byRev?.[rev]

      return {
        ...p,
        key,
        sub: code,
        subName: name,
        serial: p.slot ? unit.serials[p.slot] : '',
        rev,
        // A blank rev is its own case: several systems read off machines have
        // no revision on record, and "not identified for rev " reads as a bug.
        desc: p.byRev
          ? `${p.desc} — ${
              variant ??
              (rev
                ? `variant not identified for rev ${rev}`
                : 'variant unknown, no revision on record')
            }`
          : p.desc,
        onRecord: !!p.slot,
      }
    })
  })
}

export function buildFleet(overrides: Overrides = EMPTY_OVERRIDES, csv: string = unitsCsv): Unit[] {
  const byUnit = vueByUnit(overrides)
  return parseUnitsCsv(csv).map((row) => {
    const o = overrides.units[row.unit]
    const vue = byUnit.get(row.unit)
    const days = Math.floor(hash(`${row.unit}d`) * 190)

    const base = {
      id: row.unit,
      vin: o?.vin ?? row.vin,
      subs: o?.subs ?? defaultSubs(row.unit, overrides),
      serials: {
        front: row.front,
        rear: row.rear,
        loader: row.loader,
        vue: vue?.serial ?? '',
        ...o?.serials,
      },
      vueRev: vue?.rev,
      revs: o?.revs,
      lastAudit: days > 170 ? 'never' : `${days}d ago`,
    }
    return { ...base, lines: linesFor(base, overrides) }
  })
}

/** The fleet as imported, with no admin edits — for defaults and tests. */
export const BASE_FLEET = buildFleet()

// ── Where the fleet and the Vue inventory disagree ──────────────────────────

export interface VisionGap {
  unitId: string
  code: BuiltInSubCode
  subName: string
}

/**
 * Machines carrying vision with no Vue system on them — the gap that hand
 * fitting creates. Keyed on `vueByUnit` rather than a blank serial, because the
 * question is whether a system *record* is on the machine.
 */
export function visionWithoutSystem(fleet: Unit[], o: Overrides): VisionGap[] {
  const byUnit = vueByUnit(o)
  return fleet.flatMap((u) => {
    if (byUnit.has(u.id)) return []
    return (['VT', 'VG'] as const)
      .filter((c) => u.subs.includes(c))
      .map((code) => ({ unitId: u.id, code, subName: subName(code, o) }))
  })
}

export interface VueMismatch {
  unitId: string
  serial: string
  expected: BuiltInSubCode
  fitted: BuiltInSubCode
}

/**
 * A machine whose fitment disagrees with the licence of the system on it. The
 * fitment always wins — a licence is entitlement, a pin is somebody saying what
 * is physically bolted on, and the two can legitimately disagree for a while.
 */
export function vueLicenceMismatch(fleet: Unit[], o: Overrides): VueMismatch[] {
  const byUnit = vueByUnit(o)
  return fleet.flatMap((u) => {
    const v = byUnit.get(u.id)
    const expected = v ? subForLicense(v.license) : null
    if (!expected) return []
    const fitted = (['VT', 'VG'] as const).find((c) => u.subs.includes(c))
    return fitted && fitted !== expected
      ? [{ unitId: u.id, serial: v!.serial, expected, fitted }]
      : []
  })
}

/** A system whose location names a machine that is not in the fleet. */
export function ghostLocations(fleet: Unit[], o: Overrides): { serial: string; location: string }[] {
  const roster = new Set(fleet.map((u) => u.id))
  return vueSystems(o)
    .filter((v) => isUnitId(v.location) && !roster.has(v.location))
    .map((v) => ({ serial: v.serial, location: v.location }))
}
