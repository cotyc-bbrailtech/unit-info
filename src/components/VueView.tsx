import { useState } from 'react'
import { ghostLocations, visionWithoutSystem } from '../lib/fleet'
import type { Unit, VueSystem } from '../lib/types'
import { doubleBooked, isUnitId, vueSystems } from '../lib/vue'
import { useStore } from '../store/useStore'
import { Corners } from './Corners'
import { ArrowLeft } from './Icons'
import { AssignVueDialog, VueCreateForm } from './VueAssign'
import { PLACES } from '../lib/vueCopy'

/** Where a system sits, and on whose word. */
function placement(v: VueSystem): { label: string; tag: string; note: string } {
  if (v.added) return { label: v.location || 'not located', tag: 'tag tag-outline', note: 'Added here' }
  if (v.assigned) {
    return {
      label: v.location || 'not located',
      tag: v.location ? 'tag tag-accent' : 'tag tag-outline',
      note: v.sheetLocation ? `Set here · sheet said ${v.sheetLocation}` : 'Set here · sheet had none',
    }
  }
  if (!v.location) return { label: 'not located', tag: 'tag tag-outline', note: 'No location' }
  if (isUnitId(v.location)) {
    return v.locationConfirmed
      ? { label: v.location, tag: 'tag tag-accent', note: 'Confirmed' }
      : { label: v.location, tag: 'tag tag-neutral', note: 'Estimate' }
  }
  return { label: v.location, tag: 'tag tag-neutral', note: 'Off fleet' }
}

const rank = (v: VueSystem) => (!v.location ? 0 : isUnitId(v.location) ? 2 : 1)

export function VueView({ fleet }: { fleet: Unit[] }) {
  const admin = useStore((s) => s.admin)
  const overrides = useStore((s) => s.overrides)
  const setView = useStore((s) => s.setView)
  const [adding, setAdding] = useState(false)
  const [assignTo, setAssignTo] = useState<string | null>(null)

  const systems = vueSystems(overrides)
  const onMachine = systems.filter((v) => isUnitId(v.location))
  const unlocated = systems.filter((v) => !v.location)
  const elsewhere = systems.length - onMachine.length - unlocated.length
  const setHere = systems.filter((v) => v.assigned || v.added).length

  const gaps = visionWithoutSystem(fleet, overrides)
  const doubles = doubleBooked(overrides)
  const ghosts = ghostLocations(fleet, overrides)

  const rows = [...systems].sort((a, b) => rank(a) - rank(b))

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
          {systems.length} Apera Vue systems · {onMachine.length} on fleet machines · {elsewhere} in
          the office, lab or stock · {unlocated.length} with no location recorded
          {setHere > 0 && ` · ${setHere} set here`}
        </p>
      </div>

      {(gaps.length > 0 || doubles.length > 0 || ghosts.length > 0) && (
        <div className="blueprint frame vue-recon">
          <Corners />
          <div className="meta-label text-muted">Sheet and machines disagree</div>

          {gaps.length > 0 && (
            <>
              <p className="fleet-summary text-muted">
                {gaps.length === 1
                  ? '1 machine carries a vision subassembly with no Apera Vue system against it. It was fitted by hand, so the machine says vision and the sheet does not.'
                  : `${gaps.length} machines carry a vision subassembly with no Apera Vue system against them. They were fitted by hand, so the machine says vision and the sheet does not.`}
                {admin &&
                  (gaps.length === 1
                    ? ' Assign a system to it, or strike the subassembly from the machine.'
                    : ' Assign a system to each, or strike the subassembly from the machine.')}
              </p>
              <table className="table table-gaps">
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th>Vision fitted</th>
                    <th>Vue serial</th>
                    <th>{admin ? 'Fix' : ''}</th>
                  </tr>
                </thead>
                <tbody>
                  {gaps.map((g) => (
                    <GapRow key={g.unitId + g.code} gap={g} admin={admin} onAssign={setAssignTo} />
                  ))}
                </tbody>
              </table>
            </>
          )}

          {doubles.map((d) =>
            d.sameSub ? (
              <div className="field-error" key={d.unitId}>
                {d.unitId} has two systems fitting the same subassembly —{' '}
                {d.serials.join(' and ')}. One of them is in the wrong place.
              </div>
            ) : (
              <div className="admin-note text-muted" key={d.unitId}>
                {d.unitId} carries two systems — {d.serials.join(' and ')}. Both are recorded, but
                only {d.serials[0]} drives its fitment, serial and revision; a machine holds one.
              </div>
            ),
          )}
          {ghosts.map((g) => (
            <div className="field-error" key={g.serial}>
              {g.serial} is on {g.location}, which isn't in the fleet.
            </div>
          ))}
        </div>
      )}

      <div className="blueprint frame">
        <Corners />
        {admin && (
          <div className="sub-scope text-muted">
            Assignment drives the machine — its vision subassembly, its Vue serial and its revision
            all follow the location you set here.
          </div>
        )}
        <table className={admin ? 'table table-vue is-admin' : 'table table-vue'}>
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
            {rows.map((v) => (
              <VueRow key={v.serial} v={v} admin={admin} fleet={fleet} />
            ))}
          </tbody>
        </table>
      </div>

      {admin && (
        <div className="vue-foot">
          {adding ? (
            <VueCreateForm onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
          ) : (
            <>
              <button className="btn btn-secondary" onClick={() => setAdding(true)}>
                + Add a system
              </button>
              <span className="group-spacer" />
              <span className="admin-note text-muted">
                The sheet is known to be short — 000-20240222-0421 had to be added by hand. Add any
                system it never had.
              </span>
            </>
          )}
        </div>
      )}

      <p className="fleet-summary text-muted">
        TeamViewer IDs and passwords from the source sheet are deliberately not held in this app —
        it is served publicly.
      </p>

      {assignTo && (
        <AssignVueDialog unitId={assignTo} fleet={fleet} onClose={() => setAssignTo(null)} />
      )}
    </div>
  )
}

function GapRow({
  gap,
  admin,
  onAssign,
}: {
  gap: { unitId: string; subName: string }
  admin: boolean
  onAssign: (unitId: string) => void
}) {
  const openUnit = useStore((s) => s.openUnit)
  return (
    <tr className="row-hit" onClick={() => openUnit(gap.unitId)}>
      <td className="cell-unit">{gap.unitId}</td>
      <td data-label="Vision fitted">{gap.subName}</td>
      <td data-label="Vue serial" className="text-muted">
        none on record
      </td>
      <td data-label="Fix">
        {admin && (
          <button
            className="btn btn-secondary btn-tiny"
            onClick={(e) => {
              e.stopPropagation()
              onAssign(gap.unitId)
            }}
          >
            Assign a system
          </button>
        )}
      </td>
    </tr>
  )
}

function VueRow({ v, admin, fleet }: { v: VueSystem; admin: boolean; fleet: Unit[] }) {
  const openUnit = useStore((s) => s.openUnit)
  const p = placement(v)
  const live = isUnitId(v.location) && fleet.some((u) => u.id === v.location)
  // A row that carries a control must not also navigate.
  const clickable = !admin && live

  return (
    <tr className={clickable ? 'row-hit' : undefined} onClick={clickable ? () => openUnit(v.location) : undefined}>
      <td className="cell-vue-serial">
        {v.serial}
        {v.added && <span className="tag tag-outline sub-row-origin">added here</span>}
      </td>
      <td data-label="Licence">{v.license || <span className="text-muted">—</span>}</td>
      <td data-label="Rev" className="cell-rev">
        rev {v.rev || '—'}
      </td>
      <td data-label="Location">
        {admin ? (
          <LocationPicker serial={v.serial} value={v.location} fleet={fleet} />
        ) : (
          <span className={p.tag}>{p.label}</span>
        )}
      </td>
      <td data-label="Standing" className="cell-standing text-muted">
        {p.note}
      </td>
      <td data-label="Notes" className="cell-vue-notes text-muted">
        {v.notes || '—'}
      </td>
    </tr>
  )
}

function LocationPicker({ serial, value, fleet }: { serial: string; value: string; fleet: Unit[] }) {
  const assignVue = useStore((s) => s.assignVue)
  const overrides = useStore((s) => s.overrides)
  const [other, setOther] = useState(false)

  // A sheet value like "Office Display", or an admin's free text: show the
  // truth rather than snapping it to a wrong option.
  const custom = !!value && !PLACES.includes(value) && !fleet.some((u) => u.id === value)
  const taken = new Set(
    vueSystems(overrides)
      .filter((v) => v.serial !== serial && isUnitId(v.location))
      .map((v) => v.location),
  )

  if (other || custom) {
    return (
      <div className="vue-loc-other">
        <input
          className="input"
          autoFocus={other}
          value={value}
          placeholder="where it is"
          onChange={(e) => assignVue(serial, e.target.value)}
        />
        <button
          className="btn btn-ghost btn-tiny"
          onClick={() => {
            setOther(false)
            assignVue(serial, '')
          }}
        >
          Clear
        </button>
      </div>
    )
  }

  return (
    <select
      className="input"
      value={value}
      onChange={(e) => (e.target.value === '__other' ? setOther(true) : assignVue(serial, e.target.value))}
    >
      <option value="">not located</option>
      <optgroup label="Places">
        {PLACES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
        <option value="__other">Other place…</option>
      </optgroup>
      <optgroup label="Machines">
        {fleet.map((u) => (
          <option key={u.id} value={u.id}>
            {u.id}
            {taken.has(u.id) ? ' — has a system' : ''}
          </option>
        ))}
      </optgroup>
    </select>
  )
}
