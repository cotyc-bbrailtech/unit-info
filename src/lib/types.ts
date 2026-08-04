/** The seven subassemblies that ship in src/data/subassemblies.ts. */
export type BuiltInSubCode = 'RG' | 'LD' | 'MG' | 'VT' | 'VG' | 'RB' | 'CV'

/**
 * A subassembly's code. Not a closed union: an admin can create a subassembly,
 * and the code they pick is what every audit record under it is keyed by. Use
 * `BuiltInSubCode` where a literal from the shipped catalogue is genuinely
 * meant — fitment defaults and the Vue licence mapping.
 */
export type SubCode = string

/** Descriptive. Nothing is fitted or unfitted on the strength of it. */
export type SubKind = 'common' | 'optional'

/**
 * `'VGR'` is a VGR system whose commercial tier nobody wrote down — distinct
 * from `''`, which is a system whose licence is unknown altogether. The
 * difference is load-bearing: a bare `'VGR'` still fits Vision — VGR, where
 * `''` fits nothing. Recording a tier we do not have would be a guess about a
 * commercial entitlement, and several systems read off machines have none.
 */
export type VueLicense = 'Tie Detection' | 'VGR premium' | 'VGR enterprise' | 'VGR' | ''

/** The tiers an admin can pick. `''` stays reachable but is never offered. */
export const VUE_LICENCES = ['Tie Detection', 'VGR premium', 'VGR enterprise', 'VGR'] as const

/** A row of vue-licenses.csv, exactly as shipped. */
export interface VueUnit {
  serial: string
  license: VueLicense
  rev: string
  notes: string
  /** Where the sheet thinks it is — a unit id, a place, or empty. */
  locationEstimate: string
  /** Where it has actually been confirmed. Empty means nobody has checked. */
  locationConfirmed: string
}

/** A Vue system resolved against the admin overrides. */
export interface VueSystem extends VueUnit {
  /** The location in force: an admin assignment, else confirmed, else estimate. */
  location: string
  /** What vue-licenses.csv said, so the screen never loses it. */
  sheetLocation: string
  /** True when an admin set the location rather than the sheet. */
  assigned: boolean
  /** True when vue-licenses.csv never had this system at all. */
  added: boolean
}

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
  kind: SubKind
  parts: PartSpec[]
}

/** A subassembly resolved against the admin overrides. */
export interface ResolvedSub extends Subassembly {
  code: SubCode
  /** True when the code ships in src/data/subassemblies.ts. */
  builtIn: boolean
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
  /**
   * Revisions an admin set for this machine alone, keyed by line key. Wins over
   * both the master part and the Vue-derived revision — it is the most specific
   * statement about this machine.
   */
  revs?: Record<string, string>
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
