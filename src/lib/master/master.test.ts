import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BASE_FLEET, buildFleet } from '../fleet'
import { EMPTY_OVERRIDES, partId, partsFor } from '../overrides'
import { recordKey, resolveFleet } from '../records'
import type { Records } from '../types'
import { readXlsx } from '../xlsx/read'
import type { Workbook } from '../xlsx/read'
import { writeXlsx } from '../xlsx/write'
import { buildMasterSheets, exportFilename } from './export'
import { confirmText, validateWorkbook } from './import'
import { SHEET } from './schema'

const AT = '2026-07-31T21:00:00.000Z'

const sheetsFor = (overrides = EMPTY_OVERRIDES, records: Records = {}) => {
  const fleet = buildFleet(overrides)
  return buildMasterSheets({
    fleet,
    overrides,
    records,
    serialFor: (u, key) => u.lines.find((l) => l.key === key)?.serial ?? '',
    exportedAt: AT,
    appVersion: '0.1.0',
  })
}

const ctx = (records: Records = {}) => ({
  fleet: BASE_FLEET,
  overrides: EMPTY_OVERRIDES,
  records,
})

const roundTrip = async (overrides = EMPTY_OVERRIDES, records: Records = {}) =>
  readXlsx(writeXlsx(sheetsFor(overrides, records)))

/** Loads a fixture that has been through real Excel for Windows. */
const fixture = async (name: string): Promise<Workbook> =>
  readXlsx(new Uint8Array(readFileSync(join(import.meta.dirname, '__fixtures__', name))))

/** Rewrites one cell on a sheet, the way an admin editing in Excel would. */
function edit(wb: Workbook, sheet: string, row: number, header: string, value: string): Workbook {
  const rows = wb.get(sheet)!.map((r) => [...r])
  rows[row][rows[0].indexOf(header)] = value
  const out = new Map(wb)
  out.set(sheet, rows)
  return out
}

describe('the exported workbook', () => {
  it('has the seven sheets in reading order', () => {
    expect(sheetsFor().map((s) => s.name)).toEqual([
      SHEET.readme,
      SHEET.subassemblies,
      SHEET.parts,
      SHEET.variants,
      SHEET.units,
      SHEET.lines,
      SHEET.vue,
    ])
  })

  it('has a row per machine and a row per part', () => {
    const s = sheetsFor()
    const by = (name: string) => s.find((x) => x.name === name)!
    expect(by(SHEET.units).rows.length - 1).toBe(37)
    expect(by(SHEET.parts).rows.length - 1).toBe(26)
    expect(by(SHEET.lines).rows.length - 1).toBe(BASE_FLEET.reduce((n, u) => n + u.lines.length, 0))
  })

  it('carries the stable part id next to the editable part number', async () => {
    const wb = await roundTrip()
    const rows = wb.get(SHEET.parts)!
    const idAt = rows[0].indexOf('part_id')
    const numAt = rows[0].indexOf('part_number')
    const robot = rows.find((r) => r[numAt] === 'TX2-140')!
    expect(robot[idAt]).toBe('RB-6100-01')
  })

  it('marks fitment with an X per subassembly column', async () => {
    const wb = await roundTrip()
    const rows = wb.get(SHEET.units)!
    const at = (h: string) => rows[0].indexOf(h)
    const t53 = rows.find((r) => r[at('unit_id')] === 'T-53')!
    expect(t53[at('fit_VT')]).toBe('X')
    expect(t53[at('fit_VG')]).toBe('')
  })

  it('names the file by export date', () => {
    expect(exportFilename(AT)).toBe('unit-info-master-2026-07-31.xlsx')
  })
})

describe('round-tripping our own export', () => {
  it('is accepted', async () => {
    const plan = validateWorkbook(await roundTrip(), ctx())
    expect(plan.errors).toEqual([])
    expect(plan.ok).toBe(true)
  })

  it('produces no overrides when nothing was edited', async () => {
    // The workbook fully determines the result, but an untouched one must not
    // pin anything — otherwise the fleet stops tracking its source data.
    const plan = validateWorkbook(await roundTrip(), ctx())
    expect(plan.overrides.subs).toEqual({})
    expect(plan.overrides.units).toEqual({})
    expect(plan.summary.subsChanged).toEqual([])
  })

  it('rebuilds an identical fleet', async () => {
    const plan = validateWorkbook(await roundTrip(), ctx())
    const before = JSON.stringify(BASE_FLEET)
    expect(JSON.stringify(buildFleet(plan.overrides))).toBe(before)
  })

  it('survives a fleet that already carries admin edits', async () => {
    const overrides = {
      subs: { MG: { parts: partsFor('MG', EMPTY_OVERRIDES).slice(0, 2) } },
      units: { 'T-16': { vin: 'EDITED-VIN' } },
    }
    const plan = validateWorkbook(await roundTrip(overrides), ctx())
    expect(plan.ok).toBe(true)
    expect(buildFleet(plan.overrides).find((u) => u.id === 'T-16')!.vin).toBe('EDITED-VIN')
    expect(partsFor('MG', plan.overrides)).toHaveLength(2)
  })
})

describe('a workbook that has been through real Excel', () => {
  it('reads back with every sheet intact', async () => {
    const wb = await fixture('master-excel-roundtrip.xlsx')
    expect([...wb.keys()]).toEqual([
      SHEET.readme,
      SHEET.subassemblies,
      SHEET.parts,
      SHEET.variants,
      SHEET.units,
      SHEET.lines,
      SHEET.vue,
    ])
    expect(wb.get(SHEET.units)!.length - 1).toBe(37)
  })

  it('keeps pure-digit serials as text, not numbers', async () => {
    const wb = await fixture('master-excel-roundtrip.xlsx')
    const rows = wb.get(SHEET.units)!
    const at = (h: string) => rows[0].indexOf(h)
    const t16 = rows.find((r) => r[at('unit_id')] === 'T-16')!
    expect(t16[at('serial_front')]).toBe('27431')
    expect(t16[at('serial_loader')]).toBe('7725')
  })

  it('is accepted, and picks up the edit made inside Excel', async () => {
    const plan = validateWorkbook(await fixture('master-excel-roundtrip.xlsx'), ctx())
    expect(plan.errors).toEqual([])
    const front = partsFor('RG', plan.overrides).find((p) => partId(p) === 'DMF-1650-F')!
    expect(front.part).toBe('DMF-1650-F-REV-E')
    expect(front.desc).toBe('Front rail gear assembly, edited in Excel')
  })

  it('picks up a subassembly created inside Excel', async () => {
    // The fixture carries an HY row added on sheet 1, its part on sheet 2, and
    // a fit_HY column placed AFTER derived_line_count — which is what proves
    // the dynamic fit_ discovery does not depend on column position.
    const plan = validateWorkbook(await fixture('master-excel-roundtrip.xlsx'), ctx())
    expect(plan.errors).toEqual([])
    expect(plan.summary.subsAdded).toEqual(['HY'])
    const t16 = buildFleet(plan.overrides).find((u) => u.id === 'T-16')!
    expect(t16.subs).toContain('HY')
    expect(t16.lines.find((l) => l.sub === 'HY')!.part).toBe('HY-8100-01')
    expect(t16.lines.find((l) => l.sub === 'HY')!.subName).toBe('Hydraulics')
  })

  it('puts the fit column after the derived columns, and still reads it', async () => {
    const wb = await fixture('master-excel-roundtrip.xlsx')
    const header = wb.get(SHEET.units)![0]
    expect(header.indexOf('fit_HY')).toBeGreaterThan(header.indexOf('derived_line_count'))
  })

  it('keeps records attached when a part number is renamed in Excel', async () => {
    // The whole point of part_id. The record was captured against the line key
    // before the rename and must still resolve after it.
    const key = recordKey('T-16', 'RG:DMF-1650-F')
    const records: Records = { [key]: { serial: 'FIELD-9001' } }
    const plan = validateWorkbook(await fixture('master-excel-roundtrip.xlsx'), ctx(records))
    const fleet = buildFleet(plan.overrides)
    const unit = fleet.find((u) => u.id === 'T-16')!
    expect(unit.lines.find((l) => l.key === 'RG:DMF-1650-F')!.part).toBe('DMF-1650-F-REV-E')
    expect(resolveFleet(fleet, records).resolved.get(key)!.serial).toBe('FIELD-9001')
    expect(plan.summary.strandedRecords).toBe(0)
  })
})

describe('rejecting a workbook', () => {
  const expectError = (plan: ReturnType<typeof validateWorkbook>, code: string) => {
    expect(plan.ok).toBe(false)
    expect(plan.errors.map((e) => e.code)).toContain(code)
  }

  it('turns away a spreadsheet this app did not write', async () => {
    const wb = await readXlsx(writeXlsx([{ name: 'Sheet1', columns: [{ width: 10 }], rows: [['a']] }]))
    expectError(validateWorkbook(wb, ctx()), 'E-META-MISSING')
  })

  it('turns away a workbook whose app tag is wrong', async () => {
    const wb = edit(await roundTrip(), SHEET.readme, 1, 'value', 'Some Other App')
    expectError(validateWorkbook(wb, ctx()), 'E-META-MISSING')
  })

  it('turns away an unknown schema version', async () => {
    const wb = edit(await roundTrip(), SHEET.readme, 2, 'value', 'master-data/99')
    expectError(validateWorkbook(wb, ctx()), 'E-SCHEMA-UNKNOWN')
  })

  it('turns away a workbook missing a required sheet', async () => {
    const wb = new Map(await roundTrip())
    wb.delete(SHEET.parts)
    expectError(validateWorkbook(wb, ctx()), 'E-SHEET-MISSING')
  })

  it('turns away a renamed column', async () => {
    const wb = edit(await roundTrip(), SHEET.parts, 0, 'part_number', 'partnumber')
    expectError(validateWorkbook(wb, ctx()), 'E-COLUMN-MISSING')
  })

  it('turns away an unknown subassembly code', async () => {
    const wb = edit(await roundTrip(), SHEET.parts, 1, 'sub_code', 'XX')
    expectError(validateWorkbook(wb, ctx()), 'E-SUB-UNKNOWN')
  })

  it('turns away a blank part number', async () => {
    const wb = edit(await roundTrip(), SHEET.parts, 1, 'part_number', '')
    expectError(validateWorkbook(wb, ctx()), 'E-PART-BLANK')
  })

  it('turns away a duplicated part id', async () => {
    const wb = edit(await roundTrip(), SHEET.parts, 2, 'part_id', 'DMF-1650-F')
    expectError(validateWorkbook(wb, ctx()), 'E-PART-DUPLICATE')
  })

  it('turns away an unknown serial slot', async () => {
    const wb = edit(await roundTrip(), SHEET.parts, 1, 'serial_slot', 'middle')
    expectError(validateWorkbook(wb, ctx()), 'E-SLOT-UNKNOWN')
  })

  it('turns away a machine that is not in the fleet', async () => {
    const wb = edit(await roundTrip(), SHEET.units, 1, 'unit_id', 'T-999')
    expectError(validateWorkbook(wb, ctx()), 'E-UNIT-UNKNOWN')
  })

  it('turns away a deleted machine rather than silently reverting it', async () => {
    const wb = new Map(await roundTrip())
    wb.set(SHEET.units, wb.get(SHEET.units)!.slice(0, -1))
    expectError(validateWorkbook(wb, ctx()), 'E-ROSTER-INCOMPLETE')
  })

  it('turns away a variant pointing at a part that is not there', async () => {
    const wb = edit(await roundTrip(), SHEET.variants, 1, 'part_id', 'NOT-A-PART')
    expectError(validateWorkbook(wb, ctx()), 'E-VARIANT-ORPHAN')
  })

  it('writes nothing when it rejects', async () => {
    const wb = edit(await roundTrip(), SHEET.parts, 1, 'part_number', '')
    const plan = validateWorkbook(wb, ctx())
    expect(plan.overrides).toEqual({ subs: {}, units: {} })
  })
})

describe('editing through the workbook', () => {
  it('applies a description change to every machine carrying the part', async () => {
    const wb = edit(await roundTrip(), SHEET.parts, 1, 'description', 'Front gear, 2026 spec')
    const plan = validateWorkbook(wb, ctx())
    expect(plan.ok).toBe(true)
    const fleet = buildFleet(plan.overrides)
    for (const id of ['T-16', 'T-55', 'T-57']) {
      const line = fleet.find((u) => u.id === id)!.lines.find((l) => l.key === 'RG:DMF-1650-F')!
      expect(line.desc).toBe('Front gear, 2026 spec')
    }
  })

  it('deletes a part when its row is removed', async () => {
    const wb = new Map(await roundTrip())
    const rows = wb.get(SHEET.parts)!
    wb.set(
      SHEET.parts,
      rows.filter((r, i) => i === 0 || r[rows[0].indexOf('part_id')] !== 'DMF-1650-WH'),
    )
    const plan = validateWorkbook(wb, ctx())
    expect(plan.ok).toBe(true)
    expect(partsFor('RG', plan.overrides).map(partId)).not.toContain('DMF-1650-WH')
    expect(plan.summary.subsChanged).toContain('RG')
  })

  it('warns when a deletion strands captured records', async () => {
    const records: Records = { [recordKey('T-16', 'RG:DMF-1650-WH')]: { status: 'verified' } }
    const wb = new Map(await roundTrip())
    const rows = wb.get(SHEET.parts)!
    wb.set(
      SHEET.parts,
      rows.filter((r, i) => i === 0 || r[rows[0].indexOf('part_id')] !== 'DMF-1650-WH'),
    )
    const plan = validateWorkbook(wb, ctx(records))
    expect(plan.summary.strandedRecords).toBe(1)
    expect(plan.warnings.map((w) => w.code)).toContain('W-RECORDS-STRANDED')
  })

  it('changes fitment from an X', async () => {
    const wb = edit(await roundTrip(), SHEET.units, 1, 'fit_CV', 'X')
    const plan = validateWorkbook(wb, ctx())
    expect(plan.ok).toBe(true)
    const rows = (await roundTrip()).get(SHEET.units)!
    const editedId = rows[1][rows[0].indexOf('unit_id')]
    expect(buildFleet(plan.overrides).find((u) => u.id === editedId)!.subs).toContain('CV')
  })

  it('accepts a lowercase x or a tick as a fitment mark', async () => {
    for (const mark of ['x', '✓', 'yes']) {
      const wb = edit(await roundTrip(), SHEET.units, 1, 'fit_CV', mark)
      expect(validateWorkbook(wb, ctx()).summary.fitmentChanged).toBe(1)
    }
  })

  it('adds a part from a row with no part_id', async () => {
    const wb = new Map(await roundTrip())
    const rows = [...wb.get(SHEET.parts)!]
    const at = (h: string) => rows[0].indexOf(h)
    const row = Array(rows[0].length).fill('')
    row[at('sub_code')] = 'MG'
    row[at('part_number')] = 'MG-3400-01'
    row[at('description')] = 'Magnet cable reel'
    row[at('rev')] = 'A'
    rows.push(row)
    wb.set(SHEET.parts, rows)
    const plan = validateWorkbook(wb, ctx())
    expect(plan.ok).toBe(true)
    const added = partsFor('MG', plan.overrides).find((p) => p.part === 'MG-3400-01')!
    expect(added.desc).toBe('Magnet cable reel')
    expect(partId(added)).toBe('MG-MG-3400-01')
  })

  it('ignores edits to a read-only sheet', async () => {
    // "5 Unit Lines (read-only)" is a reference view of the other sheets.
    const wb = edit(await roundTrip(), SHEET.lines, 1, 'part_number', 'NOT-A-REAL-EDIT')
    const plan = validateWorkbook(wb, ctx())
    expect(plan.ok).toBe(true)
    expect(plan.overrides.subs).toEqual({})
  })

  it('renames a subassembly from sheet 1', async () => {
    const wb = edit(await roundTrip(), SHEET.subassemblies, 1, 'name', 'Rail Gear — 2026 spec')
    const plan = validateWorkbook(wb, ctx())
    expect(plan.ok).toBe(true)
    expect(plan.overrides.subs.RG).toEqual({ name: 'Rail Gear — 2026 spec' })
    // A rename must not pin the parts list — it keeps tracking source.
    expect(plan.overrides.subs.RG.parts).toBeUndefined()
    expect(buildFleet(plan.overrides)[0].lines[0].subName).toBe('Rail Gear — 2026 spec')
  })

  it('ignores edits to a derived column', async () => {
    const wb = edit(await roundTrip(), SHEET.parts, 1, 'derived_units_fitted', '999')
    const plan = validateWorkbook(wb, ctx())
    expect(plan.ok).toBe(true)
    expect(plan.overrides.subs).toEqual({})
  })

  it('survives the columns being reordered in Excel', async () => {
    const wb = new Map(await roundTrip())
    const rows = wb.get(SHEET.parts)!.map((r) => [...r].reverse())
    wb.set(SHEET.parts, rows)
    const plan = validateWorkbook(wb, ctx())
    expect(plan.errors).toEqual([])
    expect(plan.overrides.subs).toEqual({})
  })
})

/** Adds a row to a sheet, padded to the header width. */
function addRow(wb: Workbook, sheet: string, cells: Record<string, string>): Workbook {
  const rows = wb.get(sheet)!.map((r) => [...r])
  const row = Array(rows[0].length).fill('')
  for (const [header, value] of Object.entries(cells)) row[rows[0].indexOf(header)] = value
  rows.push(row)
  const out = new Map(wb)
  out.set(sheet, rows)
  return out
}

/** Appends a column with a value on one unit's row. */
function addFitColumn(wb: Workbook, header: string, unitId: string, mark: string): Workbook {
  const rows = wb.get(SHEET.units)!.map((r) => [...r])
  const idAt = rows[0].indexOf('unit_id')
  rows.forEach((r, i) => r.push(i === 0 ? header : r[idAt] === unitId ? mark : ''))
  const out = new Map(wb)
  out.set(SHEET.units, rows)
  return out
}

const withHydraulics = async () => {
  let wb = await roundTrip()
  wb = addRow(wb, SHEET.subassemblies, { sub_code: 'HY', name: 'Hydraulics', kind: 'optional' })
  wb = addRow(wb, SHEET.parts, {
    sub_code: 'HY',
    part_number: 'HY-8100-01',
    description: 'Hydraulic pump, main',
    rev: 'A',
    location: 'Deck / power pack',
  })
  return wb
}

describe('creating a subassembly through the workbook', () => {
  it('accepts a new row plus its parts and a fit column', async () => {
    const wb = addFitColumn(await withHydraulics(), 'fit_HY', 'T-16', 'X')
    const plan = validateWorkbook(wb, ctx())
    expect(plan.errors).toEqual([])
    expect(plan.summary.subsAdded).toEqual(['HY'])
    const t16 = buildFleet(plan.overrides).find((u) => u.id === 'T-16')!
    expect(t16.subs).toContain('HY')
    expect(t16.lines.find((l) => l.sub === 'HY')!.part).toBe('HY-8100-01')
    expect(t16.lines.find((l) => l.sub === 'HY')!.subName).toBe('Hydraulics')
  })

  it('names it in the confirmation line', async () => {
    const wb = addFitColumn(await withHydraulics(), 'fit_HY', 'T-16', 'X')
    expect(validateWorkbook(wb, ctx()).confirm).toContain('1 added (HY)')
  })

  it('accepts a lowercase fit column header', async () => {
    const wb = addFitColumn(await withHydraulics(), 'fit_hy', 'T-16', 'X')
    const plan = validateWorkbook(wb, ctx())
    expect(plan.errors).toEqual([])
    expect(buildFleet(plan.overrides).find((u) => u.id === 'T-16')!.subs).toContain('HY')
  })

  it('warns rather than rejects when the new subassembly has no fit column yet', async () => {
    const plan = validateWorkbook(await withHydraulics(), ctx())
    expect(plan.ok).toBe(true)
    expect(plan.warnings.map((w) => w.code)).toContain('W-FIT-COLUMN-MISSING')
    expect(buildFleet(plan.overrides).some((u) => u.subs.includes('HY'))).toBe(false)
  })

  it('warns when a new subassembly has no parts', async () => {
    let wb = await roundTrip()
    wb = addRow(wb, SHEET.subassemblies, { sub_code: 'HY', name: 'Hydraulics', kind: 'optional' })
    const plan = validateWorkbook(wb, ctx())
    expect(plan.ok).toBe(true)
    expect(plan.warnings.map((w) => w.code)).toContain('W-SUB-EMPTY')
  })

  it('does not fit it to anything on its own', async () => {
    const plan = validateWorkbook(await withHydraulics(), ctx())
    expect(plan.overrides.units).toEqual({})
  })
})

describe('rejecting a bad subassembly sheet', () => {
  const expectError = (plan: ReturnType<typeof validateWorkbook>, code: string) => {
    expect(plan.ok).toBe(false)
    expect(plan.errors.map((e) => e.code)).toContain(code)
  }

  it('turns away a blank code', async () => {
    const wb = edit(await roundTrip(), SHEET.subassemblies, 1, 'sub_code', '')
    expectError(validateWorkbook(wb, ctx()), 'E-SUB-CODE-BLANK')
  })

  it('turns away a malformed code', async () => {
    for (const bad of ['HYDRAULICS', '1X', 'H']) {
      const wb = edit(await roundTrip(), SHEET.subassemblies, 1, 'sub_code', bad)
      expectError(validateWorkbook(wb, ctx()), 'E-SUB-CODE-INVALID')
    }
  })

  it('turns away a duplicated code', async () => {
    const wb = edit(await roundTrip(), SHEET.subassemblies, 2, 'sub_code', 'RG')
    expectError(validateWorkbook(wb, ctx()), 'E-SUB-DUPLICATE')
  })

  it('turns away a blank name', async () => {
    const wb = edit(await roundTrip(), SHEET.subassemblies, 1, 'name', '')
    expectError(validateWorkbook(wb, ctx()), 'E-SUB-NAME-BLANK')
  })

  it('turns away an unknown kind', async () => {
    const wb = edit(await roundTrip(), SHEET.subassemblies, 1, 'kind', 'optionel')
    expectError(validateWorkbook(wb, ctx()), 'E-SUB-KIND-UNKNOWN')
  })

  it('turns away an empty subassembly sheet', async () => {
    const wb = new Map(await roundTrip())
    wb.set(SHEET.subassemblies, [wb.get(SHEET.subassemblies)![0]])
    expectError(validateWorkbook(wb, ctx()), 'E-SUB-NONE')
  })

  it('turns away a part on a subassembly the sheet does not declare', async () => {
    const wb = addRow(await roundTrip(), SHEET.parts, {
      sub_code: 'HY',
      part_number: 'HY-1',
      description: 'orphan',
    })
    expectError(validateWorkbook(wb, ctx()), 'E-SUB-UNKNOWN')
  })

  it('turns away a fit column for an undeclared subassembly', async () => {
    const wb = addFitColumn(await roundTrip(), 'fit_HY', 'T-16', 'X')
    expectError(validateWorkbook(wb, ctx()), 'E-FIT-COLUMN-UNKNOWN')
  })

  it('turns away a duplicated fit column', async () => {
    const wb = addFitColumn(await roundTrip(), 'fit_RG', 'T-16', 'X')
    expectError(validateWorkbook(wb, ctx()), 'E-FIT-COLUMN-DUPLICATE')
  })

  it('turns away a deleted fit column for a subassembly machines carry', async () => {
    const wb = new Map(await roundTrip())
    const rows = wb.get(SHEET.units)!
    const at = rows[0].indexOf('fit_RG')
    wb.set(
      SHEET.units,
      rows.map((r) => r.filter((_, i) => i !== at)),
    )
    const plan = validateWorkbook(wb, ctx())
    expectError(plan, 'E-FIT-COLUMN-MISSING')
    expect(plan.overrides).toEqual({ subs: {}, units: {} })
  })
})

describe('dropping a subassembly through the workbook', () => {
  /** Removes CV entirely: its sheet-1 row, its parts, and its fit column. */
  const withoutConveyor = async () => {
    const wb = new Map(await roundTrip())
    const subs = wb.get(SHEET.subassemblies)!
    wb.set(
      SHEET.subassemblies,
      subs.filter((r, i) => i === 0 || r[subs[0].indexOf('sub_code')] !== 'CV'),
    )
    const parts = wb.get(SHEET.parts)!
    wb.set(
      SHEET.parts,
      parts.filter((r, i) => i === 0 || r[parts[0].indexOf('sub_code')] !== 'CV'),
    )
    const units = wb.get(SHEET.units)!
    const at = units[0].indexOf('fit_CV')
    wb.set(
      SHEET.units,
      units.map((r) => r.filter((_, i) => i !== at)),
    )
    return wb
  }

  it('is permitted, warned about, and takes it off every machine', async () => {
    const plan = validateWorkbook(await withoutConveyor(), ctx())
    expect(plan.errors).toEqual([])
    expect(plan.warnings.map((w) => w.code)).toContain('W-SUB-DROPPED')
    expect(plan.summary.subsRemoved).toEqual(['CV'])
    expect(buildFleet(plan.overrides).some((u) => u.subs.includes('CV'))).toBe(false)
  })

  it('rejects a half-done removal that leaves the parts behind', async () => {
    const wb = new Map(await roundTrip())
    const subs = wb.get(SHEET.subassemblies)!
    wb.set(
      SHEET.subassemblies,
      subs.filter((r, i) => i === 0 || r[subs[0].indexOf('sub_code')] !== 'CV'),
    )
    const plan = validateWorkbook(wb, ctx())
    expect(plan.ok).toBe(false)
    expect(plan.errors.map((e) => e.code)).toContain('E-SUB-UNKNOWN')
  })
})

describe('the confirmation an admin sees', () => {
  it('states the scale of the replacement and that it cannot be undone', async () => {
    const wb = edit(await roundTrip(), SHEET.parts, 1, 'description', 'changed')
    const text = confirmText(validateWorkbook(wb, ctx()), 37)
    expect(text).toContain('26 parts become 26')
    expect(text).toContain('cannot be undone')
  })
})
