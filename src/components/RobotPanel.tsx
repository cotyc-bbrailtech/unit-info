import { ROBOT_REPO, seconds } from '../lib/robots'
import type { Robot } from '../lib/robots'
import { Corners } from './Corners'

/** What is on record for the robot cell fitted to this machine. Read-only. */
export function RobotPanel({ robot }: { robot: Robot }) {
  const m = robot.metrics
  const dash = (v: string | number | null) => (v === null ? '—' : String(v))

  return (
    <div className="card blueprint robot-panel">
      <Corners />
      <div className="robot-head">
        <div className="meta-label text-muted">Robot cell · {robot.id}</div>
        <a href={ROBOT_REPO + robot.readme} target="_blank" rel="noreferrer">
          Pulled records
        </a>
      </div>
      <div className="robot-grid">
        <Meta label="Arm" value={dash(robot.arm_model)} />
        <Meta label="Arm serial" value={dash(robot.arm_serial)} />
        <Meta label="Controller serial" value={dash(robot.controller_serial)} />
        <Meta label="VAL3" value={dash(robot.val3_version)} />
        <Meta label="Apera pipeline" value={dash(robot.apera_pipeline)} />
        <Meta label="PLC program" value={dash(robot.plc)} />
        <Meta
          label="Cycle median / p90"
          value={`${seconds(m.median_s)} / ${seconds(m.p90_s)}`}
        />
        <Meta label="Cycles measured" value={m.cycles === null ? '—' : m.cycles.toLocaleString()} />
        <Meta label="Latest backup" value={dash(robot.latest_backup)} />
        <Meta label="Latest code" value={dash(robot.latest_code)} />
      </div>
      {robot.open_issues.length > 0 && (
        <details className="robot-issues">
          <summary className="meta-label">Open issues ({robot.open_issues.length})</summary>
          <ul>
            {robot.open_issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="meta-label text-muted">{label}</div>
      <div className="meta-value">{value}</div>
    </div>
  )
}
