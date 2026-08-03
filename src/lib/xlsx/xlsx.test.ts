import { describe, expect, it } from 'vitest'
import { decodeXml, escapeXml, scanXml } from './xml'
import { crc32, readZip, writeZip } from './zip'
import { readXlsx } from './read'
import { colName, writeXlsx } from './write'
import type { SheetSpec } from './write'

const cols = (n: number) => Array.from({ length: n }, () => ({ width: 12 }))

describe('xml', () => {
  it('round-trips the characters that break naive escaping', () => {
    const s = `a<b>c&d"e'f — ° ${String.fromCharCode(9)}tab`
    expect(decodeXml(escapeXml(s))).toBe(s)
  })

  it('strips control characters Excel rejects', () => {
    expect(escapeXml(`a${String.fromCharCode(7)}b`)).toBe('ab')
  })

  it('decodes numeric character references', () => {
    expect(decodeXml('&#8212;&#x2014;&amp;')).toBe('——&')
  })

  it('does not mistake a > inside an attribute value for a tag end', () => {
    const tags = [...scanXml('<c r="A1" f="IF(2>1,1,0)"><v>7</v></c>')].filter((n) => n.type === 'tag')
    expect(tags[0].type === 'tag' && tags[0].tag.attrs.f).toBe('IF(2>1,1,0)')
    expect(tags[0].type === 'tag' && tags[0].tag.name).toBe('c')
  })

  it('skips comments, CDATA and the declaration', () => {
    const text = [...scanXml('<?xml version="1.0"?><a><!--x--><![CDATA[hi]]></a>')]
      .filter((n) => n.type === 'text')
      .map((n) => (n.type === 'text' ? n.text : ''))
      .join('')
    expect(text).toBe('hi')
  })

  it('marks self-closing tags', () => {
    const [node] = [...scanXml('<si/>')]
    expect(node.type === 'tag' && node.tag.selfClose).toBe(true)
  })
})

describe('zip', () => {
  it('matches the known CRC-32 of "123456789"', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('round-trips entries', async () => {
    const enc = new TextEncoder()
    const zip = writeZip([
      { name: 'a.txt', data: enc.encode('hello') },
      { name: 'nested/b.xml', data: enc.encode('<x/>') },
    ])
    const back = await readZip(zip)
    expect(new TextDecoder().decode(back.get('a.txt')!)).toBe('hello')
    expect(new TextDecoder().decode(back.get('nested/b.xml')!)).toBe('<x/>')
  })

  it('rejects something that is not a zip', async () => {
    await expect(readZip(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/not a zip/i)
  })
})

describe('column names', () => {
  it('counts past Z', () => {
    expect([0, 25, 26, 27, 51, 52].map(colName)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA'])
  })
})

describe('workbook round trip', () => {
  const sheets: SheetSpec[] = [
    {
      name: 'One',
      columns: cols(3),
      rows: [
        ['a', 'b', 'c'],
        ['007725', '27431', 'FX5UC-32MR/DS-TS'],
        ['<&>"\'', '— ° é', ''],
      ],
    },
    { name: 'Two', columns: cols(2), rows: [['x', 'y'], ['1', '2']] },
  ]

  it('reads back exactly what it wrote', async () => {
    const wb = await readXlsx(writeXlsx(sheets))
    expect([...wb.keys()]).toEqual(['One', 'Two'])
    expect(wb.get('One')![1]).toEqual(['007725', '27431', 'FX5UC-32MR/DS-TS'])
    expect(wb.get('One')![2][0]).toBe('<&>"\'')
    expect(wb.get('One')![2][1]).toBe('— ° é')
  })

  it('keeps leading zeros as text rather than numbers', async () => {
    const wb = await readXlsx(writeXlsx(sheets))
    expect(wb.get('One')![1][0]).toBe('007725')
  })

  it('rejects sheet names Excel will not accept', () => {
    expect(() => writeXlsx([{ name: 'a/b', columns: cols(1), rows: [['x']] }])).toThrow(/sheet name/i)
    expect(() =>
      writeXlsx([{ name: 'x'.repeat(32), columns: cols(1), rows: [['x']] }]),
    ).toThrow(/sheet name/i)
  })

  it('rejects duplicate sheet names', () => {
    expect(() =>
      writeXlsx([
        { name: 'S', columns: cols(1), rows: [['x']] },
        { name: 's', columns: cols(1), rows: [['y']] },
      ]),
    ).toThrow(/duplicate/i)
  })

  it('rejects a file that is not a workbook', async () => {
    const zip = writeZip([{ name: 'nope.txt', data: new TextEncoder().encode('hi') }])
    await expect(readXlsx(zip)).rejects.toThrow(/not an Excel workbook/i)
  })
})
