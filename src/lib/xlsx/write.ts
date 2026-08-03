/**
 * Writes a minimal, spec-legal .xlsx. No dependencies.
 *
 * Every cell is text (`t="inlineStr"` under the Text number format), because
 * every column in this workbook is text — part ids, part numbers, VINs,
 * serials, X marks. That is deliberate: it stops Excel turning `007725` into
 * `7725` or a rev letter into a date, and it means the reader never has to
 * interpret a number format or a date serial.
 */
import { escapeXml } from './xml'
import { writeZip } from './zip'
import type { ZipEntry } from './zip'

export interface ColumnSpec {
  width: number
  /** Renders grey, signalling "this column is not read back". */
  locked?: boolean
  wrap?: boolean
}

export interface SheetSpec {
  name: string
  columns: ColumnSpec[]
  /** Row 0 is the header row. */
  rows: string[][]
  /** Freeze below the header so it stays put while scrolling. Default true. */
  freezeHeader?: boolean
}

// Style indices into the fixed cellXfs below.
const S_BODY = 1
const S_HEADER = 2
const S_LOCKED = 3
const S_WRAP = 4

const CONTENT_TYPES = (count: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${Array.from({ length: count }, (_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

/**
 * Fixed styles. numFmtId 49 is the "@" text format — without it Excel helpfully
 * reinterprets serials and revision letters on the way back in.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FF6A6A6E"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7E7EA"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFB7B7BA"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="49" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="49" fontId="2" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

/** 0 -> A, 25 -> Z, 26 -> AA. */
export function colName(index: number): string {
  let n = index
  let out = ''
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  }
  return out
}

/**
 * Excel forbids : \ / ? * [ ] in a sheet name and caps it at 31 characters.
 * Sheet names are part of this workbook's contract, so a violation is a bug in
 * the schema rather than something to paper over at runtime.
 */
export function assertSheetName(name: string): void {
  if (!name || name.length > 31 || /[:\\/?*[\]]/.test(name)) {
    throw new Error(`Invalid Excel sheet name: ${JSON.stringify(name)}`)
  }
}

function sheetXml(spec: SheetSpec): string {
  const freeze = spec.freezeHeader !== false
  const cols = spec.columns.length
    ? `<cols>${spec.columns
        .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`)
        .join('')}</cols>`
    : ''

  const pane = freeze
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'

  const rows = spec.rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          if (value === '') return ''
          const style =
            r === 0 ? S_HEADER : spec.columns[c]?.locked ? S_LOCKED : spec.columns[c]?.wrap ? S_WRAP : S_BODY
          // xml:space="preserve" keeps leading/trailing spaces a user typed.
          return `<c r="${colName(c)}${r + 1}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
        })
        .join('')
      return `<row r="${r + 1}">${cells}</row>`
    })
    .join('')

  const lastCol = colName(Math.max(0, spec.columns.length - 1))
  const filter =
    spec.rows.length > 1 ? `<autoFilter ref="A1:${lastCol}${spec.rows.length}"/>` : ''

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${rows}</sheetData>${filter}</worksheet>`
}

export function writeXlsx(sheets: SheetSpec[]): Uint8Array {
  if (!sheets.length) throw new Error('A workbook needs at least one sheet.')
  const seen = new Set<string>()
  for (const s of sheets) {
    assertSheetName(s.name)
    const key = s.name.toLowerCase()
    if (seen.has(key)) throw new Error(`Duplicate sheet name: ${s.name}`)
    seen.add(key)
  }

  const enc = new TextEncoder()
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets
    .map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')}</sheets>
</workbook>`

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  .join('\n')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES(sheets.length)) },
    { name: '_rels/.rels', data: enc.encode(ROOT_RELS) },
    { name: 'xl/workbook.xml', data: enc.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(workbookRels) },
    { name: 'xl/styles.xml', data: enc.encode(STYLES) },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: enc.encode(sheetXml(s)),
    })),
  ]

  return writeZip(entries)
}
