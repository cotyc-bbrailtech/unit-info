import { SUBS } from '../data/subassemblies'
import type { PartSpec, SerialSlot, SubCode } from './types'

/**
 * Admin edits, layered over the imported data. Parts are edited at master
 * level — a change to a subassembly reaches every machine that carries it.
 * Fitment and identity are per machine.
 */
export interface Overrides {
  /** Full replacement parts list for a subassembly. */
  parts: Partial<Record<SubCode, PartSpec[]>>
  units: Record<string, UnitOverride>
}

export interface UnitOverride {
  vin?: string
  serials?: Partial<Record<SerialSlot, string>>
  /** Which subassemblies are fitted, when it differs from the imported guess. */
  subs?: SubCode[]
}

export const EMPTY_OVERRIDES: Overrides = { parts: {}, units: {} }

/**
 * A part's stable identity. Record keys are built from this, not from the part
 * number, so renaming a part number in the admin editor doesn't orphan the
 * records already captured against it.
 */
export const partId = (p: PartSpec): string => p.id ?? p.part

export const partsFor = (code: SubCode, o: Overrides): PartSpec[] =>
  o.parts[code] ?? SUBS[code].parts

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
