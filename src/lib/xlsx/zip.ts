/**
 * The ZIP container for the xlsx reader/writer. No dependencies.
 *
 * WRITE uses STORE (method 0, uncompressed) so export needs nothing beyond a
 * Blob and works on any browser. A master workbook is a few hundred KB, which
 * is nothing for a desk download.
 *
 * READ handles both STORE and DEFLATE, inflating with the platform's own
 * `DecompressionStream('deflate-raw')` — Excel always deflates, so import needs
 * it. See `canRead()`; the UI feature-detects rather than throwing.
 */

export interface ZipEntry {
  name: string
  data: Uint8Array
}

const CRC_TABLE = /* @__PURE__ */ (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * A fixed DOS timestamp (1 Jan 2020, 00:00) so the same data always produces
 * the same bytes. Makes the writer testable; nothing surfaces these to a user.
 */
const DOS_TIME = 0
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1

class ByteWriter {
  private parts: Uint8Array[] = []
  length = 0

  push(bytes: Uint8Array): void {
    this.parts.push(bytes)
    this.length += bytes.length
  }

  u16(v: number): void {
    this.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff]))
  }

  u32(v: number): void {
    this.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]))
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.length)
    let at = 0
    for (const p of this.parts) {
      out.set(p, at)
      at += p.length
    }
    return out
  }
}

export function writeZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder()
  const out = new ByteWriter()
  const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = []

  for (const entry of entries) {
    const name = enc.encode(entry.name)
    const crc = crc32(entry.data)
    const offset = out.length

    out.u32(0x04034b50) // local file header
    out.u16(20) // version needed
    out.u16(0) // flags
    out.u16(0) // method: STORE
    out.u16(DOS_TIME)
    out.u16(DOS_DATE)
    out.u32(crc)
    out.u32(entry.data.length) // compressed
    out.u32(entry.data.length) // uncompressed
    out.u16(name.length)
    out.u16(0) // extra
    out.push(name)
    out.push(entry.data)

    central.push({ name, crc, size: entry.data.length, offset })
  }

  const cdStart = out.length
  for (const e of central) {
    out.u32(0x02014b50) // central directory header
    out.u16(20) // version made by
    out.u16(20) // version needed
    out.u16(0) // flags
    out.u16(0) // method: STORE
    out.u16(DOS_TIME)
    out.u16(DOS_DATE)
    out.u32(e.crc)
    out.u32(e.size)
    out.u32(e.size)
    out.u16(e.name.length)
    out.u16(0) // extra
    out.u16(0) // comment
    out.u16(0) // disk number
    out.u16(0) // internal attrs
    out.u32(0) // external attrs
    out.u32(e.offset)
    out.push(e.name)
  }
  const cdSize = out.length - cdStart

  out.u32(0x06054b50) // end of central directory
  out.u16(0)
  out.u16(0)
  out.u16(central.length)
  out.u16(central.length)
  out.u32(cdSize)
  out.u32(cdStart)
  out.u16(0) // comment length

  return out.concat()
}

/** Whether this platform can inflate — i.e. whether import is available. */
export function canRead(): boolean {
  return typeof DecompressionStream === 'function'
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0

/**
 * Reads via the central directory rather than scanning local headers, because
 * a local header may carry sizes of 0 with the real values in a trailing data
 * descriptor. The central directory always has them.
 */
export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const eocd = findEocd(bytes)
  if (eocd < 0) throw new ZipError('Not a zip file — no end-of-central-directory record.')

  const count = u16(bytes, eocd + 10)
  let at = u32(bytes, eocd + 16)
  const dec = new TextDecoder()
  const out = new Map<string, Uint8Array>()

  for (let i = 0; i < count; i++) {
    if (u32(bytes, at) !== 0x02014b50) throw new ZipError('Damaged zip: bad central directory entry.')
    const method = u16(bytes, at + 10)
    const compSize = u32(bytes, at + 20)
    const nameLen = u16(bytes, at + 28)
    const extraLen = u16(bytes, at + 30)
    const commentLen = u16(bytes, at + 32)
    const localAt = u32(bytes, at + 42)
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen))

    if (u32(bytes, localAt) !== 0x04034b50) throw new ZipError(`Damaged zip: bad local header for ${name}.`)
    const localNameLen = u16(bytes, localAt + 26)
    const localExtraLen = u16(bytes, localAt + 28)
    const dataAt = localAt + 30 + localNameLen + localExtraLen
    const raw = bytes.subarray(dataAt, dataAt + compSize)

    if (method === 0) out.set(name, raw)
    else if (method === 8) out.set(name, await inflateRaw(raw))
    else throw new ZipError(`Unsupported compression (method ${method}) for ${name}.`)

    at += 46 + nameLen + extraLen + commentLen
  }

  return out
}

export class ZipError extends Error {}

function findEocd(b: Uint8Array): number {
  // The record is 22 bytes plus an optional trailing comment, so scan back.
  const min = Math.max(0, b.length - 22 - 0xffff)
  for (let i = b.length - 22; i >= min; i--) {
    if (u32(b, i) === 0x06054b50) return i
  }
  return -1
}
