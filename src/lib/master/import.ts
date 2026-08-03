/**
 * Validates a master-data workbook and turns it into an `Overrides`.
 *
 * Nothing is written until every hard error is clear. "Replace outright" means
 * the workbook fully determines the result — but the override written is the
 * MINIMAL DIFF from the built-in baseline, so a subassembly or machine the
 * workbook did not actually change keeps tracking its source data (units.csv,
 * vue-licenses.csv, subassemblies.ts) instead of being frozen at today's value.
 */
import { SUBS } from '../../data/subassemblies'
import { defaultSubs } from '../fleet'
import { blankPart, partId, partsFor } from '../overrides'
import type { Overrides, UnitOverride } from '../overrides'
import type { PartSpec, Records, SerialSlot, SubCode, Unit } from '../types'
import { recordKey } from '../records'
import type { Workbook } from '../xlsx/read'
import {
  APP_TAG,
  headerIndex,
  isFitted,
  PARTS_COLUMNS,
  requiredHeaders,
  SCHEMA_VERSION,
  SERIAL_SLOTS,
  SHEET,
  SUB_ORDER,
  UNITS_COLUMNS,
  VARIANTS_COLUMNS,
} from './schema'

export interface Issue {
  code: string
  message: string
  where?: string
}

export interface ImportPlan {
  ok: boolean
  errors: Issue[]
  warnings: Issue[]
  overrides: Overrides
  /** The line an admin confirms. Computed here so the panel needs no static
   *  import of this module — that would defeat the lazy chunk. */
  confirm: string
  summary: {
    parts: number
    partsBefore: number
    subsChanged: SubCode[]
    unitsChanged: string[]
    fitmentChanged: number
    strandedRecords: number
  }
}

export interface ImportContext {
  fleet: Unit[]
  overrides: Overrides
  records: Records
}

const KNOWN_SUBS = new Set<string>(SUB_ORDER)

export function validateWorkbook(wb: Workbook, ctx: ImportContext): ImportPlan {
  const errors: Issue[] = []
  const warnings: Issue[] = []
  const empty: ImportPlan = {
    ok: false,
    errors,
    warnings,
    overrides: { parts: {}, units: {} },
    confirm: '',
    summary: {
      parts: 0,
      partsBefore: 0,
      subsChanged: [],
      unitsChanged: [],
      fitmentChanged: 0,
      strandedRecords: 0,
    },
  }

  // ── Gate 1: provenance ────────────────────────────────────────────────────
  const readme = wb.get(SHEET.readme)
  if (!readme) {
    errors.push({
      code: 'E-META-MISSING',
      message: `This workbook has no "${SHEET.readme}" sheet, so it was not produced by Unit Info. Export the master data first, edit that file, then import it.`,
    })
    return empty
  }
  const meta = new Map<string, string>()
  for (const row of readme) {
    const key = (row[0] ?? '').trim()
    if (key && !meta.has(key)) meta.set(key, (row[1] ?? '').trim())
  }
  if (meta.get('app') !== APP_TAG) {
    errors.push({
      code: 'E-META-MISSING',
      message: `This workbook is not a Unit Info master-data file (its "app" field reads ${JSON.stringify(meta.get('app') ?? '')}). Export first, edit that file, then import it.`,
    })
    return empty
  }
  if (meta.get('schema_version') !== SCHEMA_VERSION) {
    errors.push({
      code: 'E-SCHEMA-UNKNOWN',
      message: `This workbook uses schema ${JSON.stringify(meta.get('schema_version') ?? 'unknown')} but this app reads ${SCHEMA_VERSION}. Export a fresh file and reapply your edits to it.`,
    })
    return empty
  }

  // ── Gate 2: required sheets and columns ───────────────────────────────────
  const need = [
    { name: SHEET.parts, columns: PARTS_COLUMNS },
    { name: SHEET.variants, columns: VARIANTS_COLUMNS },
    { name: SHEET.units, columns: UNITS_COLUMNS },
  ]
  const heads = new Map<string, Map<string, number>>()
  for (const n of need) {
    const rows = wb.get(n.name)
    if (!rows || !rows.length) {
      errors.push({
        code: 'E-SHEET-MISSING',
        message: `The sheet "${n.name}" is missing or empty. Sheet names and their column headers are the contract — don't rename them.`,
      })
      continue
    }
    const idx = headerIndex(rows[0])
    const missing = requiredHeaders(n.columns).filter((h) => !idx.has(h))
    if (missing.length) {
      errors.push({
        code: 'E-COLUMN-MISSING',
        message: `The sheet "${n.name}" is missing the column${missing.length > 1 ? 's' : ''} ${missing.map((m) => `"${m}"`).join(', ')}.`,
        where: n.name,
      })
    }
    heads.set(n.name, idx)
  }
  if (errors.length) return empty

  // ── Gate 3: parts ─────────────────────────────────────────────────────────
  const partsRows = wb.get(SHEET.parts)!.slice(1)
  const pIdx = heads.get(SHEET.parts)!
  const cell = (row: string[], idx: Map<string, number>, header: string) =>
    (row[idx.get(header) ?? -1] ?? '').trim()

  const byCode = new Map<SubCode, PartSpec[]>()
  const seenIds = new Map<string, Set<string>>()
  let generated = 0

  partsRows.forEach((row, i) => {
    const where = `${SHEET.parts} row ${i + 2}`
    if (row.every((c) => !c.trim())) return

    const code = cell(row, pIdx, 'sub_code')
    if (!KNOWN_SUBS.has(code)) {
      errors.push({
        code: 'E-SUB-UNKNOWN',
        message: `${where}: sub_code "${code}" is not one of ${SUB_ORDER.join(', ')}.`,
        where,
      })
      return
    }
    const sub = code as SubCode

    const number = cell(row, pIdx, 'part_number')
    let id = cell(row, pIdx, 'part_id')
    if (!id) {
      // A row an admin added by hand. Generate a stable id from the number.
      id = number ? `${sub}-${number}`.replace(/\s+/g, '-') : `${sub}-NEW-${++generated}`
    }
    if (!number) {
      errors.push({
        code: 'E-PART-BLANK',
        message: `${where}: part_number is blank. Every part needs a number — delete the row if the part is not fitted.`,
        where,
      })
      return
    }

    const ids = seenIds.get(sub) ?? new Set<string>()
    if (ids.has(id)) {
      errors.push({
        code: 'E-PART-DUPLICATE',
        message: `${where}: part_id "${id}" appears more than once under ${sub}. Part ids must be unique within a subassembly.`,
        where,
      })
      return
    }
    ids.add(id)
    seenIds.set(sub, ids)

    const slot = cell(row, pIdx, 'serial_slot')
    if (slot && !(SERIAL_SLOTS as readonly string[]).includes(slot)) {
      errors.push({
        code: 'E-SLOT-UNKNOWN',
        message: `${where}: serial_slot "${slot}" is not one of ${SERIAL_SLOTS.join(', ')} (or blank for a part that carries no serial).`,
        where,
      })
      return
    }

    const spec: PartSpec = {
      ...blankPart(id),
      part: number,
      desc: cell(row, pIdx, 'description'),
      rev: cell(row, pIdx, 'rev'),
      loc: cell(row, pIdx, 'location'),
    }
    if (slot) spec.slot = slot as SerialSlot
    const specText = cell(row, pIdx, 'spec')
    if (specText) spec.spec = specText

    const list = byCode.get(sub) ?? []
    list.push(spec)
    byCode.set(sub, list)
  })

  // ── Gate 4: variants ──────────────────────────────────────────────────────
  const vIdx = heads.get(SHEET.variants)!
  wb.get(SHEET.variants)!
    .slice(1)
    .forEach((row, i) => {
      const where = `${SHEET.variants} row ${i + 2}`
      if (row.every((c) => !c.trim())) return
      const code = cell(row, vIdx, 'sub_code')
      const id = cell(row, vIdx, 'part_id')
      const rev = cell(row, vIdx, 'vue_rev')
      const variant = cell(row, vIdx, 'variant')
      if (!KNOWN_SUBS.has(code)) {
        errors.push({ code: 'E-SUB-UNKNOWN', message: `${where}: sub_code "${code}" is not a known subassembly.`, where })
        return
      }
      const target = byCode.get(code as SubCode)?.find((p) => partId(p) === id)
      if (!target) {
        errors.push({
          code: 'E-VARIANT-ORPHAN',
          message: `${where}: no part with part_id "${id}" exists under ${code} on "${SHEET.parts}". A variant must point at a part in the same file.`,
          where,
        })
        return
      }
      if (!rev || !variant) {
        errors.push({ code: 'E-VARIANT-BLANK', message: `${where}: vue_rev and variant must both be filled in.`, where })
        return
      }
      target.byRev = { ...target.byRev, [rev]: variant }
    })

  // ── Gate 5: units and the fixed roster ────────────────────────────────────
  const uIdx = heads.get(SHEET.units)!
  const unitRows = wb.get(SHEET.units)!.slice(1).filter((r) => r.some((c) => c.trim()))
  const roster = new Map(ctx.fleet.map((u) => [u.id, u]))
  const seenUnits = new Set<string>()
  const unitOverrides: Record<string, UnitOverride> = {}
  let fitmentChanged = 0

  unitRows.forEach((row, i) => {
    const where = `${SHEET.units} row ${i + 2}`
    const id = cell(row, uIdx, 'unit_id')
    const unit = roster.get(id)
    if (!unit) {
      errors.push({
        code: 'E-UNIT-UNKNOWN',
        message: `${where}: "${id}" is not a machine in this fleet. The 37 machines come from units.csv and import cannot add one.`,
        where,
      })
      return
    }
    if (seenUnits.has(id)) {
      errors.push({ code: 'E-UNIT-DUPLICATE', message: `${where}: "${id}" appears more than once.`, where })
      return
    }
    seenUnits.add(id)

    const subs = SUB_ORDER.filter((code) => isFitted(cell(row, uIdx, `fit_${code}`)))
    for (const code of subs) {
      if (!byCode.has(code) && !partsFor(code, { parts: {}, units: {} }).length) {
        warnings.push({
          code: 'W-FIT-EMPTY',
          message: `${where}: ${id} is fitted with ${code}, which has no parts in this file. It will show as an empty subassembly.`,
          where,
        })
      }
    }

    const base = defaultSubs(id)
    const sameFitment = subs.length === base.length && subs.every((c, k) => c === base[k])
    if (!sameFitment) fitmentChanged++

    const o: UnitOverride = {}
    const vin = cell(row, uIdx, 'chassis_vin')
    const serials: Partial<Record<SerialSlot, string>> = {}
    for (const [slot, header] of [
      ['front', 'serial_front'],
      ['rear', 'serial_rear'],
      ['loader', 'serial_loader'],
    ] as const) {
      const v = cell(row, uIdx, header)
      if (v !== unit.serials[slot]) serials[slot] = v
    }
    // Minimal diff: only pin what actually differs, so anything untouched keeps
    // tracking units.csv / vue-licenses.csv instead of freezing at today's value.
    if (vin !== unit.vin) o.vin = vin
    if (Object.keys(serials).length) o.serials = serials
    if (!sameFitment) o.subs = subs
    if (Object.keys(o).length) unitOverrides[id] = o
  })

  const missingUnits = ctx.fleet.filter((u) => !seenUnits.has(u.id)).map((u) => u.id)
  if (missingUnits.length) {
    errors.push({
      code: 'E-ROSTER-INCOMPLETE',
      message: `"${SHEET.units}" is missing ${missingUnits.length} machine${missingUnits.length > 1 ? 's' : ''} (${missingUnits.slice(0, 5).join(', ')}${missingUnits.length > 5 ? ', …' : ''}). Every machine must have a row — deleting one would silently revert it, so the import is rejected instead.`,
    })
  }

  if (errors.length) return empty

  // ── Build the parts overrides, again as a minimal diff ────────────────────
  const parts: Partial<Record<SubCode, PartSpec[]>> = {}
  const subsChanged: SubCode[] = []
  for (const code of SUB_ORDER) {
    const incoming = byCode.get(code) ?? []
    if (!samePartList(incoming, SUBS[code].parts)) {
      parts[code] = incoming
      subsChanged.push(code)
    }
    if (!incoming.length && SUBS[code].parts.length) {
      warnings.push({
        code: 'W-SUB-EMPTIED',
        message: `${SUBS[code].name} has no parts left in this file. Every machine carrying it will show an empty subassembly.`,
      })
    }
  }

  // Records pointing at part ids the workbook drops. They stay in storage,
  // inert, and come back if the id ever returns — but say so out loud.
  let strandedRecords = 0
  for (const unit of ctx.fleet) {
    const subs = unitOverrides[unit.id]?.subs ?? defaultSubs(unit.id)
    const live = new Set(
      subs.flatMap((code) => {
        const list = parts[code] ?? SUBS[code].parts
        return list.map((p) => recordKey(unit.id, `${code}:${partId(p)}`))
      }),
    )
    for (const key of Object.keys(ctx.records)) {
      if (key.startsWith(`${unit.id}|`) && !live.has(key)) strandedRecords++
    }
  }

  const partsBefore = SUB_ORDER.reduce((n, c) => n + partsFor(c, ctx.overrides).length, 0)
  const total = SUB_ORDER.reduce((n, c) => n + (parts[c] ?? SUBS[c].parts).length, 0)

  if (fitmentChanged > ctx.fleet.length / 2) {
    warnings.push({
      code: 'W-FITMENT-CHURN',
      message: `Fitment differs from the imported defaults on ${fitmentChanged} of ${ctx.fleet.length} machines. If you sorted "${SHEET.units}" in Excel, check that the fit_ columns still line up with the right unit_id.`,
    })
  }
  if (strandedRecords) {
    warnings.push({
      code: 'W-RECORDS-STRANDED',
      message: `${strandedRecords} audit record${strandedRecords > 1 ? 's' : ''} refer to parts this file removes. They are kept but no longer shown, and return if the part comes back.`,
    })
  }

  const summary = {
    parts: total,
    partsBefore,
    subsChanged,
    unitsChanged: Object.keys(unitOverrides),
    fitmentChanged,
    strandedRecords,
  }

  const plan: ImportPlan = {
    ok: true,
    errors,
    warnings,
    overrides: { parts, units: unitOverrides },
    confirm: '',
    summary,
  }
  plan.confirm = confirmText(plan, ctx.fleet.length)
  return plan
}

function samePartList(a: PartSpec[], b: PartSpec[]): boolean {
  if (a.length !== b.length) return false
  return a.every((p, i) => {
    const q = b[i]
    return (
      partId(p) === partId(q) &&
      p.part === q.part &&
      p.desc === q.desc &&
      p.rev === q.rev &&
      p.loc === q.loc &&
      (p.slot ?? '') === (q.slot ?? '') &&
      (p.spec ?? '') === (q.spec ?? '') &&
      JSON.stringify(p.byRev ?? null) === JSON.stringify(q.byRev ?? null)
    )
  })
}

/** The plain-English line an admin confirms before anything is written. */
export function confirmText(plan: ImportPlan, fleetSize: number): string {
  const s = plan.summary
  const bits = [
    `Replace all master data: ${s.partsBefore} parts become ${s.parts}`,
    s.subsChanged.length
      ? `${s.subsChanged.length} subassembl${s.subsChanged.length > 1 ? 'ies' : 'y'} changed (${s.subsChanged.join(', ')})`
      : 'no subassembly changed',
    s.unitsChanged.length
      ? `${s.unitsChanged.length} of ${fleetSize} machines changed`
      : 'no machine changed',
  ]
  return `${bits.join(' · ')}. This cannot be undone.`
}
