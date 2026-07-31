import { SUBS } from '../data/subassemblies'
import type { FleetResolution } from '../lib/records'
import type { Unit } from '../lib/types'
import { useStore } from '../store/useStore'
import { Corners } from './Corners'

export function FleetView({
  fleet: units,
  resolution,
}: {
  fleet: Unit[]
  resolution: FleetResolution
}) {
  const openUnit = useStore((s) => s.openUnit)
  const setView = useStore((s) => s.setView)
  const { coverage, fleet } = resolution

  const rows = [...units].sort((a, b) => coverage.get(a.id)!.pct - coverage.get(b.id)!.pct)

  return (
    <div className="pad-fleet">
      <div className="unit-head">
        <div>
          <h1>Fleet</h1>
          <p className="fleet-summary text-muted">
            {units.length} units · {fleet.pct}% of component lines on record · {fleet.flags} flagged
            for engineering (duplicate serials included)
          </p>
        </div>
        <button className="btn btn-secondary" onClick={() => setView('vue')}>
          Vue licences
        </button>
      </div>

      <div className="blueprint frame">
        <Corners />
        <table className="table table-fleet">
          <thead>
            <tr>
              <th>Unit</th>
              <th>Chassis VIN</th>
              <th>Subassemblies</th>
              <th>Record coverage</th>
              <th>Flags</th>
              <th>Last audit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((unit) => {
              const cov = coverage.get(unit.id)!
              return (
                <tr key={unit.id} className="row-hit" onClick={() => openUnit(unit.id)}>
                  <td className="cell-unit">{unit.id}</td>
                  <td data-label="VIN" className="cell-vin text-muted">
                    {unit.vin}
                  </td>
                  <td data-label="Subassemblies">
                    <div className="chip-row">
                      {unit.subs.map((code) => (
                        <span key={code} className="tag tag-neutral">
                          {SUBS[code].name.replace('Vision — ', 'V: ')}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td data-label="Coverage">
                    <div className="cell-cov">
                      <div className="track">
                        <div className="track-fill" style={{ width: `${cov.pct}%` }} />
                      </div>
                      <span className="cov-pct">{cov.pct}%</span>
                    </div>
                  </td>
                  <td
                    data-label="Flags"
                    className={cov.flags ? 'cell-flags' : 'cell-flags is-zero'}
                  >
                    {cov.flags || '—'}
                  </td>
                  <td data-label="Last audit" className="cell-audit text-muted">
                    {unit.lastAudit}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
