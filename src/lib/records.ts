import { NOTES } from '../data/subassemblies'
import type { Coverage, Line, Records, ResolvedRecord, Unit } from './types'

export const recordKey = (unitId: string, lineKey: string) => `${unitId}|${lineKey}`

const label = (unit: Unit, line: Line) => `${unit.id} · ${line.part}`

/** The serial actually on record: a user-entered value wins over the sheet import. */
export function serialOf(unit: Unit, line: Line, records: Records): string {
  const stored = records[recordKey(unit.id, line.key)]
  return stored?.serial !== undefined ? stored.serial : line.serial
}

export interface FleetResolution {
  /** serial → the lines carrying it, as `"<unit> · <part>"`. */
  serialIndex: Map<string, string[]>
  /** `"<unitId>|<lineKey>"` → the record after import, dup, and clearing rules. */
  resolved: Map<string, ResolvedRecord>
  coverage: Map<string, Coverage>
  fleet: Coverage
}

/**
 * Resolves every record in the fleet in one pass. The serial index is derived
 * from current records, so both sides of a collision re-evaluate together.
 */
export function resolveFleet(fleet: Unit[], records: Records): FleetResolution {
  const serialIndex = new Map<string, string[]>()
  for (const unit of fleet) {
    for (const line of unit.lines) {
      const serial = serialOf(unit, line, records).trim()
      if (!serial) continue
      const hits = serialIndex.get(serial)
      if (hits) hits.push(label(unit, line))
      else serialIndex.set(serial, [label(unit, line)])
    }
  }

  const resolved = new Map<string, ResolvedRecord>()
  const coverage = new Map<string, Coverage>()
  let fleetVerified = 0
  let fleetTotal = 0
  let fleetFlags = 0

  for (const unit of fleet) {
    let verified = 0
    let flags = 0
    for (const line of unit.lines) {
      const rec = resolveRecord(unit, line, records, serialIndex)
      resolved.set(recordKey(unit.id, line.key), rec)
      if (rec.status === 'verified') verified++
      else if (rec.status === 'flagged' || rec.status === 'dup') flags++
    }
    const total = unit.lines.length
    coverage.set(unit.id, { total, verified, flags, pct: Math.round((verified / total) * 100) })
    fleetVerified += verified
    fleetTotal += total
    fleetFlags += flags
  }

  return {
    serialIndex,
    resolved,
    coverage,
    fleet: {
      total: fleetTotal,
      verified: fleetVerified,
      flags: fleetFlags,
      pct: Math.round((fleetVerified / fleetTotal) * 100),
    },
  }
}

function resolveRecord(
  unit: Unit,
  line: Line,
  records: Records,
  serialIndex: Map<string, string[]>,
): ResolvedRecord {
  const stored = records[recordKey(unit.id, line.key)]
  const serial = serialOf(unit, line, records).trim()

  let out: ResolvedRecord
  if (stored) {
    out = {
      status: stored.status ?? 'open',
      serial,
      photo: stored.photo ?? false,
      note: stored.note ?? '',
    }
  } else if (line.onRecord && serial) {
    out = { status: 'verified', serial, photo: false, note: NOTES.imported }
  } else {
    out = { status: 'open', serial, photo: false, note: '' }
  }

  // A serial may sit on exactly one line in the whole fleet. An explicit flag
  // and "not present" outrank the check; everything else re-derives from it.
  if (serial && out.status !== 'absent' && out.status !== 'flagged') {
    const collisions = (serialIndex.get(serial) ?? []).filter((x) => x !== label(unit, line))
    if (collisions.length) {
      out.status = 'dup'
      out.note = `Serial ${serial} is also recorded on ${collisions.join(', ')}. A serial can only sit on one unit — engineering to resolve.`
    } else if (out.status === 'dup' || out.status === 'open') {
      out.status = 'verified'
      out.note = out.note || NOTES.unique
    }
  } else if (!serial && (out.status === 'dup' || out.status === 'verified')) {
    out.status = 'open'
    out.note = ''
  }

  return out
}
