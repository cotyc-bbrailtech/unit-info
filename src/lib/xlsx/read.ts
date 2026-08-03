/**
 * Reads an .xlsx into `Map<sheetName, string[][]>`, every cell a trimmed
 * string. No dependencies.
 *
 * Every value is stringified rather than typed, exactly as `parseCsvRows` does,
 * so the xlsx and CSV paths agree by construction. Nothing in this workbook is
 * a number or a date, so there is no number-format or date-serial handling to
 * get wrong.
 */
import { decodeXml, scanXml } from './xml'
import { readZip, ZipError } from './zip'

export class XlsxError extends Error {}

/** `"C3"` -> 2. Ignores the row part. */
export function colIndex(ref: string): number {
  let n = 0
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i)
    if (c < 65 || c > 90) break
    n = n * 26 + (c - 64)
  }
  return n - 1
}

/**
 * Shared strings. An `<si>` is either a single `<t>` or a run of `<r><t>`
 * pieces when Excel has applied mixed formatting; the pieces concatenate.
 */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  let current: string | null = null
  let inT = false

  for (const node of scanXml(xml)) {
    if (node.type === 'tag') {
      const { name, close, selfClose } = node.tag
      if (name === 'si') {
        if (close) {
          out.push(current ?? '')
          current = null
        } else {
          // <si/> is a legal empty string entry.
          if (selfClose) out.push('')
          else current = ''
        }
      } else if (name === 't') {
        inT = !close && !selfClose
      }
    } else if (inT && current !== null) {
      current += decodeXml(node.text)
    }
  }
  return out
}

interface SheetRef {
  name: string
  path: string
}

function parseWorkbook(xml: string, rels: Map<string, string>): SheetRef[] {
  const out: SheetRef[] = []
  for (const node of scanXml(xml)) {
    if (node.type !== 'tag' || node.tag.name !== 'sheet' || node.tag.close) continue
    const name = node.tag.attrs.name
    const rid = node.tag.attrs['r:id'] ?? node.tag.attrs.id
    const target = rid ? rels.get(rid) : undefined
    if (name && target) out.push({ name, path: target })
  }
  return out
}

function parseRels(xml: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const node of scanXml(xml)) {
    if (node.type !== 'tag' || node.tag.name !== 'Relationship' || node.tag.close) continue
    const { Id, Target } = node.tag.attrs
    if (Id && Target) out.set(Id, Target)
  }
  return out
}

/** Rels targets may be relative to xl/ or absolute from the package root. */
function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  if (target.startsWith('xl/')) return target
  return `xl/${target}`
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let rowAt = -1

  let cellAt = -1
  let cellType = ''
  let inValue = false
  let inInline = false
  let value = ''

  const flushCell = () => {
    if (cellAt < 0) return
    let text = value
    if (cellType === 's') {
      const i = Number.parseInt(value, 10)
      text = Number.isFinite(i) ? (shared[i] ?? '') : ''
    } else if (cellType === 'b') {
      text = value === '1' ? 'TRUE' : 'FALSE'
    }
    while (row.length < cellAt) row.push('')
    row[cellAt] = text.trim()
    cellAt = -1
    value = ''
    cellType = ''
  }

  for (const node of scanXml(xml)) {
    if (node.type === 'tag') {
      const { name, attrs, close, selfClose } = node.tag

      if (name === 'row') {
        if (close) {
          while (rows.length < rowAt) rows.push([])
          rows[rowAt] = row
          row = []
          rowAt = -1
        } else if (!selfClose) {
          const r = attrs.r ? Number.parseInt(attrs.r, 10) - 1 : rows.length
          rowAt = Number.isFinite(r) && r >= 0 ? r : rows.length
          row = []
        }
      } else if (name === 'c') {
        if (close) flushCell()
        else {
          cellAt = attrs.r ? colIndex(attrs.r) : row.length
          cellType = attrs.t ?? ''
          value = ''
          if (selfClose) flushCell()
        }
      } else if (name === 'v') {
        inValue = !close && !selfClose
      } else if (name === 'is') {
        inInline = !close && !selfClose
      } else if (name === 't') {
        // <t> inside <is> is an inline string; inside <si> it is shared.
        if (inInline) inValue = !close && !selfClose
      } else if (name === 'f' && !close) {
        // A formula's cached result is in <v>; ignore the formula itself.
        value = ''
      }
    } else if (inValue && cellAt >= 0) {
      value += decodeXml(node.text)
    }
  }

  // A row that never closed (truncated file) still counts.
  if (rowAt >= 0) {
    while (rows.length < rowAt) rows.push([])
    rows[rowAt] = row
  }
  return rows
}

export type Workbook = Map<string, string[][]>

/** Parses xlsx bytes. Throws `XlsxError` with a message fit to show a user. */
export async function readXlsx(bytes: Uint8Array): Promise<Workbook> {
  let files: Map<string, Uint8Array>
  try {
    files = await readZip(bytes)
  } catch (e) {
    if (e instanceof ZipError) throw new XlsxError(`That file is not a readable .xlsx — ${e.message}`)
    throw new XlsxError('That file could not be read as an .xlsx workbook.')
  }

  const dec = new TextDecoder()
  const text = (path: string): string | null => {
    const f = files.get(path)
    return f ? dec.decode(f) : null
  }

  const workbookXml = text('xl/workbook.xml')
  if (!workbookXml) throw new XlsxError('That file is not an Excel workbook — xl/workbook.xml is missing.')

  const relsXml = text('xl/_rels/workbook.xml.rels')
  const rels = relsXml ? parseRels(relsXml) : new Map<string, string>()
  const sharedXml = text('xl/sharedStrings.xml')
  const shared = sharedXml ? parseSharedStrings(sharedXml) : []

  const out: Workbook = new Map()
  for (const ref of parseWorkbook(workbookXml, rels)) {
    const sheetXml = text(resolveTarget(ref.path))
    if (sheetXml) out.set(ref.name, parseSheet(sheetXml, shared))
  }

  if (!out.size) throw new XlsxError('That workbook has no readable sheets.')
  return out
}
