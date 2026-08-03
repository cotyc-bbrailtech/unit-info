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
import {
  blankPart,
  normaliseSubCode,
  partId,
  partsFor,
  SUB_CODE_RE,
  subCodes,
  subExists,
  subName,
} from '../overrides'
import type { Overrides, SubOverride, UnitOverride } from '../overrides'
import type { PartSpec, Records, SerialSlot, SubCode, SubKind, Subassembly, Unit } from '../types'
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
  SUBASSEMBLIES_COLUMNS,
  UNIT_REVS_COLUMNS,
  SUB_KINDS,
  unitsColumns,
  fitCode,
  fitHeader,
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
    subsAdded: SubCode[]
    subsRemoved: SubCode[]
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

export function validateWorkbook(wb: Workbook, ctx: ImportContext): ImportPlan {
  const errors: Issue[] = []
  const warnings: Issue[] = []
  const empty: ImportPlan = {
    ok: false,
    errors,
    warnings,
    overrides: { subs: {}, units: {} },
    confirm: '',
    summary: {
      parts: 0,
      partsBefore: 0,
      subsChanged: [],
      subsAdded: [],
      subsRemoved: [],
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
    { name: SHEET.subassemblies, columns: SUBASSEMBLIES_COLUMNS },
    { name: SHEET.parts, columns: PARTS_COLUMNS },
    { name: SHEET.variants, columns: VARIANTS_COLUMNS },
    // The fit_ columns are dynamic, so only the fixed ones are required here.
    { name: SHEET.units, columns: unitsColumns([]) },
    { name: SHEET.unitRevs, columns: UNIT_REVS_COLUMNS },
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

  const cell = (row: string[], idx: Map<string, number>, header: string) =>
    (row[idx.get(header) ?? -1] ?? '').trim()

  // ── Gate 3: the subassemblies themselves ──────────────────────────────────
  // This sheet is the authority for what exists, so it validates before parts,
  // variants and the fit_ columns, all of which cross-check against it.
  const sIdx = heads.get(SHEET.subassemblies)!
  const declared: { code: SubCode; name: string; kind: SubKind }[] = []
  const declaredAt = new Map<SubCode, number>()

  wb.get(SHEET.subassemblies)!
    .slice(1)
    .forEach((row, i) => {
      const where = `${SHEET.subassemblies} row ${i + 2}`
      if (row.every((c) => !c.trim())) return

      const raw = cell(row, sIdx, 'sub_code')
      const code = normaliseSubCode(raw)
      if (!code) {
        errors.push({
          code: 'E-SUB-CODE-BLANK',
          message: `${where}: sub_code is blank. Every subassembly needs a short code — delete the row if you did not mean to add one.`,
          where,
        })
        return
      }
      if (!SUB_CODE_RE.test(code)) {
        errors.push({
          code: 'E-SUB-CODE-INVALID',
          message: `${where}: sub_code "${raw}" is not a valid code. Use 2 to 4 letters or digits starting with a letter, like "RG" or "HYD1" — the code becomes a column header and part of every audit record.`,
          where,
        })
        return
      }
      const seenAt = declaredAt.get(code)
      if (seenAt !== undefined) {
        errors.push({
          code: 'E-SUB-DUPLICATE',
          message: `${where}: sub_code "${code}" is already used on row ${seenAt}. Each subassembly needs its own code.`,
          where,
        })
        return
      }

      const name = cell(row, sIdx, 'name')
      if (!name) {
        errors.push({
          code: 'E-SUB-NAME-BLANK',
          message: `${where}: ${code} has no name. Give it the name that should appear above its parts on a machine.`,
          where,
        })
        return
      }

      const kindRaw = cell(row, sIdx, 'kind').toLowerCase()
      if (kindRaw && !(SUB_KINDS as readonly string[]).includes(kindRaw)) {
        errors.push({
          code: 'E-SUB-KIND-UNKNOWN',
          message: `${where}: kind "${cell(row, sIdx, 'kind')}" is not "common" or "optional". Leave it blank for optional.`,
          where,
        })
        return
      }

      declaredAt.set(code, i + 2)
      declared.push({ code, name, kind: (kindRaw || 'optional') as SubKind })
    })

  if (!declared.length && !errors.length) {
    errors.push({
      code: 'E-SUB-NONE',
      message: `"${SHEET.subassemblies}" has no rows. That sheet is what says which subassemblies exist, so an empty one would erase every parts list — add a row, or import a fresh export.`,
      where: SHEET.subassemblies,
    })
  }
  if (errors.length) return empty

  const declaredCodes = new Set(declared.map((d) => d.code))

  // ── Gate 4: parts ─────────────────────────────────────────────────────────
  const partsRows = wb.get(SHEET.parts)!.slice(1)
  const pIdx = heads.get(SHEET.parts)!

  const byCode = new Map<SubCode, PartSpec[]>()
  const seenIds = new Map<string, Set<string>>()
  let generated = 0

  partsRows.forEach((row, i) => {
    const where = `${SHEET.parts} row ${i + 2}`
    if (row.every((c) => !c.trim())) return

    const code = normaliseSubCode(cell(row, pIdx, 'sub_code'))
    if (!declaredCodes.has(code)) {
      errors.push({
        code: 'E-SUB-UNKNOWN',
        message: code
          ? `${where}: sub_code "${code}" is not declared on "${SHEET.subassemblies}". Add a row for it there first, or correct the code.`
          : `${where}: sub_code is blank. Every part belongs to a subassembly — set it to a code from "${SHEET.subassemblies}".`,
        where,
      })
      return
    }
    const sub = code

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

  // ── Gate 5: variants ──────────────────────────────────────────────────────
  const vIdx = heads.get(SHEET.variants)!
  wb.get(SHEET.variants)!
    .slice(1)
    .forEach((row, i) => {
      const where = `${SHEET.variants} row ${i + 2}`
      if (row.every((c) => !c.trim())) return
      const code = normaliseSubCode(cell(row, vIdx, 'sub_code'))
      const id = cell(row, vIdx, 'part_id')
      const rev = cell(row, vIdx, 'vue_rev')
      const variant = cell(row, vIdx, 'variant')
      if (!declaredCodes.has(code)) {
        errors.push({
          code: 'E-SUB-UNKNOWN',
          message: `${where}: sub_code "${code}" is not declared on "${SHEET.subassemblies}".`,
          where,
        })
        return
      }
      const target = byCode.get(code)?.find((p) => partId(p) === id)
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

  // ── Gate 6: units and the fixed roster ────────────────────────────────────
  const uIdx = heads.get(SHEET.units)!
  const unitRows = wb.get(SHEET.units)!.slice(1).filter((r) => r.some((c) => c.trim()))
  const roster = new Map(ctx.fleet.map((u) => [u.id, u]))
  const seenUnits = new Set<string>()
  const unitOverrides: Record<string, UnitOverride> = {}
  let fitmentChanged = 0

  // The fit_ block is dynamic. Scan the header row directly rather than through
  // headerIndex, so a duplicated column stays visible instead of being deduped.
  const fitAt = new Map<SubCode, number>()
  wb.get(SHEET.units)![0].forEach((h, i) => {
    const code = fitCode(h)
    if (code === null) return
    if (!code || !declaredCodes.has(code)) {
      errors.push({
        code: 'E-FIT-COLUMN-UNKNOWN',
        message: code
          ? `"${SHEET.units}" has a column "${fitHeader(code)}" but "${code}" is not declared on "${SHEET.subassemblies}". Add a row for it there, or delete the column.`
          : `"${SHEET.units}" has a column named "fit_" with no subassembly code after it. Name it fit_ plus a code from "${SHEET.subassemblies}", or delete it.`,
        where: `${SHEET.units} column ${i + 1}`,
      })
      return
    }
    if (fitAt.has(code)) {
      errors.push({
        code: 'E-FIT-COLUMN-DUPLICATE',
        message: `"${SHEET.units}" has more than one ${fitHeader(code)} column. Delete the extra one — with two there is no telling which marks are current.`,
        where: `${SHEET.units} column ${i + 1}`,
      })
      return
    }
    fitAt.set(code, i)
  })

  // A declared subassembly with no column: rejected when machines carry it
  // today (deleting the column would strike it off all of them silently),
  // tolerated when none do — that is the "just created it" case.
  for (const d of declared) {
    if (fitAt.has(d.code)) continue
    const carrying = ctx.fleet.filter((u) => u.subs.includes(d.code)).length
    if (carrying) {
      errors.push({
        code: 'E-FIT-COLUMN-MISSING',
        message: `"${SHEET.units}" has no ${fitHeader(d.code)} column, but ${carrying} machine${carrying > 1 ? 's' : ''} carr${carrying > 1 ? 'y' : 'ies'} ${d.name} today. Deleting the column would strike it off every one of them silently, so the import is rejected instead. Put the column back, or empty its cells if you do mean to unfit them all.`,
        where: SHEET.units,
      })
    } else {
      warnings.push({
        code: 'W-FIT-COLUMN-MISSING',
        message: `${d.name} (${d.code}) has no ${fitHeader(d.code)} column on "${SHEET.units}", so no machine is fitted with it. Import this file, export a fresh one, and the column will be there to mark.`,
        where: SHEET.units,
      })
    }
  }
  if (errors.length) return empty

  // One warning per subassembly, not per machine.
  const warnedEmpty = new Set<SubCode>()

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

    // Built in declared order, so sheet-4 column order cannot reach unit.subs.
    const subs = declared
      .map((d) => d.code)
      .filter((code) => isFitted(row[fitAt.get(code) ?? -1] ?? ''))

    for (const code of subs) {
      if (!byCode.get(code)?.length && !warnedEmpty.has(code)) {
        warnedEmpty.add(code)
        warnings.push({
          code: 'W-FIT-EMPTY',
          message: `${subName(code, ctx.overrides)} (${code}) has no parts in this file, but machines are fitted with it. It will show as an empty subassembly.`,
          where: SHEET.units,
        })
      }
    }

    const base = defaultSubs(id)
    const sameFitment = subs.length === base.length && base.every((c) => subs.includes(c))
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

  // ── Gate 7: per-machine revisions ─────────────────────────────────────────
  // Sparse. A machine with no row here simply follows the master part, so a
  // blank rev and a deleted row both mean "put it back".
  const rIdx = heads.get(SHEET.unitRevs)!
  const revsByUnit = new Map<string, Record<string, string>>()
  const seenRevs = new Set<string>()

  wb.get(SHEET.unitRevs)!
    .slice(1)
    .forEach((row, i) => {
      const where = `${SHEET.unitRevs} row ${i + 2}`
      if (row.every((c) => !c.trim())) return

      const id = cell(row, rIdx, 'unit_id')
      const code = normaliseSubCode(cell(row, rIdx, 'sub_code'))
      const part = cell(row, rIdx, 'part_id')
      const rev = cell(row, rIdx, 'rev')

      if (!roster.has(id)) {
        errors.push({
          code: 'E-UNIT-UNKNOWN',
          message: `${where}: "${id}" is not a machine in this fleet.`,
          where,
        })
        return
      }
      if (!declaredCodes.has(code)) {
        errors.push({
          code: 'E-SUB-UNKNOWN',
          message: `${where}: sub_code "${code}" is not declared on "${SHEET.subassemblies}".`,
          where,
        })
        return
      }
      if (!byCode.get(code)?.some((p) => partId(p) === part)) {
        errors.push({
          code: 'E-REV-ORPHAN',
          message: `${where}: no part with part_id "${part}" exists under ${code} on "${SHEET.parts}". A machine revision must point at a part in the same file.`,
          where,
        })
        return
      }

      const lineKey = `${code}:${part}`
      const dupKey = `${id}|${lineKey}`
      if (seenRevs.has(dupKey)) {
        errors.push({
          code: 'E-REV-DUPLICATE',
          message: `${where}: ${id} already has a revision for ${part} on an earlier row. One row per machine and part.`,
          where,
        })
        return
      }
      seenRevs.add(dupKey)

      // Blank means "no override" — the row is just left over.
      if (!rev) return

      const fitted = (unitOverrides[id]?.subs ?? defaultSubs(id)).includes(code)
      if (!fitted) {
        warnings.push({
          code: 'W-REV-UNFITTED',
          message: `${where}: ${id} is not fitted with ${subName(code, ctx.overrides)}, so this revision has nothing to apply to. It is kept in case the subassembly is fitted later.`,
          where,
        })
      }

      revsByUnit.set(id, { ...revsByUnit.get(id), [lineKey]: rev })
    })

  for (const [id, revs] of revsByUnit) {
    unitOverrides[id] = { ...unitOverrides[id], revs }
  }

  const missingUnits = ctx.fleet.filter((u) => !seenUnits.has(u.id)).map((u) => u.id)
  if (missingUnits.length) {
    errors.push({
      code: 'E-ROSTER-INCOMPLETE',
      message: `"${SHEET.units}" is missing ${missingUnits.length} machine${missingUnits.length > 1 ? 's' : ''} (${missingUnits.slice(0, 5).join(', ')}${missingUnits.length > 5 ? ', …' : ''}). Every machine must have a row — deleting one would silently revert it, so the import is rejected instead.`,
    })
  }

  if (errors.length) return empty

  // ── Build the overrides, as a minimal diff from the built-in baseline ─────
  // Anything the workbook did not actually change gets no override, so it keeps
  // tracking subassemblies.ts rather than freezing at today's value.
  const subs: Record<SubCode, SubOverride> = {}
  const subsChanged: SubCode[] = []
  const baseline = (code: SubCode) => (SUBS as Record<string, Subassembly | undefined>)[code]

  for (const d of declared) {
    const b = baseline(d.code)
    const incoming = byCode.get(d.code) ?? []
    const o: SubOverride = {}

    if (d.name !== b?.name) o.name = d.name
    if (d.kind !== (b?.kind ?? 'optional')) o.kind = d.kind
    if (!samePartList(incoming, b?.parts ?? [])) {
      o.parts = incoming
      subsChanged.push(d.code)
    }
    if (Object.keys(o).length) subs[d.code] = o

    if (!incoming.length) {
      warnings.push(
        b?.parts.length
          ? {
              code: 'W-SUB-EMPTIED',
              message: `${d.name} has no parts left in this file. Every machine carrying it will show an empty subassembly.`,
              where: `${SHEET.parts}:${d.code}`,
            }
          : {
              code: 'W-SUB-EMPTY',
              message: `${d.name} (${d.code}) has no parts on "${SHEET.parts}". It will show as an empty subassembly on every machine fitted with it.`,
              where: `${SHEET.parts}:${d.code}`,
            },
      )
    }
  }

  // A subassembly the workbook drops entirely. Permitted — a file that lacks a
  // row cannot be told from one that never had it — but never quiet about it.
  const subsAdded = declared.filter((d) => !subExists(d.code, ctx.overrides)).map((d) => d.code)
  const subsRemoved = subCodes(ctx.overrides).filter((c) => !declaredCodes.has(c))
  for (const code of subsRemoved) {
    const n = ctx.fleet.filter((u) => u.subs.includes(code)).length
    const p = partsFor(code, ctx.overrides).length
    warnings.push({
      code: 'W-SUB-DROPPED',
      message: `${subName(code, ctx.overrides)} (${code}) is not on "${SHEET.subassemblies}" in this file, so it is removed: ${n} machine${n === 1 ? '' : 's'} lose it and ${p} part${p === 1 ? '' : 's'} go with it.`,
      where: `${SHEET.subassemblies}:${code}`,
    })
  }

  const nextOverrides: Overrides = { subs, units: unitOverrides }

  // Records pointing at part ids the workbook drops. They stay in storage,
  // inert, and come back if the id ever returns — but say so out loud.
  let strandedRecords = 0
  for (const unit of ctx.fleet) {
    const fitted = unitOverrides[unit.id]?.subs ?? defaultSubs(unit.id)
    const live = new Set(
      fitted.flatMap((code) =>
        partsFor(code, nextOverrides).map((p) => recordKey(unit.id, `${code}:${partId(p)}`)),
      ),
    )
    for (const key of Object.keys(ctx.records)) {
      if (key.startsWith(`${unit.id}|`) && !live.has(key)) strandedRecords++
    }
  }

  const partsBefore = subCodes(ctx.overrides).reduce(
    (n, c) => n + partsFor(c, ctx.overrides).length,
    0,
  )
  const total = declared.reduce((n, d) => n + partsFor(d.code, nextOverrides).length, 0)

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
    subsAdded,
    subsRemoved,
    unitsChanged: Object.keys(unitOverrides),
    fitmentChanged,
    strandedRecords,
  }

  const plan: ImportPlan = {
    ok: true,
    errors,
    warnings,
    overrides: nextOverrides,
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
  const moved: string[] = []
  if (s.subsAdded.length) moved.push(`${s.subsAdded.length} added (${s.subsAdded.join(', ')})`)
  if (s.subsRemoved.length)
    moved.push(`${s.subsRemoved.length} removed (${s.subsRemoved.join(', ')})`)

  const bits = [
    `Replace all master data: ${s.partsBefore} parts become ${s.parts}`,
    ...(moved.length ? [`subassemblies ${moved.join(', ')}`] : []),
    s.subsChanged.length
      ? `${s.subsChanged.length} parts list${s.subsChanged.length > 1 ? 's' : ''} changed (${s.subsChanged.join(', ')})`
      : 'no parts list changed',
    s.unitsChanged.length
      ? `${s.unitsChanged.length} of ${fleetSize} machines changed`
      : 'no machine changed',
  ]
  return `${bits.join(' · ')}. This cannot be undone.`
}
