import { parseCsvRows } from './csv'
import { EMPTY_OVERRIDES, partId, partsFor, subName } from './overrides'
import type { Overrides } from './overrides'
import { subForLicense, VUE_BY_UNIT } from './vue'
import type { BuiltInSubCode, Line, Unit } from './types'
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

/** The subassemblies a machine carries before any admin edit. */
export function defaultSubs(unitId: string): BuiltInSubCode[] {
  const r = (k: string) => hash(unitId + k)

  // Vision comes from the Apera Vue licence sheet — a machine has one only
  // where that sheet puts it. Robot and Conveyor are still placeholders.
  const vue = VUE_BY_UNIT.get(unitId)
  const visionSub = vue ? subForLicense(vue.license) : null

  const subs = [...COMMON]
  if (visionSub) subs.push(visionSub)
  if (r('rb') > 0.78) subs.push('RB')
  if (r('cv') > 0.55) subs.push('CV')
  return subs
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
        desc: p.byRev ? `${p.desc} — ${variant ?? `variant not identified for rev ${rev}`}` : p.desc,
        onRecord: !!p.slot,
      }
    })
  })
}

export function buildFleet(overrides: Overrides = EMPTY_OVERRIDES, csv: string = unitsCsv): Unit[] {
  return parseUnitsCsv(csv).map((row) => {
    const o = overrides.units[row.unit]
    const vue = VUE_BY_UNIT.get(row.unit)
    const days = Math.floor(hash(`${row.unit}d`) * 190)

    const base = {
      id: row.unit,
      vin: o?.vin ?? row.vin,
      subs: o?.subs ?? defaultSubs(row.unit),
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
