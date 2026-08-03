/**
 * The XML layer for the xlsx reader/writer. No dependencies.
 *
 * Deliberately not regex (a `>` inside an attribute value breaks it) and not
 * DOMParser (absent in Node, and these tests run in the default node
 * environment). A character scanner handles the OOXML subset we need and runs
 * identically in the browser and in vitest.
 */

export function escapeXml(s: string): string {
  let out = ''
  for (const c of s) {
    if (c === '&') out += '&amp;'
    else if (c === '<') out += '&lt;'
    else if (c === '>') out += '&gt;'
    else if (c === '"') out += '&quot;'
    else if (c === "'") out += '&apos;'
    // Excel rejects most C0 control characters outright.
    else if (c < ' ' && c !== '\t' && c !== '\n' && c !== '\r') out += ''
    else out += c
  }
  return out
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export function decodeXml(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body] ?? whole
  })
}

export interface Tag {
  name: string
  attrs: Record<string, string>
  /** `<a/>` — no matching close tag follows. */
  selfClose: boolean
  close: boolean
}

export type Node = { type: 'tag'; tag: Tag } | { type: 'text'; text: string }

/**
 * Walks an XML document, yielding tags and the text between them. Skips the
 * declaration, comments, CDATA sections and doctypes.
 */
export function* scanXml(xml: string): Generator<Node> {
  let i = 0
  const n = xml.length

  while (i < n) {
    const lt = xml.indexOf('<', i)
    if (lt < 0) {
      const tail = xml.slice(i)
      if (tail) yield { type: 'text', text: tail }
      return
    }
    if (lt > i) yield { type: 'text', text: xml.slice(i, lt) }

    // <!-- comment -->, <![CDATA[..]]>, <!DOCTYPE ..>, <?xml ..?>
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4)
      i = end < 0 ? n : end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9)
      const text = xml.slice(lt + 9, end < 0 ? n : end)
      if (text) yield { type: 'text', text }
      i = end < 0 ? n : end + 3
      continue
    }
    if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt + 2)
      i = end < 0 ? n : end + 1
      continue
    }

    const parsed = readTag(xml, lt)
    if (!parsed) return
    yield { type: 'tag', tag: parsed.tag }
    i = parsed.next
  }
}

function readTag(xml: string, start: number): { tag: Tag; next: number } | null {
  let i = start + 1
  const close = xml[i] === '/'
  if (close) i++

  const nameStart = i
  while (i < xml.length && !/[\s/>]/.test(xml[i])) i++
  const name = xml.slice(nameStart, i)

  const attrs: Record<string, string> = {}
  let selfClose = false

  while (i < xml.length) {
    while (i < xml.length && /\s/.test(xml[i])) i++
    if (i >= xml.length) return null
    if (xml[i] === '/') {
      selfClose = true
      i++
      continue
    }
    if (xml[i] === '>') {
      i++
      break
    }

    const attrStart = i
    while (i < xml.length && !/[\s=/>]/.test(xml[i])) i++
    const attrName = xml.slice(attrStart, i)
    while (i < xml.length && /\s/.test(xml[i])) i++

    if (xml[i] !== '=') {
      if (attrName) attrs[attrName] = ''
      continue
    }
    i++ // =
    while (i < xml.length && /\s/.test(xml[i])) i++

    const quote = xml[i]
    if (quote === '"' || quote === "'") {
      i++
      const valStart = i
      while (i < xml.length && xml[i] !== quote) i++
      attrs[attrName] = decodeXml(xml.slice(valStart, i))
      i++ // closing quote
    } else {
      const valStart = i
      while (i < xml.length && !/[\s>]/.test(xml[i])) i++
      attrs[attrName] = decodeXml(xml.slice(valStart, i))
    }
  }

  return { tag: { name, attrs, selfClose, close }, next: i }
}
