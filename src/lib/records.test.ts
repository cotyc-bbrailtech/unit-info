import { describe, expect, it } from 'vitest'
import { BASE_FLEET as FLEET } from './fleet'
import { recordKey, resolveFleet } from './records'
import type { Records } from './types'

const RG_FRONT = 'RG:DMF-1650-F'
const RG_REAR = 'RG:DMF-1650-R'
const LD_MAIN = 'LD:SERCO-8500'

const at = (unitId: string, lineKey: string, records: Records = {}) =>
  resolveFleet(FLEET, records).resolved.get(recordKey(unitId, lineKey))!

describe('duplicate serials', () => {
  it('flags both sides of a collision in the imported sheet', () => {
    // T-16 and T-53 both carry front rail gear 27431.
    expect(at('T-16', RG_FRONT).status).toBe('dup')
    expect(at('T-53', RG_FRONT).status).toBe('dup')
    expect(at('T-16', RG_FRONT).note).toContain('T-53 · DMF-1650-F')
  })

  it('names every other line the serial sits on', () => {
    // T-24 rear and T-25 rear both carry 30068.
    expect(at('T-24', RG_REAR).note).toContain('T-25 · DMF-1650-R')
    expect(at('T-25', RG_REAR).note).toContain('T-24 · DMF-1650-R')
  })

  it('clears the flag on both sides when one is corrected', () => {
    const records: Records = { [recordKey('T-53', RG_FRONT)]: { serial: '99999' } }
    expect(at('T-16', RG_FRONT, records).status).toBe('verified')
    expect(at('T-53', RG_FRONT, records).status).toBe('verified')
  })

  it('raises a collision created by user entry', () => {
    // T-19 front is 28142; put it on T-22's loader too.
    const records: Records = { [recordKey('T-22', LD_MAIN)]: { serial: '28142' } }
    expect(at('T-22', LD_MAIN, records).status).toBe('dup')
    expect(at('T-19', RG_FRONT, records).status).toBe('dup')
  })

  it('ignores surrounding whitespace when matching', () => {
    const records: Records = { [recordKey('T-22', LD_MAIN)]: { serial: ' 28142 ' } }
    expect(at('T-22', LD_MAIN, records).status).toBe('dup')
  })
})

describe('empty serials', () => {
  it('drops a verified line back to open', () => {
    const records: Records = { [recordKey('T-19', RG_FRONT)]: { status: 'verified', serial: '' } }
    const rec = at('T-19', RG_FRONT, records)
    expect(rec.status).toBe('open')
    expect(rec.note).toBe('')
  })

  it('leaves an explicit flag standing', () => {
    const records: Records = { [recordKey('T-19', RG_FRONT)]: { status: 'flagged', serial: '' } }
    expect(at('T-19', RG_FRONT, records).status).toBe('flagged')
  })

  it('leaves "not present" standing', () => {
    const records: Records = { [recordKey('T-19', RG_FRONT)]: { status: 'absent', serial: '' } }
    expect(at('T-19', RG_FRONT, records).status).toBe('absent')
  })

  it('outranks the duplicate check with an explicit flag', () => {
    const records: Records = { [recordKey('T-16', RG_FRONT)]: { status: 'flagged' } }
    expect(at('T-16', RG_FRONT, records).status).toBe('flagged')
  })
})

describe('parts that carry no serial', () => {
  const WHEEL = 'RG:DMF-1650-WH'

  it('stay verified when an auditor marks them present', () => {
    // The guide wheel has no serial slot, so the walk is the only evidence
    // there is. Without this the audit's "Present, as listed" is a no-op.
    const records: Records = { [recordKey('T-19', WHEEL)]: { status: 'verified' } }
    expect(at('T-19', WHEEL, records).status).toBe('verified')
  })

  it('count towards coverage once confirmed', () => {
    const before = resolveFleet(FLEET, {}).coverage.get('T-19')!.verified
    const records: Records = { [recordKey('T-19', WHEEL)]: { status: 'verified' } }
    expect(resolveFleet(FLEET, records).coverage.get('T-19')!.verified).toBe(before + 1)
  })

  it('still start unverified', () => {
    expect(at('T-19', WHEEL).status).toBe('open')
  })

  it('do not weaken the rule for parts that do carry a serial', () => {
    const records: Records = { [recordKey('T-19', RG_FRONT)]: { status: 'verified', serial: '' } }
    expect(at('T-19', RG_FRONT, records).status).toBe('open')
  })
})

describe('coverage', () => {
  it('counts a line on record only when a real serial exists', () => {
    // T-55 and T-56 have no gear or loader serials recorded.
    const { coverage } = resolveFleet(FLEET, {})
    expect(coverage.get('T-55')!.pct).toBe(0)
    expect(coverage.get('T-56')!.pct).toBe(0)
  })

  it('counts flagged and dup lines as flags', () => {
    const records: Records = { [recordKey('T-19', RG_REAR)]: { status: 'flagged' } }
    const { coverage } = resolveFleet(FLEET, records)
    // T-19 front and rear collide with nothing; only the explicit flag counts.
    expect(coverage.get('T-19')!.flags).toBe(1)
  })

  it('re-derives fleet totals from the resolved records', () => {
    const { fleet, coverage } = resolveFleet(FLEET, {})
    const summed = [...coverage.values()].reduce((n, c) => n + c.verified, 0)
    expect(fleet.verified).toBe(summed)
  })
})

describe('imported records', () => {
  it('marks a unique imported serial verified with the import note', () => {
    const rec = at('T-19', RG_FRONT)
    expect(rec.status).toBe('verified')
    expect(rec.serial).toBe('28142')
    expect(rec.note).toContain('unit record sheet')
  })

  it('leaves an unserialised part open', () => {
    expect(at('T-19', 'RG:DMF-1650-WH').status).toBe('open')
  })
})
