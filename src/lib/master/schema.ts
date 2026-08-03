/**
 * The master-data workbook contract. Imported by BOTH export and import so the
 * two cannot drift.
 *
 * Two rules make the workbook self-documenting, and the importer enforces them
 * rather than keeping a second list in its head:
 *   - a sheet whose name ends "(read-only)" is never read back
 *   - a column whose header starts "derived_" is never read back
 */
import type { SubCode } from '../types'

export const APP_TAG = 'Unit Info'
export const SCHEMA_VERSION = 'master-data/1'

export const SHEET = {
  readme: '0 Read Me',
  subassemblies: '1 Subassemblies (read-only)',
  parts: '2 Parts',
  variants: '3 Part Variants',
  units: '4 Units',
  lines: '5 Unit Lines (read-only)',
  vue: '6 Vue Licences (read-only)',
} as const

/** Tab order, and the order rows are emitted in. Not the sheet's row order —
 *  `unit.subs` order matters to the UI and must not depend on a sortable sheet. */
export const SUB_ORDER: SubCode[] = ['RG', 'LD', 'MG', 'VT', 'VG', 'RB', 'CV']

export const isReadOnlySheet = (name: string): boolean => name.trim().endsWith('(read-only)')
export const isDerivedColumn = (header: string): boolean => header.trim().startsWith('derived_')

export interface Column {
  header: string
  width: number
  locked?: boolean
  wrap?: boolean
}

const derived = (header: string, width: number): Column => ({ header, width, locked: true })

export const PARTS_COLUMNS: Column[] = [
  { header: 'sub_code', width: 10 },
  { header: 'part_id', width: 18, locked: true },
  { header: 'part_number', width: 22 },
  { header: 'description', width: 46, wrap: true },
  { header: 'rev', width: 7 },
  { header: 'location', width: 26 },
  { header: 'serial_slot', width: 13 },
  { header: 'spec', width: 40, wrap: true },
  derived('derived_sub_name', 26),
  derived('derived_units_fitted', 16),
  derived('derived_records_captured', 20),
]

export const VARIANTS_COLUMNS: Column[] = [
  { header: 'sub_code', width: 10 },
  { header: 'part_id', width: 18, locked: true },
  { header: 'vue_rev', width: 9 },
  { header: 'variant', width: 34 },
  derived('derived_part_number', 22),
]

export const UNITS_COLUMNS: Column[] = [
  { header: 'unit_id', width: 10 },
  { header: 'chassis_vin', width: 22 },
  { header: 'serial_front', width: 14 },
  { header: 'serial_rear', width: 14 },
  { header: 'serial_loader', width: 15 },
  ...SUB_ORDER.map((code) => ({ header: `fit_${code}`, width: 8 })),
  derived('derived_serial_vue', 20),
  derived('derived_vue_rev', 14),
  derived('derived_line_count', 15),
]

export const SUBASSEMBLIES_COLUMNS: Column[] = [
  { header: 'sub_code', width: 10 },
  { header: 'name', width: 30 },
  { header: 'kind', width: 11 },
  { header: 'derived_part_count', width: 16 },
  { header: 'derived_units_fitted', width: 16 },
]

export const LINES_COLUMNS: Column[] = [
  { header: 'unit_id', width: 10 },
  { header: 'sub_code', width: 10 },
  { header: 'subassembly', width: 28 },
  { header: 'part_id', width: 18 },
  { header: 'part_number', width: 22 },
  { header: 'description', width: 46, wrap: true },
  { header: 'rev', width: 7 },
  { header: 'location', width: 26 },
  { header: 'serial', width: 20 },
  { header: 'record_key', width: 34 },
]

export const VUE_COLUMNS: Column[] = [
  { header: 'vue_serial', width: 20 },
  { header: 'licence', width: 17 },
  { header: 'revision', width: 10 },
  { header: 'notes', width: 30, wrap: true },
  { header: 'location_estimate', width: 18 },
  { header: 'location_confirmed', width: 19 },
  { header: 'derived_on_machine', width: 18 },
]

export const README_COLUMNS: Column[] = [
  { header: 'field', width: 22, locked: true },
  { header: 'value', width: 46 },
  { header: 'notes', width: 74, wrap: true },
]

/** The `serial_slot` values a part may carry. Empty means "carries no serial". */
export const SERIAL_SLOTS = ['front', 'rear', 'loader', 'vue'] as const

/** Truthy marks accepted in a fit_* cell, so a human typing "x" or "yes" works. */
const FIT_TRUE = new Set(['x', 'X', 'yes', 'YES', 'y', 'Y', 'true', 'TRUE', '1', '✓'])
export const isFitted = (cell: string): boolean => FIT_TRUE.has(cell.trim())
export const FIT_MARK = 'X'

/**
 * Maps header name -> column index for a sheet's header row, so a user
 * reordering columns in Excel cannot break the import.
 */
export function headerIndex(headerRow: string[]): Map<string, number> {
  const out = new Map<string, number>()
  headerRow.forEach((h, i) => {
    const key = h.trim()
    if (key && !out.has(key)) out.set(key, i)
  })
  return out
}

/** The columns an importer must find on a sheet, ignoring derived ones. */
export const requiredHeaders = (columns: Column[]): string[] =>
  columns.filter((c) => !isDerivedColumn(c.header)).map((c) => c.header)
