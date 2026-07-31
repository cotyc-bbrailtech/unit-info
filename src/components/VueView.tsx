import { isOnMachine, locationOf, VUE_UNITS } from '../lib/vue'
import type { VueUnit } from '../lib/vue'
import { useStore } from '../store/useStore'
import { Corners } from './Corners'
import { ArrowLeft } from './Icons'

/** Where a licence sits, and how sure we are. */
function placement(v: VueUnit): { label: string; tag: string; note: string } {
  const where = locationOf(v)
  if (!where) return { label: 'not located', tag: 'tag tag-outline', note: 'No location' }
  if (isOnMachine(v)) {
    return v.locationConfirmed
      ? { label: where, tag: 'tag tag-accent', note: 'Confirmed' }
      : { label: where, tag: 'tag tag-neutral', note: 'Estimate' }
  }
  return { label: where, tag: 'tag tag-neutral', note: 'Off fleet' }
}

export function VueView() {
  const setView = useStore((s) => s.setView)
  const openUnit = useStore((s) => s.openUnit)

  const onMachine = VUE_UNITS.filter(isOnMachine)
  const unlocated = VUE_UNITS.filter((v) => !locationOf(v))
  const elsewhere = VUE_UNITS.length - onMachine.length - unlocated.length

  // Unlocated first — that is the backlog.
  const rows = [...VUE_UNITS].sort((a, b) => rank(a) - rank(b))

  return (
    <div className="pad-fleet">
      <a
        className="back-link"
        href="#"
        onClick={(e) => {
          e.preventDefault()
          setView('fleet')
        }}
      >
        <ArrowLeft />
        Fleet
      </a>

      <div>
        <h1>Vue licences</h1>
        <p className="fleet-summary text-muted">
          {VUE_UNITS.length} Apera Vue systems · {onMachine.length} on fleet machines ·{' '}
          {elsewhere} in the office, lab or stock · {unlocated.length} with no location recorded
        </p>
      </div>

      <div className="blueprint frame">
        <Corners />
        <table className="table table-vue">
          <thead>
            <tr>
              <th>Vue serial</th>
              <th>Licence</th>
              <th>Rev</th>
              <th>Location</th>
              <th>Standing</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const p = placement(v)
              const machine = isOnMachine(v)
              return (
                <tr
                  key={v.serial}
                  className={machine ? 'row-hit' : undefined}
                  onClick={machine ? () => openUnit(locationOf(v)) : undefined}
                >
                  <td className="cell-vue-serial">{v.serial}</td>
                  <td data-label="Licence">{v.license || <span className="text-muted">—</span>}</td>
                  <td data-label="Rev" className="cell-rev">
                    rev {v.rev}
                  </td>
                  <td data-label="Location">
                    <span className={p.tag}>{p.label}</span>
                  </td>
                  <td data-label="Standing" className="cell-standing text-muted">
                    {p.note}
                  </td>
                  <td data-label="Notes" className="cell-vue-notes text-muted">
                    {v.notes || '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="fleet-summary text-muted">
        TeamViewer IDs and passwords from the source sheet are deliberately not held in this app —
        it is served publicly.
      </p>
    </div>
  )
}

function rank(v: VueUnit): number {
  if (!locationOf(v)) return 0
  return isOnMachine(v) ? 2 : 1
}
