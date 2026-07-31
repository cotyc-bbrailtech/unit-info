export type SubCode = 'RG' | 'LD' | 'MG' | 'VT' | 'VG' | 'RB' | 'CV'

export type Status = 'verified' | 'dup' | 'flagged' | 'absent' | 'open'

/** Which per-unit serial from the imported sheet a part carries, if any. */
export type SerialSlot = 'front' | 'rear' | 'loader' | 'vue'

export interface PartSpec {
  /**
   * Stable identity, independent of the part number. Absent on built-in parts,
   * which fall back to their part number; the admin editor pins one on before
   * a part number can be renamed. See `partId` in lib/overrides.ts.
   */
  id?: string
  part: string
  desc: string
  rev: string
  loc: string
  slot?: SerialSlot
  spec?: string
  /**
   * A part fitted differently depending on the machine's Vue revision, keyed by
   * that revision — e.g. the tie-detection camera is a Basler on rev A and an
   * IDS rolling shutter on rev B. The part takes the machine's Vue revision.
   */
  byRev?: Record<string, string>
}

export interface Subassembly {
  name: string
  kind: 'common' | 'optional'
  parts: PartSpec[]
}

export interface Line extends PartSpec {
  /** `"<SUB>:<PART>"` */
  key: string
  sub: SubCode
  subName: string
  /** Serial from the imported sheet; empty when the part carries none. */
  serial: string
  onRecord: boolean
}

export interface Unit {
  id: string
  vin: string
  subs: SubCode[]
  serials: Record<SerialSlot, string>
  /** Revision of the Apera Vue system on this machine, when it carries one. */
  vueRev?: string
  lastAudit: string
  lines: Line[]
}

export interface RecordEntry {
  status?: Status
  serial?: string
  photo?: boolean
  note?: string
}

/** Keyed `"<unitId>|<lineKey>"`. */
export type Records = Record<string, RecordEntry>

/** A record resolved against the sheet import and the fleet-wide serial index. */
export interface ResolvedRecord {
  status: Status
  serial: string
  photo: boolean
  note: string
}

export interface Coverage {
  total: number
  verified: number
  flags: number
  pct: number
}
