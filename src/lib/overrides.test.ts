import { beforeEach, describe, expect, it } from 'vitest'
import { BASE_FLEET, buildFleet, defaultSubs, unitNumber } from './fleet'
import { recordKey, resolveFleet } from './records'
import { ADMIN_PIN, persistedFields, useStore } from '../store/useStore'
import { EMPTY_OVERRIDES } from './overrides'
import type { Records } from './types'

const RG_WHEEL = 'RG:DMF-1650-WH'
const s = () => useStore.getState()
const fleetNow = () => buildFleet(s().overrides)
const unit = (id: string) => fleetNow().find((u) => u.id === id)!

beforeEach(() => {
  useStore.setState({ overrides: EMPTY_OVERRIDES, admin: false, sel: null })
})

describe('the admin lock', () => {
  it('opens on the right PIN and not on a wrong one', () => {
    expect(s().unlock('0000')).toBe(false)
    expect(s().admin).toBe(false)
    expect(s().unlock(ADMIN_PIN)).toBe(true)
    expect(s().admin).toBe(true)
    s().lock()
    expect(s().admin).toBe(false)
  })

  it('is not persisted — a reload re-locks', () => {
    s().unlock(ADMIN_PIN)
    expect(Object.keys(persistedFields(s()))).not.toContain('admin')
  })
})

describe('editing the master parts list', () => {
  it('reaches every machine carrying that subassembly', () => {
    s().editPart('RG', 'DMF-1650-WH', { desc: 'Guide wheel, flanged — 2024 spec' })
    for (const id of ['T-16', 'T-55', 'T-57']) {
      const line = unit(id).lines.find((l) => l.key === RG_WHEEL)!
      expect(line.desc).toBe('Guide wheel, flanged — 2024 spec')
    }
  })

  it('keeps records attached when a part number is renamed', () => {
    // A record captured against the part as originally numbered...
    const records: Records = { [recordKey('T-16', RG_WHEEL)]: { serial: 'WH-9001' } }
    s().editPart('RG', 'DMF-1650-WH', { part: 'DMF-1650-WHEEL-B' })

    const line = unit('T-16').lines.find((l) => l.part === 'DMF-1650-WHEEL-B')!
    expect(line.key).toBe(RG_WHEEL) // ...still keyed by the original identity
    const rec = resolveFleet(fleetNow(), records).resolved.get(recordKey('T-16', line.key))!
    expect(rec.serial).toBe('WH-9001')
  })

  it('adds a part to every machine and hands back its line key', () => {
    const before = unit('T-16').lines.length
    const key = s().addPart('MG')
    expect(key).toBe('MG:MG-NEW-1')
    expect(unit('T-16').lines.length).toBe(before + 1)
    expect(unit('T-16').lines.find((l) => l.key === key)!.part).toBe('')
  })

  it('gives each added part a distinct identity', () => {
    expect(s().addPart('MG')).toBe('MG:MG-NEW-1')
    expect(s().addPart('MG')).toBe('MG:MG-NEW-2')
  })

  it('removes a part and drops it from the selection', () => {
    useStore.setState({ sel: RG_WHEEL })
    s().removePart('RG', 'DMF-1650-WH')
    expect(unit('T-16').lines.some((l) => l.key === RG_WHEEL)).toBe(false)
    expect(s().sel).toBeNull()
  })

  it('leaves other subassemblies untouched', () => {
    s().removePart('RG', 'DMF-1650-WH')
    expect(unit('T-16').lines.filter((l) => l.sub === 'LD')).toHaveLength(4)
  })
})

describe('parts renamed to their real manufacturer numbers', () => {
  it('keeps the identity records were captured against', () => {
    // Robot and Magnet parts were renamed from placeholder numbers; the line
    // keys must still read from the original ids or the audit history detaches.
    const lines = buildFleet().flatMap((u) => u.lines)
    const byKey = (key: string) => lines.find((l) => l.key === key)!
    expect(byKey('RB:RB-6100-01').part).toBe('TX2-140')
    expect(byKey('RB:RB-6200-02').part).toBe('CS-9-MP')
    expect(byKey('RB:RB-6310-01').part).toBe('EMH-84')
    expect(byKey('MG:MG-3100-02').part).toBe('Molley ESB-32')
  })

  it('has dropped the rail gear parts that are not fitted', () => {
    const rg = buildFleet()[0].lines.filter((l) => l.sub === 'RG').map((l) => l.part)
    expect(rg).toEqual(['DMF-1650-F', 'DMF-1650-R', 'DMF-1650-WH', 'DMF-1650-CYL'])
  })
})

describe('fleet ordering', () => {
  it('sorts by unit number, not by string', () => {
    const ids = [...BASE_FLEET].sort((a, b) => unitNumber(a.id) - unitNumber(b.id)).map((u) => u.id)
    expect(ids[0]).toBe('T-16')
    expect(ids.at(-1)).toBe('T-57')
    expect(ids).toEqual([...ids].sort((a, b) => unitNumber(a) - unitNumber(b)))
  })

  it('keeps single-digit machines ahead of double-digit ones', () => {
    expect(['T-10', 'T-9', 'T-100'].sort((a, b) => unitNumber(a) - unitNumber(b))).toEqual([
      'T-9',
      'T-10',
      'T-100',
    ])
  })
})

describe('fitment', () => {
  it('fits a subassembly to one machine only', () => {
    expect(unit('T-16').subs).not.toContain('CV')
    s().fitSub('T-16', 'CV')
    expect(unit('T-16').subs).toContain('CV')
    // Every other machine keeps exactly the fitment it was imported with.
    for (const id of ['T-18', 'T-32', 'T-55']) {
      expect(unit(id).subs).toEqual(defaultSubs(id))
    }
  })

  it('brings the subassembly lines with it', () => {
    const before = unit('T-16').lines.length
    s().fitSub('T-16', 'CV')
    expect(unit('T-16').lines.length).toBe(before + 3)
  })

  it('will not fit the same subassembly twice', () => {
    s().fitSub('T-16', 'CV')
    s().fitSub('T-16', 'CV')
    expect(unit('T-16').subs.filter((c) => c === 'CV')).toHaveLength(1)
  })

  it('strikes a subassembly off one machine', () => {
    s().strikeSub('T-32', 'VT')
    expect(unit('T-32').subs).not.toContain('VT')
    expect(unit('T-34').subs).toContain('VT')
  })
})

describe('machine identity', () => {
  it('overrides the VIN without touching the source data', () => {
    s().editUnit('T-16', { vin: 'CORRECTED-VIN-1' })
    expect(unit('T-16').vin).toBe('CORRECTED-VIN-1')
    expect(buildFleet().find((u) => u.id === 'T-16')!.vin).toBe('1M2AX13C2AM009459')
  })

  it('overrides an imported serial and re-runs the duplicate rule', () => {
    // T-16 and T-53 both carry front gear 27431 in the source sheet.
    expect(resolveFleet(fleetNow(), {}).resolved.get(recordKey('T-16', 'RG:DMF-1650-F'))!.status)
      .toBe('dup')
    s().editUnit('T-16', { serials: { front: '27999' } })
    const { resolved } = resolveFleet(fleetNow(), {})
    expect(resolved.get(recordKey('T-16', 'RG:DMF-1650-F'))!.status).toBe('verified')
    expect(resolved.get(recordKey('T-53', 'RG:DMF-1650-F'))!.status).toBe('verified')
  })

  it('merges serial edits rather than replacing the set', () => {
    s().editUnit('T-16', { serials: { front: 'A' } })
    s().editUnit('T-16', { serials: { rear: 'B' } })
    expect(unit('T-16').serials.front).toBe('A')
    expect(unit('T-16').serials.rear).toBe('B')
  })
})
