/**
 * The sentences the Vue assignment UI says. Here rather than in the component
 * so both surfaces read from one voice, and so they are testable without React.
 */
import { subName } from './overrides'
import type { Overrides } from './overrides'
import type { Unit, VueSystem } from './types'
import { isUnitId, subForLicense } from './vue'

export const PLACES = ['Office', 'Lab', 'Stock']

/** Every serial in the sheet reads like this. Warned about, never enforced. */
export const SERIAL_SHAPE = /^\d{3}-\d{8}-\d{4}$/

/** "not located" / "in the office" / "on T-32", for the middle of a sentence. */
export function whereWords(v: VueSystem): string {
  if (!v.location) return 'not located'
  return isUnitId(v.location) ? `on ${v.location}` : `in ${v.location.toLowerCase()}`
}

/**
 * Everything one choice is about to change, stated before it happens.
 * Assignment moves the fitment, the Vue serial and the camera variant at once,
 * which is more than a dropdown usually admits to.
 */
export function assignConsequence(
  unitId: string,
  v: VueSystem,
  unit: Unit | undefined,
  o: Overrides,
): string {
  const bits: string[] = []

  if (v.location && v.location !== unitId) {
    bits.push(
      isUnitId(v.location)
        ? `Moving it off ${v.location}.`
        : `Moving it out of ${v.location.toLowerCase()}.`,
    )
  }

  const code = subForLicense(v.license)
  if (!code) {
    bits.push(
      `The licence on ${v.serial} is blank, so it fits no vision subassembly. ${unitId}'s Vue serial becomes ${v.serial} and nothing else changes.`,
    )
    return bits.join(' ')
  }

  const name = subName(code, o)
  const lead = unit?.subs.includes(code)
    ? `${unitId} already carries ${name}. Its Vue serial becomes ${v.serial}`
    : `${unitId} gains ${name}, its Vue serial becomes ${v.serial}`

  // Only Tie Detection carries a revision-dependent part today.
  const camera =
    code !== 'VT'
      ? '.'
      : v.rev === 'A'
        ? ' — the camera is a Basler.'
        : v.rev === 'B'
          ? ' — the camera is an IDS rolling shutter.'
          : `. No camera variant is recorded for rev ${v.rev}, so that line will read “variant not identified for rev ${v.rev}”.`

  bits.push(`${lead}, and the vision parts read rev ${v.rev}${camera}`)

  const other = (['VT', 'VG'] as const).find((c) => c !== code && unit?.subs.includes(c))
  if (other) {
    bits.push(
      `${unitId} is fitted with ${subName(other, o)} as well. Both stay fitted — strike the one that isn't there from the machine's page.`,
    )
  }
  return bits.join(' ')
}

/**
 * What taking a system off does, which depends on how the machine got its
 * fitment: a hand-fitted machine keeps it, a sheet-derived one loses it.
 */
export function removalConsequence(v: VueSystem, o: Overrides): string {
  if (!isUnitId(v.location)) return 'nothing else changes.'
  const code = subForLicense(v.license)
  if (!code) return `${v.location} keeps whatever it carries — this system fits nothing.`
  const name = subName(code, o)
  return o.units[v.location]?.subs
    ? `${v.location} keeps ${name} and joins the list of machines with no system.`
    : `${v.location} loses ${name}.`
}
