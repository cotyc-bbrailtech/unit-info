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
    expect(plan.overrides.parts).toEqual({})
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
      parts: { MG: partsFor('MG', EMPTY_OVERRIDES).slice(0, 2) },
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
    expect(plan.overrides).toEqual({ parts: {}, units: {} })
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
    const wb = edit(await roundTrip(), SHEET.subassemblies, 1, 'name', 'Renamed Subassembly')
    const plan = validateWorkbook(wb, ctx())
    expect(plan.ok).toBe(true)
    expect(plan.overrides.parts).toEqual({})
  })

  it('ignores edits to a derived column', async () => {
    const wb = edit(await roundTrip(), SHEET.parts, 1, 'derived_units_fitted', '999')
    const plan = validateWorkbook(wb, ctx())
    expect(plan.ok).toBe(true)
    expect(plan.overrides.parts).toEqual({})
  })

  it('survives the columns being reordered in Excel', async () => {
    const wb = new Map(await roundTrip())
    const rows = wb.get(SHEET.parts)!.map((r) => [...r].reverse())
    wb.set(SHEET.parts, rows)
    const plan = validateWorkbook(wb, ctx())
    expect(plan.errors).toEqual([])
    expect(plan.overrides.parts).toEqual({})
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
