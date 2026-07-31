import { describe, expect, it } from 'vitest'
import { BASE_FLEET as FLEET, linesFor } from './fleet'
import { recordKey, resolveFleet } from './records'
import { isOnMachine, locationOf, VUE_UNITS } from './vue'

const unit = (id: string) => FLEET.find((u) => u.id === id)!
const VUE_TD = 'VT:APERA-VUE-TD'

/** The camera line a tie-detection machine at the given Vue revision would get. */
const camFor = (vueRev: string) =>
  linesFor({
    id: 'T-XX',
    vin: 'VIN',
    subs: ['VT'],
    serials: { front: '', rear: '', loader: '', vue: '000-TEST-0001' },
    vueRev,
    lastAudit: 'never',
  }).find((l) => l.part === 'VT-4110-02')!

describe('Vue licence sheet', () => {
  it('holds every unique system from the sheet', () => {
    // 18 rows, but 000-20230822-0228 is listed twice.
    expect(VUE_UNITS).toHaveLength(17)
    expect(new Set(VUE_UNITS.map((v) => v.serial)).size).toBe(17)
  })

  it('carries no credentials', () => {
    // The source sheet pairs each system with a TeamViewer ID and password.
    // Neither may reach this bundle — it is served publicly. Asserted by shape
    // so this test never has to hold a real credential either.
    expect(Object.keys(VUE_UNITS[0]).map((k) => k.toLowerCase())).toEqual(
      expect.not.arrayContaining(['password', 'teamviewer', 'teamviewerid', 'pass']),
    )
    for (const v of VUE_UNITS) {
      for (const value of Object.values(v)) {
        // TeamViewer IDs are bare 9-10 digit numbers; Vue serials always carry
        // dashes, so nothing legitimate here looks like one.
        expect(value).not.toMatch(/^\d{9,10}$/)
      }
    }
  })

  it('parses a quoted field containing a comma', () => {
    const inop = VUE_UNITS.find((v) => v.serial === '000-20220914-0075')!
    expect(inop.notes).toBe('INOP, power supply')
    expect(inop.locationConfirmed).toBe('Office')
  })

  it('prefers a confirmed location over the estimate', () => {
    const demo = VUE_UNITS.find((v) => v.serial === '000-20220920-0096')!
    expect(demo.locationEstimate).toBe('Office Demo')
    expect(locationOf(demo)).toBe('Office Display')
    expect(isOnMachine(demo)).toBe(false)
  })

  it('splits into 4 on machines, 4 elsewhere, 9 unlocated', () => {
    const onMachine = VUE_UNITS.filter(isOnMachine)
    const unlocated = VUE_UNITS.filter((v) => !locationOf(v))
    expect(onMachine.map((v) => locationOf(v)).sort()).toEqual(['T-32', 'T-34', 'T-36', 'T-50'])
    expect(unlocated).toHaveLength(9)
    expect(VUE_UNITS.length - onMachine.length - unlocated.length).toBe(4)
  })
})

describe('vision subassemblies on the fleet', () => {
  it('gives Tie Detection only to the four machines the sheet places', () => {
    const withVt = FLEET.filter((u) => u.subs.includes('VT')).map((u) => u.id)
    expect(withVt.sort()).toEqual(['T-32', 'T-34', 'T-36', 'T-50'])
  })

  it('gives VGR to no machine — every VGR system is off the fleet', () => {
    expect(FLEET.filter((u) => u.subs.includes('VG'))).toHaveLength(0)
  })

  it('imports the Apera Vue serial onto the machine that carries it', () => {
    const line = unit('T-32').lines.find((l) => l.key === VUE_TD)!
    expect(line.serial).toBe('000-20220920-0094')
    expect(line.onRecord).toBe(true)
  })

  it('takes the revision from the sheet, not the part spec', () => {
    expect(unit('T-50').lines.find((l) => l.key === VUE_TD)!.rev).toBe('A')
  })

  it('counts the Vue serial towards coverage', () => {
    const rec = resolveFleet(FLEET, {}).resolved.get(recordKey('T-34', VUE_TD))!
    expect(rec.status).toBe('verified')
    expect(rec.serial).toBe('000-20220902-0063')
  })

  it('leaves the non-serialised vision parts unverified', () => {
    const { resolved } = resolveFleet(FLEET, {})
    expect(resolved.get(recordKey('T-36', 'VT:VT-4110-02'))!.status).toBe('open')
  })

  it('carries the real tie-detection parts and no edge compute unit', () => {
    const parts = unit('T-32').lines.filter((l) => l.sub === 'VT').map((l) => l.part)
    expect(parts).toEqual([
      'APERA-VUE-TD',
      'VT-4110-02',
      'VT-4200-01',
      'FX5UC-32MR/DS-TS',
      'VT-4410-01',
    ])
    expect(parts).not.toContain('VT-4305-02')
  })

  it('fits the Basler camera on a rev A machine', () => {
    // All four tie-detection machines are rev A in the licence sheet.
    for (const id of ['T-32', 'T-34', 'T-36', 'T-50']) {
      const cam = unit(id).lines.find((l) => l.part === 'VT-4110-02')!
      expect(cam.rev).toBe('A')
      expect(cam.desc).toBe('Industrial camera — Basler')
    }
  })

  it('fits the IDS rolling shutter on a rev B machine', () => {
    const cam = camFor('B')
    expect(cam.rev).toBe('B')
    expect(cam.desc).toBe('Industrial camera — IDS, rolling shutter')
  })

  it('says so rather than guessing when the revision names no variant', () => {
    expect(camFor('C').desc).toBe('Industrial camera — variant not identified for rev C')
  })

  it('raises no duplicate — every Vue serial is unique across the fleet', () => {
    const { resolved } = resolveFleet(FLEET, {})
    const dups = FLEET.flatMap((u) =>
      u.lines
        .filter((l) => l.key === VUE_TD)
        .filter((l) => resolved.get(recordKey(u.id, l.key))!.status === 'dup'),
    )
    expect(dups).toHaveLength(0)
  })
})
