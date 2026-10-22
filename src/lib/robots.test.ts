import { describe, expect, it } from 'vitest'
import { BASE_FLEET as FLEET } from './fleet'
import { ROBOTS, robotOn, seconds } from './robots'

describe('robot cells', () => {
  it('places every truck robot on a machine that exists in the fleet', () => {
    const ids = new Set(FLEET.map((u) => u.id))
    for (const r of ROBOTS.filter((r) => r.unit !== null)) expect(ids).toContain(r.unit)
  })

  it('holds at most one robot per machine', () => {
    const units = ROBOTS.map((r) => r.unit).filter((u) => u !== null)
    expect(new Set(units).size).toBe(units.length)
  })

  it('finds the three robot trucks and nothing on a machine without one', () => {
    expect(robotOn('T-53')?.id).toBe('1RT53')
    expect(robotOn('T-57')?.id).toBe('2RT57')
    expect(robotOn('T-51')?.id).toBe('3RT51')
    expect(robotOn('T-16')).toBeUndefined()
  })

  it('shows an unstated figure as a dash, never as zero', () => {
    expect(seconds(null)).toBe('—')
    expect(seconds(4.3125)).toBe('4.31 s')
  })
})
