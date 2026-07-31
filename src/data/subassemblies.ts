import type { SubCode, Subassembly } from '../lib/types'

/**
 * Part numbers and descriptions below the top level are placeholders — replace
 * with the real parts lists before shipping. Only DMF-1650-F/R and SERCO-8500
 * are real.
 */
export const SUBS: Record<SubCode, Subassembly> = {
  RG: {
    name: 'Rail Gear — DMF-1650',
    kind: 'common',
    parts: [
      { part: 'DMF-1650-F', desc: 'Front rail gear assembly, DMF-1650', rev: 'D', loc: 'Front frame / axle', slot: 'front' },
      { part: 'DMF-1650-R', desc: 'Rear rail gear assembly, DMF-1650', rev: 'D', loc: 'Rear frame / axle', slot: 'rear' },
      { part: 'DMF-1650-WH', desc: 'Guide wheel, flanged — DMF-1650 set', rev: 'C', loc: 'Front + rear / wheels' },
      { part: 'DMF-1650-CYL', desc: 'Hydraulic lift cylinder, DMF-1650', rev: 'B', loc: 'Front frame / lift' },
    ],
  },
  LD: {
    name: 'Loader — Serco 8500 series',
    kind: 'common',
    parts: [
      {
        part: 'SERCO-8500',
        desc: 'Serco 8500 series loader, main assembly',
        rev: 'E',
        loc: 'Deck / boom',
        slot: 'loader',
        spec: 'Capacity 1: 12,282 lb @ 5\'-0" · Capacity 2: 3,226 lb @ 25\'-0"',
      },
      { part: 'LD-2240-01', desc: 'Rotation bearing, slew', rev: 'A', loc: 'Deck / turret' },
      { part: 'LD-2310-03', desc: 'Grapple head, 42in', rev: 'C', loc: 'Boom tip' },
      { part: 'LD-2405-02', desc: 'Hydraulic valve bank, 6-section', rev: 'B', loc: 'Deck / valve enclosure' },
    ],
  },
  MG: {
    name: 'Magnet System',
    kind: 'common',
    parts: [
      // `id` holds the original part number so records captured before the
      // real manufacturer numbers were known stay attached. See lib/overrides.ts.
      {
        id: 'MG-3100-02',
        part: 'Molley ESB-32',
        desc: 'Electromagnet, 32in circular',
        rev: 'B',
        loc: 'Boom tip / magnet',
      },
      { part: 'MG-3220-04', desc: 'Generator, 20kW hydraulic', rev: 'D', loc: 'Deck / power pack' },
      { part: 'MG-3310-02', desc: 'Magnet controller', rev: 'C', loc: 'Deck / electrical cabinet' },
    ],
  },
  VT: {
    name: 'Vision — Tie Detection',
    kind: 'optional',
    parts: [
      {
        part: 'APERA-VUE-TD',
        desc: 'Apera Vue vision system, tie detection licence',
        rev: 'A',
        loc: 'Cab / rack',
        slot: 'vue',
      },
      {
        part: 'VT-4110-02',
        desc: 'Industrial camera',
        rev: 'A',
        loc: 'Underframe / center',
        byRev: { A: 'Basler', B: 'IDS, rolling shutter' },
      },
      { part: 'VT-4200-01', desc: 'LED bar illuminator', rev: 'A', loc: 'Underframe / center' },
      {
        part: 'FX5UC-32MR/DS-TS',
        desc: 'PLC, Mitsubishi FX5UC-32MR/DS-TS',
        rev: 'A',
        loc: 'Cab / rack',
      },
      { part: 'VT-4410-01', desc: 'Ethernet switch, GigE PoE', rev: 'A', loc: 'Cab / rack' },
    ],
  },
  VG: {
    name: 'Vision — VGR',
    kind: 'optional',
    parts: [
      {
        part: 'APERA-VUE-VGR',
        desc: 'Apera Vue vision system, VGR licence',
        rev: 'C',
        loc: 'Cab / rack',
        slot: 'vue',
      },
      { part: 'VG-5100-02', desc: 'VGR sensor head', rev: 'B', loc: 'Deck / mast' },
      { part: 'VG-5210-01', desc: 'Laser line projector', rev: 'A', loc: 'Deck / mast' },
      { part: 'VG-5320-03', desc: 'Vision controller', rev: 'C', loc: 'Cab / rack' },
    ],
  },
  RB: {
    name: 'Robot',
    kind: 'optional',
    parts: [
      { id: 'RB-6100-01', part: 'TX2-140', desc: '6-axis manipulator arm', rev: 'A', loc: 'Deck / robot base' },
      { id: 'RB-6200-02', part: 'CS-9-MP', desc: 'Robot controller', rev: 'B', loc: 'Deck / robot base' },
      { id: 'RB-6310-01', part: 'EMH-84', desc: 'End effector, tie plate gripper', rev: 'B', loc: 'Robot / tool flange' },
    ],
  },
  CV: {
    name: 'Conveyor',
    kind: 'optional',
    parts: [
      { part: 'CV-7100-03', desc: 'Conveyor frame, 12ft', rev: 'C', loc: 'Deck / rear' },
      { part: 'CV-7210-01', desc: 'Drive motor, hydraulic', rev: 'A', loc: 'Deck / rear' },
      { part: 'CV-7305-02', desc: 'Belt, smooth 18in', rev: 'B', loc: 'Deck / rear' },
    ],
  },
}

export const NOTES = {
  verified: 'Nameplate matched, no corrosion.',
  differs: 'Installed part is one rev behind the drawing — sent to engineering to confirm supersession.',
  absent: 'Not present on this unit; mounting provisions capped.',
  imported: 'Serial captured from the unit record sheet — not yet confirmed on the machine.',
  unique: 'Serial entered on the unit — unique across the fleet.',
}
