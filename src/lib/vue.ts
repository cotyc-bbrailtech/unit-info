import { parseCsvRows } from './csv'
import vueCsv from '../data/vue-licenses.csv?raw'
import type { SubCode } from './types'

export type VueLicense = 'Tie Detection' | 'VGR premium' | 'VGR enterprise' | ''

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

/**
 * Mostly transcribed from "Vue license notes.docx". The TeamViewer IDs and
 * passwords in that sheet are deliberately NOT imported — this app is served
 * publicly from GitHub Pages. Keep them out of the repo.
 *
 * The sheet lists 000-20230822-0228 on two rows with the same TeamViewer ID;
 * it is one unit and appears here once.
 *
 * 000-20240222-0421 (T-53) is NOT from that sheet — it postdates every serial
 * in it, so the notes are out of date. Expect more systems to be missing from
 * them, and treat the unlocated rows as a floor rather than the full backlog.
 */
export const VUE_UNITS: VueUnit[] = parseCsvRows(vueCsv).map((r) => ({
  serial: r.vue_serial,
  license: r.license as VueLicense,
  rev: r.revision,
  notes: r.notes,
  locationEstimate: r.location_estimate,
  locationConfirmed: r.location_confirmed,
}))

/** The subassembly a licence tier corresponds to, if any. */
export function subForLicense(license: VueLicense): SubCode | null {
  if (license === 'Tie Detection') return 'VT'
  if (license === 'VGR premium' || license === 'VGR enterprise') return 'VG'
  return null
}

const UNIT_ID = /^T-\d+$/

/** The location on record: confirmed wins over the estimate. */
export function locationOf(v: VueUnit): string {
  return v.locationConfirmed || v.locationEstimate
}

export function isOnMachine(v: VueUnit): boolean {
  return UNIT_ID.test(locationOf(v))
}

/** unit id → the Vue system installed on it. */
export const VUE_BY_UNIT: Map<string, VueUnit> = new Map(
  VUE_UNITS.filter(isOnMachine).map((v) => [locationOf(v), v]),
)
