/**
 * The master-data workbook contract. Imported by BOTH export and import so the
 * two cannot drift.
 *
 * Two rules make the workbook self-documenting, and the importer enforces them
 * rather than keeping a second list in its head:
 *   - a sheet whose name ends "(read-only)" is never read back
 *   - a column whose header starts "derived_" is never read back
 */
export const APP_TAG = 'Unit Info'

/**
 * Bumped whenever a sheet becomes editable or its columns change, because an
 * older workbook imported under newer rules would be read as editable where its
 * own Read Me said it was not. v2 opened "1 Subassemblies" and made the fit_
 * columns dynamic; v3 added "7 Machine Revisions"; v4 opens "6 Vue Licences"
 * and replaces its estimate/confirmed pair with a single `location`.
 */
export const SCHEMA_VERSION = 'master-data/4'

/**
 * Schemas this build still reads. Only sheet 6 changed between v3 and v4, and a
 * v3 file's sheet 6 was read-only anyway — so a v3 workbook carries no Vue
 * assignments but every other sheet is byte-identical. Refusing it would strand
 * work that exists nowhere else, which is the opposite of the point of having
 * an export. Read v3, warn, and let the next export carry it forward as v4.
 */
export const READABLE_SCHEMAS: readonly string[] = [SCHEMA_VERSION, 'master-data/3']

export const SHEET = {
  readme: '0 Read Me',
  subassemblies: '1 Subassemblies',
  parts: '2 Parts',
  variants: '3 Part Variants',
  units: '4 Units',
  lines: '5 Unit Lines (read-only)',
  vue: '6 Vue Licences',
  unitRevs: '7 Machine Revisions',
} as const

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

const UNITS_FIXED_COLUMNS: Column[] = [
  { header: 'unit_id', width: 10 },
  { header: 'chassis_vin', width: 22 },
  { header: 'serial_front', width: 14 },
  { header: 'serial_rear', width: 14 },
  { header: 'serial_loader', width: 15 },
]

const UNITS_DERIVED_COLUMNS: Column[] = [
  derived('derived_serial_vue', 20),
  derived('derived_vue_rev', 14),
  derived('derived_line_count', 15),
]

export const FIT_PREFIX = 'fit_'
export const fitHeader = (code: string): string => `${FIT_PREFIX}${code}`

/** `"fit_HY"` -> `"HY"`. null for any other header. Case-insensitive. */
export function fitCode(header: string): string | null {
  const h = header.trim()
  if (h.length <= FIT_PREFIX.length) return null
  if (h.slice(0, FIT_PREFIX.length).toLowerCase() !== FIT_PREFIX) return null
  return h.slice(FIT_PREFIX.length).trim().toUpperCase()
}

/**
 * The fit_ block is dynamic — this module no longer knows which subassemblies
 * exist. Both the block and sheet 1 derive from one runtime list, so they
 * cannot drift.
 */
export const unitsColumns = (codes: string[]): Column[] => [
  ...UNITS_FIXED_COLUMNS,
  ...codes.map((code) => ({ header: fitHeader(code), width: Math.max(8, code.length + 6) })),
  ...UNITS_DERIVED_COLUMNS,
]

/** Editable in v2: `name` and `kind`. `sub_code` is identity. */
export const SUBASSEMBLIES_COLUMNS: Column[] = [
  { header: 'sub_code', width: 10 },
  { header: 'name', width: 30 },
  { header: 'kind', width: 11 },
  { header: 'derived_part_count', width: 16 },
  { header: 'derived_units_fitted', width: 16 },
]

export const SUB_KINDS = ['common', 'optional'] as const

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

/**
 * Editable in v4. `location` IS the assignment: a machine id fits Vision to
 * that machine and gives it this system's serial and revision. The sheet's
 * original estimate/confirmed pair collapses into one derived column, so the
 * admin still sees what the source notes claimed without a precedence rule to
 * get wrong.
 */
export const VUE_COLUMNS: Column[] = [
  { header: 'vue_serial', width: 20 },
  { header: 'licence', width: 17 },
  { header: 'revision', width: 10 },
  { header: 'location', width: 20 },
  { header: 'notes', width: 30, wrap: true },
  derived('derived_location_source', 22),
  derived('derived_sheet_location', 20),
  derived('derived_fits', 10),
]

export const VUE_LICENCE_VALUES = [
  'Tie Detection',
  'VGR premium',
  'VGR enterprise',
  // A VGR system whose tier was never recorded. Blank means "licence unknown"
  // and fits nothing; this fits Vision — VGR without inventing an entitlement.
  'VGR',
] as const

/**
 * Sparse and editable: one row per machine that carries a different revision of
 * a part from the master list. A machine with no row simply follows the master
 * part (or its Vue revision). Deleting a row, or blanking its rev, puts the
 * machine back.
 */
export const UNIT_REVS_COLUMNS: Column[] = [
  { header: 'unit_id', width: 10 },
  { header: 'sub_code', width: 10 },
  { header: 'part_id', width: 18 },
  { header: 'rev', width: 8 },
  derived('derived_part_number', 22),
  derived('derived_master_rev', 18),
  derived('derived_subassembly', 26),
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
