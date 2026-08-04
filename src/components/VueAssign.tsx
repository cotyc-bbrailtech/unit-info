import { Fragment, useState } from 'react'
import type { Unit, VueLicense, VueSystem } from '../lib/types'
import { VUE_LICENCES } from '../lib/types'
import { isUnitId, vueSystems } from '../lib/vue'
import { assignConsequence, SERIAL_SHAPE, whereWords } from '../lib/vueCopy'
import { useStore } from '../store/useStore'
import { Corners } from './Corners'

export function AssignVueDialog({
  unitId,
  fleet,
  onClose,
}: {
  unitId: string
  fleet: Unit[]
  onClose: () => void
}) {
  const overrides = useStore((s) => s.overrides)
  const assignVue = useStore((s) => s.assignVue)
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const systems = vueSystems(overrides)
  const here = systems.find((v) => v.location === unitId)
  const unit = fleet.find((u) => u.id === unitId)
  const chosen = systems.find((v) => v.serial === pick)

  const match = (v: VueSystem) =>
    !q.trim() ||
    `${v.serial} ${v.license}`.toLowerCase().includes(q.trim().toLowerCase())

  const groups = [
    { label: 'Not located', rows: systems.filter((v) => !v.location && match(v)) },
    {
      label: 'Somewhere else',
      rows: systems.filter((v) => v.location && !isUnitId(v.location) && match(v)),
    },
    {
      label: 'On another machine',
      rows: systems.filter((v) => isUnitId(v.location) && v.location !== unitId && match(v)),
    },
  ].filter((g) => g.rows.length)

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog blueprint vue-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="av-title"
        onClick={(e) => e.stopPropagation()}
      >
        <Corners />
        <div className="dialog-title" id="av-title">
          {here ? `Change the Vue system on ${unitId}` : `Assign a Vue system to ${unitId}`}
        </div>

        {creating ? (
          <VueCreateForm
            framed={false}
            lockTo={unitId}
            onDone={onClose}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <>
            <div className="dialog-body">
              A tie-detection licence fits Vision — Tie Detection; a VGR licence fits Vision — VGR.
              The machine takes the system's revision.
            </div>

            <input
              className="input"
              value={q}
              placeholder="filter by serial or licence"
              onChange={(e) => setQ(e.target.value)}
            />

            <div className="vue-pick-list">
              {groups.map((g) => (
                <Fragment key={g.label}>
                  <div className="vue-pick-group meta-label text-muted">{g.label}</div>
                  {g.rows.map((v) => (
                    <button
                      key={v.serial}
                      type="button"
                      className={v.serial === pick ? 'vue-pick is-selected' : 'vue-pick'}
                      onClick={() => setPick(v.serial)}
                    >
                      <span className="vue-pick-serial">{v.serial}</span>
                      <span className="tag tag-neutral">{v.license || 'no licence'}</span>
                      <span className="vue-pick-rev text-muted">rev {v.rev}</span>
                      <span className="vue-pick-where text-muted">{v.location || 'not located'}</span>
                    </button>
                  ))}
                </Fragment>
              ))}
              {!groups.length && (
                <div className="group-empty text-muted">
                  {q.trim()
                    ? `Nothing matches “${q.trim()}”.`
                    : `Every Apera Vue system in the list is on a machine. If ${unitId} has one, it isn't recorded yet.`}
                </div>
              )}
            </div>

            {chosen && (
              <div className="vue-consequence">
                {assignConsequence(unitId, chosen, unit, overrides)}
              </div>
            )}

            <div className="dialog-actions">
              <button className="btn btn-ghost" onClick={() => setCreating(true)}>
                + Add a system
              </button>
              <span className="group-spacer" />
              <button className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={!chosen}
                onClick={() => {
                  assignVue(chosen!.serial, unitId)
                  onClose()
                }}
              >
                {chosen ? `Assign ${chosen.serial}` : 'Assign'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function VueCreateForm({
  framed = true,
  lockTo,
  onDone,
  onCancel,
}: {
  framed?: boolean
  lockTo?: string
  onDone: () => void
  onCancel: () => void
}) {
  const overrides = useStore((s) => s.overrides)
  const addVueSystem = useStore((s) => s.addVueSystem)
  const [d, setD] = useState({
    serial: '',
    license: '' as VueLicense,
    rev: '',
    location: lockTo ?? '',
    notes: '',
  })
  const [touched, setTouched] = useState(false)

  const serial = d.serial.trim()
  const dup = vueSystems(overrides).find((v) => v.serial === serial)
  const err = dup
    ? `${dup.serial} is already in the list, ${whereWords(dup)}.`
    : touched && !serial
      ? 'Give the system its serial number.'
      : null
  // Warned, never blocked: the shape is inferred from one vendor's sheet, and
  // the whole reason this exists is that that sheet was found incomplete.
  const odd = !!serial && !SERIAL_SHAPE.test(serial)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (addVueSystem({ ...d, serial })) onDone()
  }

  return (
    <form className={framed ? 'admin-block blueprint vue-create' : 'vue-create'} onSubmit={submit}>
      {framed && <Corners />}
      <div className="admin-block-title">
        {lockTo ? `Add a system · goes on ${lockTo}` : 'Add a system'}
      </div>

      <div className="admin-unit-grid">
        <div className="field">
          <label htmlFor="nv-serial">Serial</label>
          <input
            id="nv-serial"
            className="input serial-input"
            autoFocus
            autoComplete="off"
            placeholder="000-20240222-0421"
            value={d.serial}
            onBlur={() => setTouched(true)}
            onChange={(e) => setD({ ...d, serial: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="nv-lic">Licence</label>
          <select
            id="nv-lic"
            className="input"
            value={d.license}
            onChange={(e) => setD({ ...d, license: e.target.value as VueLicense })}
          >
            <option value="">none recorded</option>
            {VUE_LICENCES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="nv-rev">Revision</label>
          <input
            id="nv-rev"
            className="input code-input"
            maxLength={2}
            placeholder="A"
            value={d.rev}
            onChange={(e) => setD({ ...d, rev: e.target.value.toUpperCase() })}
          />
        </div>
        <div className="field">
          <label htmlFor="nv-loc">Location</label>
          {lockTo ? (
            <div className="meta-value">{lockTo}</div>
          ) : (
            <input
              id="nv-loc"
              className="input"
              placeholder="a machine id, a place, or leave blank"
              value={d.location}
              onChange={(e) => setD({ ...d, location: e.target.value })}
            />
          )}
        </div>
      </div>

      <div className="field">
        <label htmlFor="nv-notes">Notes</label>
        <input
          id="nv-notes"
          className="input"
          placeholder="where it came from, why it isn't in the sheet"
          value={d.notes}
          onChange={(e) => setD({ ...d, notes: e.target.value })}
        />
      </div>

      {err && <div className="field-error">{err}</div>}
      {odd && !err && (
        <div className="admin-note text-muted">
          Every serial in the sheet reads 000-YYYYMMDD-NNNN. This one doesn't — check it, then
          carry on if it's right.
        </div>
      )}
      <div className="admin-note text-muted">
        It joins the list marked “added here”.
        {lockTo
          ? ` Its licence decides which vision subassembly ${lockTo} gets.`
          : ' Set a location now, or leave it unlocated and assign it later.'}
      </div>

      <div className="master-actions">
        <button type="submit" className="btn btn-primary" disabled={!!err || !serial}>
          {lockTo ? `Add and assign to ${lockTo}` : 'Add system'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
