import { beforeEach, describe, expect, it } from 'vitest'
import {
  BASE_FLEET,
  buildFleet,
  defaultSubs,
  unitNumber,
  visionWithoutSystem,
  vueLicenceMismatch,
} from './fleet'
import { doubleBooked, vueByUnit, vueSystem } from './vue'
import { recordKey, resolveFleet } from './records'
import { ADMIN_PIN, persistedFields, useStore } from '../store/useStore'
import {
  EMPTY_OVERRIDES,
  migrateOverrides,
  partId,
  partsFor,
  subCodeError,
  subCodes,
  subDef,
  subName,
} from './overrides'
import { SUBS } from '../data/subassemblies'
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

describe('the subassembly catalogue', () => {
  it('lists the built-ins in declaration order', () => {
    expect(subCodes(EMPTY_OVERRIDES)).toEqual(['RG', 'LD', 'MG', 'VT', 'VG', 'RB', 'CV'])
  })

  it('puts created subassemblies after the built-ins', () => {
    s().createSub('HY', 'Hydraulics', 'optional')
    s().createSub('PWR', 'Power pack', 'common')
    expect(subCodes(s().overrides).slice(-2)).toEqual(['HY', 'PWR'])
    expect(subDef('HY', s().overrides).builtIn).toBe(false)
    expect(subDef('RG', s().overrides).builtIn).toBe(true)
  })

  it('resolves an unknown code to an empty subassembly rather than throwing', () => {
    expect(subName('NOPE', EMPTY_OVERRIDES)).toBe('NOPE')
    expect(partsFor('NOPE', EMPTY_OVERRIDES)).toEqual([])
    expect(subDef('NOPE', EMPTY_OVERRIDES).kind).toBe('optional')
  })

  it('survives a machine still fitted with a code that no longer exists', () => {
    useStore.setState({
      overrides: { subs: {}, units: { 'T-16': { subs: ['RG', 'GONE'] } }, vue: {} },
    })
    const u = unit('T-16')
    expect(u.subs).toContain('GONE')
    expect(u.lines.filter((l) => l.sub === 'GONE')).toHaveLength(0)
    expect(() => resolveFleet(fleetNow(), {})).not.toThrow()
  })

  it('accepts good codes and rejects bad ones', () => {
    for (const ok of ['CX', 'PWR3', 'HY']) expect(subCodeError(ok, EMPTY_OVERRIDES)).toBeNull()
    for (const bad of ['', 'C', 'TOOLONG', 'C-X', '12', 'rg']) {
      expect(subCodeError(bad, EMPTY_OVERRIDES)).not.toBeNull()
    }
  })

  it('refuses a code that would shadow a built-in', () => {
    expect(subCodeError('RG', EMPTY_OVERRIDES)).toContain('built-in')
    expect(s().createSub('RG', 'Something else', 'optional')).toBe(false)
    expect(subName('RG', s().overrides)).toBe('Rail Gear — DMF-1650')
  })

  it('refuses a duplicate of a created code', () => {
    expect(s().createSub('HY', 'Hydraulics', 'optional')).toBe(true)
    expect(s().createSub('hy', 'Something else', 'optional')).toBe(false)
    expect(subName('HY', s().overrides)).toBe('Hydraulics')
  })
})

describe('creating and renaming subassemblies', () => {
  it('starts empty and fitted to nothing', () => {
    const before = fleetNow().map((u) => [u.subs.join(), u.lines.length].join('|'))
    s().createSub('HY', 'Hydraulics', 'optional')
    expect(fleetNow().map((u) => [u.subs.join(), u.lines.length].join('|'))).toEqual(before)
  })

  it('reaches one machine once fitted, and carries its parts', () => {
    s().createSub('HY', 'Hydraulics', 'optional')
    s().fitSub('T-16', 'HY')
    const key = s().addPart('HY')
    s().editPart('HY', key.split(':')[1], { part: 'HY-8100-01' })
    const line = unit('T-16').lines.find((l) => l.sub === 'HY')!
    expect(line.key).toBe(key)
    expect(line.part).toBe('HY-8100-01')
    expect(line.subName).toBe('Hydraulics')
    expect(unit('T-18').subs).not.toContain('HY')
  })

  it('renames a built-in everywhere without moving a record key', () => {
    const before = unit('T-16').lines.map((l) => l.key)
    s().renameSub('RG', 'Rail Gear — 2026 spec')
    expect(unit('T-16').lines.find((l) => l.key === RG_WHEEL)!.subName).toBe('Rail Gear — 2026 spec')
    expect(unit('T-16').lines.map((l) => l.key)).toEqual(before)
  })

  it('leaves parts tracking source when only the name changed', () => {
    s().renameSub('RG', 'Renamed')
    expect(partsFor('RG', s().overrides)).toEqual(SUBS.RG.parts)
    expect(s().overrides.subs.RG.parts).toBeUndefined()
  })

  it('reverts a built-in to what ships in source', () => {
    s().renameSub('RG', 'Renamed')
    s().editPart('RG', 'DMF-1650-WH', { desc: 'changed' })
    s().revertSub('RG')
    expect(subName('RG', s().overrides)).toBe('Rail Gear — DMF-1650')
    expect(partsFor('RG', s().overrides)).toEqual(SUBS.RG.parts)
  })

  it('changing kind fits nothing — it is a label', () => {
    const before = fleetNow().map((u) => u.subs.join())
    s().setSubKind('CV', 'common')
    expect(subDef('CV', s().overrides).kind).toBe('common')
    expect(fleetNow().map((u) => u.subs.join())).toEqual(before)
    for (const u of BASE_FLEET) expect(unit(u.id).subs).toEqual(defaultSubs(u.id, s().overrides))
  })
})

describe('reordering parts', () => {
  it('moves a part, which moves it in the audit walk too', () => {
    const before = partsFor('RG', EMPTY_OVERRIDES).map((p) => partId(p))
    s().movePart('RG', before[1], -1)
    expect(partsFor('RG', s().overrides).map((p) => partId(p))).toEqual([
      before[1],
      before[0],
      ...before.slice(2),
    ])
    expect(unit('T-16').lines.slice(0, 2).map((l) => partId(l))).toEqual([before[1], before[0]])
  })

  it('does nothing at the ends of the list', () => {
    const before = partsFor('RG', EMPTY_OVERRIDES).map((p) => partId(p))
    s().movePart('RG', before[0], -1)
    s().movePart('RG', before.at(-1)!, 1)
    expect(partsFor('RG', s().overrides).map((p) => partId(p))).toEqual(before)
  })
})

describe('stored overrides from before subassemblies were editable', () => {
  const v0 = {
    parts: { RG: [{ id: 'X', part: 'X-1', desc: 'kept', rev: 'A', loc: 'here' }] },
    units: { 'T-16': { vin: 'STORED-VIN' } },
  }

  it('folds parts into the subassembly record', () => {
    const m = migrateOverrides(v0)
    expect(partsFor('RG', m).map((p) => p.part)).toEqual(['X-1'])
    expect(m.units).toEqual(v0.units)
  })

  it('is idempotent', () => {
    expect(migrateOverrides(migrateOverrides(v0))).toEqual(migrateOverrides(v0))
  })

  it('leaves a name unset, so anything unrenamed still tracks source', () => {
    expect(subName('LD', migrateOverrides(v0))).toBe(SUBS.LD.name)
  })

  it('copes with nothing stored at all', () => {
    expect(migrateOverrides(undefined)).toEqual({ subs: {}, units: {}, vue: {} })
    expect(migrateOverrides({})).toEqual({ subs: {}, units: {}, vue: {} })
  })

  it('degrades to the built-ins when subs is missing entirely', () => {
    // A hand-edited or truncated blob skips zustand's migrate hook.
    const broken = { units: {} } as unknown as Parameters<typeof partsFor>[1]
    expect(partsFor('RG', broken)).toEqual(SUBS.RG.parts)
    expect(subCodes(broken)).toHaveLength(7)
  })
})

describe('fitment', () => {
  it('fits a subassembly to one machine only', () => {
    expect(unit('T-16').subs).not.toContain('CV')
    s().fitSub('T-16', 'CV')
    expect(unit('T-16').subs).toContain('CV')
    // Every other machine keeps exactly the fitment it was imported with.
    for (const id of ['T-18', 'T-32', 'T-55']) {
      expect(unit(id).subs).toEqual(defaultSubs(id, s().overrides))
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

describe('a revision unique to one machine', () => {
  const FRONT = 'RG:DMF-1650-F'

  it('changes that machine only', () => {
    s().setUnitRev('T-16', FRONT, 'E')
    expect(unit('T-16').lines.find((l) => l.key === FRONT)!.rev).toBe('E')
    expect(unit('T-18').lines.find((l) => l.key === FRONT)!.rev).toBe('D')
  })

  it('clears back to the master revision, and drops the override entirely', () => {
    s().setUnitRev('T-16', FRONT, 'E')
    s().setUnitRev('T-16', FRONT, '')
    expect(unit('T-16').lines.find((l) => l.key === FRONT)!.rev).toBe('D')
    expect(s().overrides.units['T-16']).toBeUndefined()
  })

  it('trims, and treats whitespace as clearing', () => {
    s().setUnitRev('T-16', FRONT, '  E  ')
    expect(unit('T-16').lines.find((l) => l.key === FRONT)!.rev).toBe('E')
    s().setUnitRev('T-16', FRONT, '   ')
    expect(unit('T-16').lines.find((l) => l.key === FRONT)!.rev).toBe('D')
  })

  it('does not disturb the machine’s other overrides', () => {
    s().editUnit('T-16', { vin: 'KEEP-VIN' })
    s().setUnitRev('T-16', FRONT, 'E')
    expect(unit('T-16').vin).toBe('KEEP-VIN')
    s().setUnitRev('T-16', FRONT, '')
    expect(unit('T-16').vin).toBe('KEEP-VIN')
  })

  it('beats the machine Vue revision, and takes the variant with it', () => {
    // T-53's Vue system is rev B — its camera is the IDS rolling shutter.
    expect(unit('T-53').lines.find((l) => l.part === 'VT-4110-02')!.desc).toContain('IDS')
    s().setUnitRev('T-53', 'VT:VT-4110-02', 'A')
    const cam = unit('T-53').lines.find((l) => l.part === 'VT-4110-02')!
    expect(cam.rev).toBe('A')
    expect(cam.desc).toContain('Basler')
  })

  it('leaves the master part alone', () => {
    s().setUnitRev('T-16', FRONT, 'E')
    expect(partsFor('RG', s().overrides).find((p) => partId(p) === 'DMF-1650-F')!.rev).toBe('D')
    expect(s().overrides.subs.RG).toBeUndefined()
  })

  it('does not move any record key', () => {
    const before = unit('T-16').lines.map((l) => l.key)
    s().setUnitRev('T-16', FRONT, 'E')
    expect(unit('T-16').lines.map((l) => l.key)).toEqual(before)
  })
})

describe('assigning a Vue system to a machine', () => {
  /** T-32's tie-detection system in the shipped sheet. */
  const T32_SYSTEM = '000-20220920-0094'
  /** Unlocated in the sheet, Tie Detection, rev A. */
  const SPARE_TD = '000-20220914-0071'

  it('fits vision, and carries the serial and revision with it', () => {
    expect(unit('T-20').subs).not.toContain('VT')
    s().assignVue(SPARE_TD, 'T-20')
    const u = unit('T-20')
    expect(u.subs).toContain('VT')
    expect(u.serials.vue).toBe(SPARE_TD)
    expect(u.lines.find((l) => l.key === 'VT:APERA-VUE-TD')!.serial).toBe(SPARE_TD)
  })

  it('takes vision off the machine it came from', () => {
    s().assignVue(T32_SYSTEM, 'T-33')
    expect(unit('T-32').subs).not.toContain('VT')
    expect(unit('T-32').serials.vue).toBe('')
    expect(unit('T-33').subs).toContain('VT')
  })

  it('un-assigns rather than falling back to the sheet', () => {
    // The presence check. A `||` regression fails only here: '' is falsy, so a
    // truthiness read would silently restore the sheet's T-32.
    s().assignVue(T32_SYSTEM, '')
    expect(vueSystem(T32_SYSTEM, s().overrides)!.location).toBe('')
    expect(unit('T-32').subs).not.toContain('VT')
  })

  it('moves a system off the fleet', () => {
    s().assignVue(T32_SYSTEM, 'Office')
    expect(unit('T-32').subs).not.toContain('VT')
    expect(vueByUnit(s().overrides).has('T-32')).toBe(false)
  })

  it('gives a machine one system, displacing whatever was on it', () => {
    const displaced = s().assignVue(SPARE_TD, 'T-32')
    expect(displaced).toBe(T32_SYSTEM)
    expect(unit('T-32').serials.vue).toBe(SPARE_TD)
    expect(vueSystem(T32_SYSTEM, s().overrides)!.location).toBe('')
    expect(doubleBooked(s().overrides)).toEqual([])
  })

  it('normalises a machine id typed loosely', () => {
    s().assignVue(SPARE_TD, ' t-20 ')
    expect(unit('T-20').subs).toContain('VT')
  })

  it('fits VG for a VGR licence', () => {
    s().assignVue('000-20230822-0229', 'T-20') // VGR premium
    expect(unit('T-20').subs).toContain('VG')
    expect(unit('T-20').subs).not.toContain('VT')
  })

  it('fits nothing for a system with no licence, but still records the serial', () => {
    s().assignVue('000-20230822-0228', 'T-20') // blank licence in the sheet
    expect(unit('T-20').subs).not.toContain('VT')
    expect(unit('T-20').subs).not.toContain('VG')
    expect(unit('T-20').serials.vue).toBe('000-20230822-0228')
  })

  it('records a system the sheet never had', () => {
    expect(
      s().addVueSystem({
        serial: '000-20250101-0001',
        license: 'Tie Detection',
        rev: 'B',
        location: 'T-20',
        notes: 'found in the shop',
      }),
    ).toBe(true)
    const u = unit('T-20')
    expect(u.subs).toContain('VT')
    expect(u.serials.vue).toBe('000-20250101-0001')
    // Rev B, so the camera is the IDS rather than the Basler.
    expect(u.lines.find((l) => l.part === 'VT-4110-02')!.desc).toContain('IDS')
    expect(vueSystem('000-20250101-0001', s().overrides)!.added).toBe(true)
  })

  it('refuses a serial that is already in the list', () => {
    expect(
      s().addVueSystem({ serial: T32_SYSTEM, license: '', rev: '', location: '', notes: '' }),
    ).toBe(false)
  })
})

describe('a machine hand-fitted with vision before a system was assigned', () => {
  const SPARE_TD = '000-20220914-0071'

  it('keeps the hand fitment while no system is assigned', () => {
    s().fitSub('T-20', 'VT')
    expect(unit('T-20').subs).toContain('VT')
    expect(s().overrides.units['T-20']?.subs).toBeDefined()
  })

  it('drops the pin the moment an assignment makes it redundant', () => {
    s().fitSub('T-20', 'VT')
    s().assignVue(SPARE_TD, 'T-20')
    // The pin is gone, but the machine still carries vision — and now its serial.
    expect(s().overrides.units['T-20']).toBeUndefined()
    expect(unit('T-20').subs).toContain('VT')
    expect(unit('T-20').serials.vue).toBe(SPARE_TD)
  })

  it('then tracks: moving the system away takes vision with it', () => {
    s().fitSub('T-20', 'VT')
    s().assignVue(SPARE_TD, 'T-20')
    s().assignVue(SPARE_TD, 'T-22')
    expect(unit('T-20').subs).not.toContain('VT')
    expect(unit('T-22').subs).toContain('VT')
  })

  it('keeps a hand fitment the system was never assigned to', () => {
    // The "don't destroy what I just did" case: no assignment ever reached it.
    s().fitSub('T-20', 'VT')
    s().assignVue(SPARE_TD, 'T-22')
    expect(unit('T-20').subs).toContain('VT')
    expect(visionWithoutSystem(fleetNow(), s().overrides).map((g) => g.unitId)).toContain('T-20')
  })

  it('keeps a hand fitment the licence disagrees with, and reports it', () => {
    s().fitSub('T-20', 'VG')
    s().assignVue(SPARE_TD, 'T-20') // a Tie Detection system
    expect(unit('T-20').subs).toContain('VG')
    expect(vueLicenceMismatch(fleetNow(), s().overrides)).toEqual([
      { unitId: 'T-20', serial: SPARE_TD, expected: 'VT', fitted: 'VG' },
    ])
  })

  it('strands no record when the pin drops', () => {
    const key = recordKey('T-20', 'VT:APERA-VUE-TD')
    const records: Records = { [key]: { serial: 'FIELD-1', status: 'verified' } }
    s().fitSub('T-20', 'VT')
    s().assignVue(SPARE_TD, 'T-20')
    expect(unit('T-20').lines.some((l) => l.key === 'VT:APERA-VUE-TD')).toBe(true)
    expect(resolveFleet(fleetNow(), records).resolved.get(key)!.serial).toBe('FIELD-1')
  })

  it('survives a strike', () => {
    // T-32 has a system from the sheet; striking VT must not be undone.
    s().strikeSub('T-32', 'VT')
    expect(unit('T-32').subs).not.toContain('VT')
    expect(s().overrides.units['T-32']?.subs).toBeDefined()
  })

  it('writes no override when a fit only restates the default', () => {
    s().strikeSub('T-32', 'VT')
    s().fitSub('T-32', 'VT')
    expect(s().overrides.units['T-32']).toBeUndefined()
    expect(unit('T-32').subs).toContain('VT')
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
