import robotsJson from '../data/robots.json'

/**
 * One robot cell as recorded in Raiv-trucks `robots/index.json`, which is built
 * from the files pulled off the OneDrive robot folders. Copied here verbatim, so
 * every field is what a pulled file stated; `null` means no file stated it.
 * Read-only: this app does not audit robots, it only shows what is on record.
 */
export interface Robot {
  id: string
  /** The fleet unit the cell is mounted on; `null` for the lab bench. */
  unit: string | null
  name: string | null
  arm_model: string | null
  arm_serial: string | null
  controller_model: string | null
  controller_serial: string | null
  val3_version: string | null
  apera_serial: string | null
  apera_version: string | null
  apera_pipeline: string | null
  plc: string | null
  plc_version: string | null
  hmi: string | null
  metrics: {
    cycles: number | null
    mean_s: number | null
    median_s: number | null
    p90_s: number | null
    best_s: number | null
    per_min: number | null
    date_range: string | null
    source: string | null
  }
  latest_backup: string | null
  latest_backup_date: string | null
  latest_code: string | null
  latest_code_date: string | null
  open_issues: string[]
  readme: string
}

export const ROBOTS: Robot[] = (robotsJson as { robots: Robot[] }).robots

/** Where `readme` and the rest of a robot's pulled files live. */
export const ROBOT_REPO = 'https://github.com/cotyc-bbrailtech/Raiv-trucks/blob/main/'

export function robotOn(unitId: string): Robot | undefined {
  return ROBOTS.find((r) => r.unit === unitId)
}

/** Seconds to two places, or an em dash when no file stated the figure. */
export function seconds(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(2)} s`
}
