/** Minimal RFC-4180 reader: quoted fields, doubled quotes, commas inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    if (row.some((c) => c !== '')) rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') endField()
    else if (c === '\n') endRow()
    else if (c !== '\r') field += c
  }
  if (field !== '' || row.length) endRow()
  return rows
}

/** Reads a CSV with a header row into objects keyed by column name. */
export function parseCsvRows(text: string): Record<string, string>[] {
  const [header, ...body] = parseCsv(text)
  if (!header) return []
  return body.map((cells) =>
    Object.fromEntries(header.map((name, i) => [name, (cells[i] ?? '').trim()])),
  )
}
