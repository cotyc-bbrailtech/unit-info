/**
 * Builds the master-data workbook. `buildMasterSheets` is pure and fully
 * testable without touching a byte of zip.
 */
import { VUE_UNITS, isOnMachine, locationOf } from '../vue'
import { partId, partsFor, recordsFor, subCodes, subDef, subName, unitsWith } from '../overrides'
import { recordKey } from '../records'
import type { Overrides } from '../overrides'
import type { Records, Unit } from '../types'
import type { SheetSpec } from '../xlsx/write'
import {
  APP_TAG,
  LINES_COLUMNS,
  PARTS_COLUMNS,
  README_COLUMNS,
  SCHEMA_VERSION,
  SHEET,
  SUBASSEMBLIES_COLUMNS,
  UNIT_REVS_COLUMNS,
  unitsColumns,
  VARIANTS_COLUMNS,
  VUE_COLUMNS,
  FIT_MARK,
} from './schema'
import type { Column } from './schema'

const sheet = (name: string, columns: Column[], body: string[][], freeze = true): SheetSpec => ({
  name,
  columns: columns.map((c) => ({ width: c.width, locked: c.locked, wrap: c.wrap })),
  rows: [columns.map((c) => c.header), ...body],
  freezeHeader: freeze,
})

export interface ExportInput {
  fleet: Unit[]
  overrides: Overrides
  records: Records
  /** Serial resolved per line, for the read-only lines sheet. */
  serialFor: (unit: Unit, lineKey: string) => string
  exportedAt: string
  appVersion: string
}

export function buildMasterSheets(input: ExportInput): SheetSpec[] {
  const { fleet, overrides, records, exportedAt, appVersion } = input
  const codes = subCodes(overrides)

  const partsRows: string[][] = []
  const variantRows: string[][] = []
  for (const code of codes) {
    const fitted = unitsWith(code, fleet).length
    const name = subName(code, overrides)
    for (const p of partsFor(code, overrides)) {
      const id = partId(p)
      partsRows.push([
        code,
        id,
        p.part,
        p.desc,
        p.rev,
        p.loc,
        p.slot ?? '',
        p.spec ?? '',
        name,
        String(fitted),
        String(recordsFor(code, id, fleet, records)),
      ])
      for (const [rev, variant] of Object.entries(p.byRev ?? {})) {
        variantRows.push([code, id, rev, variant, p.part])
      }
    }
  }

  const subRows = codes.map((code) => {
    const s = subDef(code, overrides)
    return [
      code,
      s.name,
      s.kind,
      String(s.parts.length),
      String(unitsWith(code, fleet).length),
    ]
  })

  const unitRows = fleet.map((u) => [
    u.id,
    u.vin,
    u.serials.front,
    u.serials.rear,
    u.serials.loader,
    ...codes.map((code) => (u.subs.includes(code) ? FIT_MARK : '')),
    u.serials.vue,
    u.vueRev ?? '',
    String(u.lines.length),
  ])

  const lineRows = fleet.flatMap((u) =>
    u.lines.map((l) => [
      u.id,
      l.sub,
      l.subName,
      partId(l),
      l.part,
      l.desc,
      l.rev,
      l.loc,
      input.serialFor(u, l.key),
      recordKey(u.id, l.key),
    ]),
  )

  // Sparse: only the machines that actually differ from the master list.
  const unitRevRows = fleet.flatMap((u) =>
    Object.entries(u.revs ?? {}).flatMap(([lineKey, rev]) => {
      const line = u.lines.find((l) => l.key === lineKey)
      const [subCode, id] = [lineKey.slice(0, lineKey.indexOf(':')), lineKey.slice(lineKey.indexOf(':') + 1)]
      const master = partsFor(subCode, overrides).find((p) => partId(p) === id)
      // A revision pinned to a part or subassembly that no longer exists is
      // kept rather than dropped, so an export never silently loses one.
      return [
        [
          u.id,
          subCode,
          id,
          rev,
          line?.part ?? master?.part ?? '',
          master?.rev ?? '',
          subName(subCode, overrides),
        ],
      ]
    }),
  )

  const vueRows = VUE_UNITS.map((v) => [
    v.serial,
    v.license,
    v.rev,
    v.notes,
    v.locationEstimate,
    v.locationConfirmed,
    isOnMachine(v) ? locationOf(v) : '',
  ])

  const readmeRows: string[][] = [
    ['app', APP_TAG, 'Provenance. The importer rejects any workbook without this exact value.'],
    ['schema_version', SCHEMA_VERSION, 'Bumped when the sheet or column contract changes.'],
    ['app_version', appVersion, 'The app build that produced this file.'],
    ['exported_at', exportedAt, ''],
    [
      'import_semantics',
      'replace outright',
      'On import these sheets BECOME the master data. A part or a fitment mark absent from this file is removed. There is no undo — export first if you want a way back.',
    ],
    [
      'roster_source',
      'src/data/units.csv',
      'The 37 machines are fixed. Import cannot add or remove a machine; deleting a row on "4 Units" is rejected rather than silently reverting it.',
    ],
    [
      'identity_columns',
      'unit_id, sub_code, part_id',
      'Never edit these. part_id is what audit records are keyed to, so changing it detaches every serial and note already captured against that part. Change part_number instead — that is the human-facing number and is safe to edit. sub_code is part of every record key too, so changing a subassembly code detaches everything captured under it — edit its name instead.',
    ],
    [
      'read_only_sheets',
      'names ending "(read-only)"',
      'Shown for reference and never read back. Edit them freely; nothing happens.',
    ],
    [
      'read_only_columns',
      'headers starting "derived_"',
      'Computed from the other sheets. Never read back.',
    ],
    [
      'editable',
      'sheets 1, 2, 3, 4 and 7',
      '1 Subassemblies (which subassemblies exist, and their names), 2 Parts (the master parts lists), 3 Part Variants (revision-dependent parts), 4 Units (VIN, imported serials, and which subassemblies each machine carries), 7 Machine Revisions (a revision for one machine only).',
    ],
    [
      'how_to_add_a_subassembly',
      `add a row on "${SHEET.subassemblies}"`,
      'Give it a code of 2 to 4 characters starting with a letter, a name, and kind common or optional. Add its parts on "2 Parts" with the same sub_code. The fit_ column for marking machines appears on "4 Units" the next time you export.',
    ],
    [
      'how_to_add_a_part',
      'add a row on "2 Parts"',
      'Leave part_id blank and one is generated. Set sub_code to an existing code from "1 Subassemblies".',
    ],
    [
      'how_to_remove_a_part',
      'delete the row on "2 Parts"',
      'Audit records already captured against it are left in place, inert, and return if the part_id ever comes back.',
    ],
    ['subassembly_count', String(codes.length), ''],
    ['part_count', String(partsRows.length), 'A count for orientation; the sheets themselves are what import reads.'],
    ['unit_count', String(fleet.length), ''],
  ]

  return [
    sheet(SHEET.readme, README_COLUMNS, readmeRows, false),
    sheet(SHEET.subassemblies, SUBASSEMBLIES_COLUMNS, subRows),
    sheet(SHEET.parts, PARTS_COLUMNS, partsRows),
    sheet(SHEET.variants, VARIANTS_COLUMNS, variantRows),
    sheet(SHEET.units, unitsColumns(codes), unitRows),
    sheet(SHEET.lines, LINES_COLUMNS, lineRows),
    sheet(SHEET.vue, VUE_COLUMNS, vueRows),
    sheet(SHEET.unitRevs, UNIT_REVS_COLUMNS, unitRevRows),
  ]
}

/** `unit-info-master-2026-07-31.xlsx` */
export function exportFilename(exportedAt: string): string {
  return `unit-info-master-${exportedAt.slice(0, 10)}.xlsx`
}
