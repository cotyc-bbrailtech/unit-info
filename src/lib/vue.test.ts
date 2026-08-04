import { describe, expect, it } from 'vitest'
import { BASE_FLEET as FLEET, linesFor } from './fleet'
import { recordKey, resolveFleet } from './records'
import { locationOf, VUE_CSV, isUnitId } from './vue'

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
  it('holds every unique system', () => {
    // 17 from the licence notes (18 rows, but 000-20230822-0228 is listed
    // twice), plus 8 that postdate them: 000-20240222-0421 and the seven read
    // off machines in the 2026-08-04 audit.
    expect(VUE_CSV).toHaveLength(25)
    expect(new Set(VUE_CSV.map((v) => v.serial)).size).toBe(25)
  })

  it('carries no credentials', () => {
    // The source sheet pairs each system with a TeamViewer ID and password.
    // Neither may reach this bundle — it is served publicly. Asserted by shape
    // so this test never has to hold a real credential either.
    expect(Object.keys(VUE_CSV[0]).map((k) => k.toLowerCase())).toEqual(
      expect.not.arrayContaining(['password', 'teamviewer', 'teamviewerid', 'pass']),
    )
    for (const v of VUE_CSV) {
      for (const value of Object.values(v)) {
        // TeamViewer IDs are bare 9-10 digit numbers; Vue serials always carry
        // dashes, so nothing legitimate here looks like one.
        expect(value).not.toMatch(/^\d{9,10}$/)
      }
    }
  })

  it('parses a quoted field containing a comma', () => {
    const inop = VUE_CSV.find((v) => v.serial === '000-20220914-0075')!
    expect(inop.notes).toBe('INOP, power supply')
    expect(inop.locationConfirmed).toBe('Office')
  })

  it('prefers a confirmed location over the estimate', () => {
    const demo = VUE_CSV.find((v) => v.serial === '000-20220920-0096')!
    expect(demo.locationEstimate).toBe('Office Demo')
    expect(locationOf(demo)).toBe('Office Display')
    expect(isUnitId(locationOf(demo))).toBe(false)
  })

  it('splits into 12 on machines, 4 elsewhere, 9 unlocated', () => {
    const onMachine = VUE_CSV.filter((v) => isUnitId(locationOf(v)))
    const unlocated = VUE_CSV.filter((v) => !locationOf(v))
    expect(onMachine.map((v) => locationOf(v)).sort()).toEqual([
      'T-18',
      'T-29',
      'T-32',
      'T-33',
      'T-34',
      'T-35',
      'T-36',
      'T-37',
      'T-50',
      'T-52',
      'T-53',
      'T-57',
    ])
    expect(unlocated).toHaveLength(9)
    expect(VUE_CSV.length - onMachine.length - unlocated.length).toBe(4)
  })

  it('never puts two systems on one machine, which the importer rejects', () => {
    // T-53 and T-57 each physically carry a second, VGR system. They are in the
    // register but deliberately unplaced, because one machine holds one system
    // here and E-VUE-UNIT-TAKEN would reject the whole workbook.
    const machines = VUE_CSV.map((v) => locationOf(v)).filter(isUnitId)
    expect(new Set(machines).size).toBe(machines.length)
  })
})

describe('vision subassemblies on the fleet', () => {
  it('gives Tie Detection only to the machines a licence places', () => {
    const withVt = FLEET.filter((u) => u.subs.includes('VT')).map((u) => u.id)
    expect(withVt.sort()).toEqual([
      'T-18',
      'T-29',
      'T-32',
      'T-33',
      'T-34',
      'T-35',
      'T-36',
      'T-37',
      'T-50',
      'T-52',
      'T-53',
      'T-57',
    ])
  })

  it('gives VGR to no machine — both VGR systems on machines are unplaced', () => {
    // T-53 and T-57 carry one each, recorded in the register but not placed,
    // because each already holds a tie-detection system. Their VGR fitment can
    // only be a hand fitment until a machine can hold two systems.
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

  it('puts the camera and light bar on the front bumper', () => {
    // Real location, not the placeholder the parts list shipped with.
    const lines = unit('T-32').lines
    for (const part of ['VT-4110-02', 'VT-4200-01']) {
      expect(lines.find((l) => l.part === part)!.loc).toBe('Front bumper / center')
    }
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

  it('gives T-53 the rev B camera, not the rev A one its neighbours carry', () => {
    const cam = unit('T-53').lines.find((l) => l.part === 'VT-4110-02')!
    expect(cam.rev).toBe('B')
    expect(cam.desc).toBe('Industrial camera — IDS, rolling shutter')
    expect(unit('T-53').lines.find((l) => l.key === VUE_TD)!.serial).toBe('000-20240222-0421')
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

describe('a system with no revision on record', () => {
  it('says the variant is unknown rather than naming an empty revision', () => {
    // Seven systems were read off machines with no revision recorded. The
    // camera cannot be resolved from nothing, and the line has to say so.
    const t33 = FLEET.find((u) => u.id === 'T-33')!
    const cam = t33.lines.find((l) => l.key === 'VT:VT-4110-02')!
    expect(cam.rev).toBe('')
    expect(cam.desc).toBe('Industrial camera — variant unknown, no revision on record')
  })
})
