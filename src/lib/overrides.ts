import { BUILT_IN_CODES, SUBS } from '../data/subassemblies'
import { recordKey } from './records'
import type {
  PartSpec,
  Records,
  ResolvedSub,
  SerialSlot,
  SubCode,
  SubKind,
  Subassembly,
  Unit,
} from './types'

/**
 * Admin edits, layered over the imported data. Parts are edited at master
 * level — a change to a subassembly reaches every machine that carries it.
 * Fitment and identity are per machine.
 *
 * One record per subassembly rather than a parts map plus a metadata map: a
 * name must not be able to drift from the parts it names, and every writer —
 * store action, workbook importer, migration — then handles the whole thing or
 * nothing.
 */
export interface Overrides {
  /**
   * Keyed by code. A key that is also in SUBS patches that built-in; one that
   * isn't is a subassembly the admin created. The union of both key sets is the
   * catalogue — see `subCodes`.
   */
  subs: Record<SubCode, SubOverride>
  units: Record<string, UnitOverride>
}

export interface SubOverride {
  /** Absent means "keep tracking subassemblies.ts". */
  name?: string
  kind?: SubKind
  /** Full replacement parts list. Absent means "keep tracking subassemblies.ts". */
  parts?: PartSpec[]
}

export interface UnitOverride {
  vin?: string
  serials?: Partial<Record<SerialSlot, string>>
  /** Which subassemblies are fitted, when it differs from the imported guess. */
  subs?: SubCode[]
  /** Per-line revision on this machine only, keyed `"<SUB>:<partId>"`. */
  revs?: Record<string, string>
}

export const EMPTY_OVERRIDES: Overrides = { subs: {}, units: {} }

/** SUBS keyed loosely, so an unknown code is a miss rather than a type error. */
const CATALOGUE = SUBS as Record<string, Subassembly | undefined>
const built = (code: SubCode) => CATALOGUE[code]

/**
 * A part's stable identity. Record keys are built from this, not from the part
 * number, so renaming a part number in the admin editor doesn't orphan the
 * records already captured against it.
 */
export const partId = (p: PartSpec): string => p.id ?? p.part

/**
 * Every subassembly that exists: the built-ins in declaration order, then the
 * ones the admin created, in the order they were created.
 */
export function subCodes(o: Overrides): SubCode[] {
  const extra = Object.keys(o.subs ?? {}).filter((c) => !built(c))
  return [...BUILT_IN_CODES, ...extra]
}

export const subExists = (code: SubCode, o: Overrides): boolean =>
  !!built(code) || !!o.subs?.[code]

/**
 * One subassembly resolved against the overrides. Total on purpose: a code with
 * nothing behind it resolves to an empty subassembly named after itself, so a
 * machine still carrying a stale code renders an empty group instead of
 * throwing. `strictNullChecks` is off in this project, so a nullable return
 * would be checked by nobody.
 */
export function subDef(code: SubCode, o: Overrides): ResolvedSub {
  const b = built(code)
  const patch = o.subs?.[code]
  return {
    code,
    name: patch?.name ?? b?.name ?? code,
    kind: patch?.kind ?? b?.kind ?? 'optional',
    parts: patch?.parts ?? b?.parts ?? [],
    builtIn: !!b,
  }
}

/** Just the display name — on the hot path, so it skips building a ResolvedSub. */
export const subName = (code: SubCode, o: Overrides): string =>
  o.subs?.[code]?.name ?? built(code)?.name ?? code

export const partsFor = (code: SubCode, o: Overrides): PartSpec[] =>
  o.subs?.[code]?.parts ?? built(code)?.parts ?? []

/** True when nothing about this subassembly differs from what ships in source. */
export const isBuiltInUntouched = (code: SubCode, o: Overrides): boolean =>
  !!built(code) && !o.subs?.[code]

/**
 * Pins an id onto every part before the list is first edited, so later renames
 * keep their identity. Built-in parts adopt their current part number as the id.
 */
export const withIds = (parts: PartSpec[]): PartSpec[] =>
  parts.map((p) => ({ ...p, id: partId(p) }))

/** A fresh id that can't collide with a part number already in the list. */
export function nextPartId(code: SubCode, parts: PartSpec[]): string {
  const taken = new Set(parts.map(partId))
  for (let n = 1; ; n++) {
    const id = `${code}-NEW-${n}`
    if (!taken.has(id)) return id
  }
}

export const blankPart = (id: string): PartSpec => ({
  id,
  part: '',
  desc: '',
  rev: '',
  loc: '',
})

// ── Codes ───────────────────────────────────────────────────────────────────

/**
 * 2–4 characters, a letter first. Letter-first is load-bearing: JS puts
 * integer-like keys first in `Object.keys`, so a code of "12" would make
 * `subCodes` non-deterministic. The charset also excludes `:` and `|`, the
 * separators in a record key.
 */
export const SUB_CODE_RE = /^[A-Z][A-Z0-9]{1,3}$/

export const normaliseSubCode = (raw: string): string => raw.trim().toUpperCase()

/**
 * Why a code can't be used, or null when it can. Codes are identity: every
 * audit record is keyed `"<unit>|<code>:<partId>"`, so a code is picked once,
 * never changed, and never allowed to shadow one already in use.
 */
export function subCodeError(raw: string, o: Overrides): string | null {
  const code = normaliseSubCode(raw)
  if (!code) return 'Give the subassembly a code.'
  if (!SUB_CODE_RE.test(code))
    return 'A code is 2 to 4 characters, letters and digits, starting with a letter — RG, VT, PWR3.'
  const b = built(code)
  if (b) return `${code} is the built-in ${b.name}. Pick another code.`
  if (o.subs?.[code]) return `${code} is already in use by ${subName(code, o)}.`
  return null
}

export function subNameError(raw: string): string | null {
  const name = raw.trim()
  if (!name) return 'Give the subassembly a name.'
  if (name.length > 60) return 'Keep the name under 60 characters.'
  return null
}

// ── Counts shared with the workbook exporter, so the two cannot drift ───────

export const unitsWith = (code: SubCode, fleet: Unit[]): Unit[] =>
  fleet.filter((u) => u.subs.includes(code))

/** How many audit records are captured against one part, fleet-wide. */
export const recordsFor = (code: SubCode, id: string, fleet: Unit[], records: Records): number =>
  fleet.reduce((n, u) => n + (records[recordKey(u.id, `${code}:${id}`)] ? 1 : 0), 0)

/** How many audit records are captured against any part of one subassembly. */
export function recordsOnSub(code: SubCode, o: Overrides, fleet: Unit[], records: Records): number {
  return partsFor(code, o).reduce((n, p) => n + recordsFor(code, partId(p), fleet, records), 0)
}

// ── Migration ───────────────────────────────────────────────────────────────

/** The shape stored before subassemblies became editable (persist version 0). */
interface OverridesV0 {
  parts?: Record<string, PartSpec[] | undefined>
  units?: Record<string, UnitOverride>
}

/**
 * v0 kept parts in a map of their own, because a subassembly's name and kind
 * were compile-time constants. They're editable now, so a subassembly gets one
 * record. Nothing is lost: `parts[code]` becomes `subs[code].parts`, and name
 * and kind stay unset — which still resolves to the built-in, so a subassembly
 * nobody renamed keeps tracking subassemblies.ts. Idempotent.
 */
export function migrateOverrides(stored: unknown): Overrides {
  const o = (stored ?? {}) as OverridesV0 & Partial<Overrides>
  const units = o.units ?? {}
  if (o.subs) return { subs: o.subs, units }
  const subs: Record<SubCode, SubOverride> = {}
  for (const [code, parts] of Object.entries(o.parts ?? {})) {
    if (parts) subs[code] = { parts }
  }
  return { subs, units }
}
