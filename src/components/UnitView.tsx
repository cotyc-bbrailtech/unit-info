import { useMemo, useState } from 'react'
import { NOTES } from '../data/subassemblies'
import { buildFleet } from '../lib/fleet'
import { vueOn } from '../lib/vue'
import { AssignVueDialog } from './VueAssign'
import { removalConsequence } from '../lib/vueCopy'
import { partId, partsFor, subCodes, subName } from '../lib/overrides'
import { recordKey, serialOf } from '../lib/records'
import type { FleetResolution } from '../lib/records'
import { badge } from '../lib/status'
import type {
  Line,
  PartSpec,
  RecordEntry,
  Records,
  ResolvedRecord,
  Unit,
} from '../lib/types'
import { isGroupOpen, useStore } from '../store/useStore'
import { Corners } from './Corners'
import { ArrowLeft, Check, ChevronRight } from './Icons'

export function UnitView({ unit, resolution }: { unit: Unit; resolution: FleetResolution }) {
  const { resolved, coverage } = resolution
  const sel = useStore((s) => s.sel)
  const openGroups = useStore((s) => s.openGroups)
  const records = useStore((s) => s.records)
  const admin = useStore((s) => s.admin)
  const overrides = useStore((s) => s.overrides)
  const setView = useStore((s) => s.setView)
  const toggleGroup = useStore((s) => s.toggleGroup)
  const select = useStore((s) => s.select)
  const setRecord = useStore((s) => s.setRecord)
  const addPart = useStore((s) => s.addPart)
  const strikeSub = useStore((s) => s.strikeSub)

  const cov = coverage.get(unit.id)!
  const selLine = unit.lines.find((l) => l.key === sel) ?? unit.lines[0]

  return (
    <div className="pad-unit">
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

      <div className="unit-head">
        <div>
          <h2>{unit.id}</h2>
          <div className="unit-meta text-muted">
            VIN {unit.vin} · {unit.lines.length} lines · {unit.subs.length} subassemblies ·{' '}
            {cov.verified}/{cov.total} on record
          </div>
        </div>
        <button className="btn btn-primary blueprint" onClick={() => setView('phone')}>
          <Corners />
          Continue audit
        </button>
      </div>

      {admin && <AdminUnitPanel unit={unit} />}

      <div className="two-col">
        <div className="blueprint line-panel">
          <Corners />
          {unit.subs.map((code) => {
            const groupLines = unit.lines.filter((l) => l.sub === code)
            const verified = groupLines.filter(
              (l) => resolved.get(recordKey(unit.id, l.key))!.status === 'verified',
            ).length
            const pct = groupLines.length
              ? Math.round((verified / groupLines.length) * 100)
              : 0
            const open = isGroupOpen(openGroups, code, unit.subs[0])

            return (
              <div className="group" key={code}>
                <div className="group-head row-hit" onClick={() => toggleGroup(code, unit.subs[0])}>
                  <span className={open ? 'caret is-open' : 'caret'}>
                    <ChevronRight />
                  </span>
                  <span className="group-name">{subName(code, overrides)}</span>
                  <span className="group-spacer" />
                  {admin && (
                    <span className="group-admin" onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-ghost btn-tiny" onClick={() => select(addPart(code))}>
                        + Part
                      </button>
                      <button
                        className="btn btn-ghost btn-tiny"
                        onClick={() => strikeSub(unit.id, code)}
                      >
                        Strike
                      </button>
                    </span>
                  )}
                  <span className="group-summary text-muted">
                    {verified}/{groupLines.length}
                  </span>
                  <div className="group-track">
                    <div className="track-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                {open && (
                  <div className="group-lines">
                    {groupLines.map((line) => (
                      <LineRow
                        key={line.key}
                        unit={unit}
                        line={line}
                        resolution={resolution}
                        selected={line.key === selLine?.key}
                        onSelect={() => select(line.key)}
                      />
                    ))}
                    {!groupLines.length && (
                      <div className="group-empty text-muted">No parts on this subassembly.</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {!unit.subs.length && (
            <div className="group-empty text-muted">No subassemblies fitted to this machine.</div>
          )}
        </div>

        {selLine ? (
          <div className="card blueprint detail">
            <Corners />
            <DetailPanel
              unit={unit}
              line={selLine}
              rec={resolved.get(recordKey(unit.id, selLine.key))!}
              records={records}
              admin={admin}
              rawPart={partsFor(selLine.sub, overrides).find((p) => partId(p) === partId(selLine))}
              onRecord={(patch) => setRecord(unit, selLine, patch)}
            />
          </div>
        ) : (
          <div className="card blueprint detail">
            <Corners />
            <div className="text-muted">Nothing to show — this machine has no component lines.</div>
          </div>
        )}
      </div>
    </div>
  )
}

function DetailPanel({
  unit,
  line,
  rec,
  records,
  admin,
  rawPart,
  onRecord,
}: {
  unit: Unit
  line: Line
  rec: ResolvedRecord
  records: Records
  admin: boolean
  rawPart: PartSpec | undefined
  onRecord: (patch: RecordEntry) => void
}) {
  const b = badge(rec.status)
  const editPart = useStore((s) => s.editPart)
  const removePart = useStore((s) => s.removePart)
  const setUnitRev = useStore((s) => s.setUnitRev)
  const pid = partId(line)

  // The Vue revision and the byRev variant come from the machine, so those
  // fields aren't the part's to edit at master level.
  const revFromMachine = !!(rawPart?.slot === 'vue' || rawPart?.byRev)
  // On a machine with no Vue system the same part falls back to the master
  // revision, so the copy must not claim a system this machine hasn't got.
  const revFromVue = revFromMachine && !!unit.vueRev
  const unitRev = unit.revs?.[line.key] ?? ''
  /** What this line would read if the per-machine revision were cleared. */
  const inheritedRev = revFromMachine ? (unit.vueRev ?? rawPart?.rev ?? '') : (rawPart?.rev ?? '')

  return (
    <>
      <div className="detail-head">
        <div>
          <div className="detail-part">{line.part || <span className="text-muted">new part</span>}</div>
          <div className="detail-desc">{line.desc}</div>
        </div>
        <span className={b.cls}>{b.label}</span>
      </div>

      {admin && rawPart && (
        <div className="admin-block blueprint">
          <Corners />
          <div className="admin-block-title">Edit part · master list</div>
          <div className="admin-note text-muted">
            Applies to every machine carrying {line.subName}.
          </div>
          <div className="field">
            <label htmlFor="ap-part">Part number</label>
            <input
              id="ap-part"
              className="input"
              value={rawPart.part}
              onChange={(e) => editPart(line.sub, pid, { part: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="ap-desc">Description</label>
            <input
              id="ap-desc"
              className="input"
              value={rawPart.desc}
              onChange={(e) => editPart(line.sub, pid, { desc: e.target.value })}
            />
          </div>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="ap-rev">Revision</label>
              <input
                id="ap-rev"
                className="input"
                value={rawPart.rev}
                disabled={revFromMachine}
                onChange={(e) => editPart(line.sub, pid, { rev: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="ap-loc">Location on unit</label>
              <input
                id="ap-loc"
                className="input"
                value={rawPart.loc}
                onChange={(e) => editPart(line.sub, pid, { loc: e.target.value })}
              />
            </div>
          </div>
          {revFromMachine && (
            <div className="admin-note text-muted">
              {revFromVue ? (
                <>
                  Revision comes from this machine's Vue system, not the part. Set one below to
                  override it on this machine.
                </>
              ) : (
                <>
                  This revision follows the machine's Vue system, and {unit.id} has none — so it
                  falls back to the master part. Assign a system, or set one below for this
                  machine.
                </>
              )}
            </div>
          )}
          <button className="btn btn-secondary btn-block" onClick={() => removePart(line.sub, pid)}>
            Remove part from {line.subName}
          </button>
        </div>
      )}

      {admin && rawPart && (
        <div className="admin-block admin-unit-only blueprint">
          <Corners />
          <div className="admin-block-title">Revision · {unit.id} only</div>
          <div className="field">
            <label htmlFor="au-rev">Revision on this machine</label>
            <input
              id="au-rev"
              className="input"
              value={unitRev}
              placeholder={`${inheritedRev || 'none'} — from ${
                revFromVue
                  ? "the machine's Vue system"
                  : revFromMachine
                    ? `the master part; ${unit.id} has no Vue system`
                    : 'the master part'
              }`}
              onChange={(e) => setUnitRev(unit.id, line.key, e.target.value)}
            />
          </div>
          <div className="admin-note text-muted">
            {unitRev ? (
              <>
                This machine is on rev {unitRev}; every other machine carrying {line.subName} stays
                on {inheritedRev || 'the master revision'}. Clear the field to put it back.
                {rawPart.byRev && ' The variant fitted follows this revision.'}
              </>
            ) : (
              <>
                Leave blank and this machine follows{' '}
                {revFromVue ? "its Vue system's revision" : 'the master part'}. Fill it in only
                when this one machine genuinely carries a different revision.
              </>
            )}
          </div>
        </div>
      )}

      <figure className="blueprint duotone photo" style={{ height: 130 }}>
        <Corners />
        <figcaption className="text-muted">
          {rec.photo ? `field photo · ${line.part}.jpg` : 'no photo on record'}
        </figcaption>
      </figure>

      {line.spec && (
        <div>
          <div className="meta-label text-muted">Rated capacity</div>
          <div className="meta-value">{line.spec}</div>
        </div>
      )}

      <div className="field">
        <label htmlFor="detail-serial">Serial number</label>
        <input
          id="detail-serial"
          className="input"
          type="text"
          placeholder="not recorded"
          value={serialOf(unit, line, records)}
          onChange={(e) => onRecord({ serial: e.target.value })}
        />
      </div>

      <div className="field-grid">
        <Meta
          label="Revision"
          value={`rev ${line.rev}${unit.revs?.[line.key] ? ' · this machine only' : ''}`}
        />
        <Meta label="Location on unit" value={line.loc} />
        <Meta label="Subassembly" value={line.subName} />
      </div>

      <div>
        <div className="meta-label text-muted">Note</div>
        <div className="detail-note">{rec.note || 'No note recorded yet.'}</div>
      </div>

      <div className="detail-actions">
        <button className="btn btn-secondary" onClick={() => onRecord({ status: 'verified' })}>
          <Check />
          Verified
        </button>
        <button
          className="btn btn-primary"
          onClick={() => onRecord({ status: 'flagged', note: NOTES.differs })}
        >
          Flag
        </button>
      </div>
    </>
  )
}

function AdminUnitPanel({ unit }: { unit: Unit }) {
  const editUnit = useStore((s) => s.editUnit)
  const fitSub = useStore((s) => s.fitSub)
  const overrides = useStore((s) => s.overrides)
  const unfitted = subCodes(overrides).filter((c) => !unit.subs.includes(c))

  return (
    <div className="admin-block blueprint admin-unit">
      <Corners />
      <div className="admin-block-title">Edit machine · {unit.id}</div>
      <div className="admin-unit-grid">
        <div className="field">
          <label htmlFor="au-vin">Chassis VIN</label>
          <input
            id="au-vin"
            className="input"
            value={unit.vin}
            onChange={(e) => editUnit(unit.id, { vin: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="au-front">Rail gear front serial</label>
          <input
            id="au-front"
            className="input"
            value={unit.serials.front}
            onChange={(e) => editUnit(unit.id, { serials: { front: e.target.value } })}
          />
        </div>
        <div className="field">
          <label htmlFor="au-rear">Rail gear rear serial</label>
          <input
            id="au-rear"
            className="input"
            value={unit.serials.rear}
            onChange={(e) => editUnit(unit.id, { serials: { rear: e.target.value } })}
          />
        </div>
        <div className="field">
          <label htmlFor="au-loader">Serco loader serial</label>
          <input
            id="au-loader"
            className="input"
            value={unit.serials.loader}
            onChange={(e) => editUnit(unit.id, { serials: { loader: e.target.value } })}
          />
        </div>
      </div>
      <VueSection unit={unit} />

      {unfitted.length > 0 && (
        <div className="admin-fit">
          <span className="meta-label text-muted">Fit a subassembly</span>
          <div className="admin-fit-row">
            {unfitted.map((code) => (
              <button
                key={code}
                className="btn btn-secondary btn-tiny"
                onClick={() => fitSub(unit.id, code)}
              >
                + {subName(code, overrides)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * `serials.vue` is the one identity field this panel could never edit, because
 * it comes from the Vue sheet. Assigning a system is what fills it — and that
 * one act also decides the machine's vision fitment and its camera variant.
 */
function VueSection({ unit }: { unit: Unit }) {
  const overrides = useStore((s) => s.overrides)
  const assignVue = useStore((s) => s.assignVue)
  const setView = useStore((s) => s.setView)
  const [assigning, setAssigning] = useState(false)

  const fleet = useMemo(() => buildFleet(overrides), [overrides])
  const vue = vueOn(unit.id, overrides)
  const vision = (['VT', 'VG'] as const).filter((c) => unit.subs.includes(c))

  return (
    <div className="admin-fit admin-vue">
      <span className="meta-label text-muted">Vue system</span>

      {vue ? (
        <>
          <div className="admin-vue-line">
            <span className="cell-vue-serial">{vue.serial}</span>
            <span className="tag tag-accent">{vue.license || 'no licence recorded'}</span>
            <span className="text-muted">rev {vue.rev || '—'}</span>
            <span className="group-spacer" />
            <button className="btn btn-secondary btn-tiny" onClick={() => setAssigning(true)}>
              Change
            </button>
            <button className="btn btn-secondary btn-tiny" onClick={() => assignVue(vue.serial, '')}>
              Take it off
            </button>
          </div>
          <div className="admin-note text-muted">
            {vision.length
              ? `Carries ${vision.map((c) => subName(c, overrides)).join(' and ')}. Its Vue serial is ${vue.serial} and the vision parts read rev ${vue.rev}.`
              : `${unit.id} is not fitted with a vision subassembly, so this system's serial has nowhere to show.`}{' '}
            Take it off and {removalConsequence(vue, overrides)}
          </div>
        </>
      ) : (
        <>
          <div className="admin-vue-line">
            <span className="text-muted">
              {vision.length ? 'No system on record.' : 'None on this machine.'}
            </span>
            <span className="group-spacer" />
            <button className="btn btn-secondary btn-tiny" onClick={() => setAssigning(true)}>
              Assign a system
            </button>
          </div>
          <div className="admin-note text-muted">
            {vision.length ? (
              <>
                {unit.id} is fitted with {vision.map((c) => subName(c, overrides)).join(' and ')} and
                carries no Apera Vue system, so the vision line has no serial and its parts fall back
                to the master revision. Assign one, or strike it from the group below.{' '}
                <button className="btn btn-ghost btn-tiny" onClick={() => setView('vue')}>
                  Vue licences
                </button>
              </>
            ) : (
              <>
                No Apera Vue system on this machine, and no vision subassembly fitted. Assigning one
                fits the subassembly its licence calls for.
              </>
            )}
          </div>
        </>
      )}

      {assigning && (
        <AssignVueDialog unitId={unit.id} fleet={fleet} onClose={() => setAssigning(false)} />
      )}
    </div>
  )
}

function LineRow({
  unit,
  line,
  resolution,
  selected,
  onSelect,
}: {
  unit: Unit
  line: Line
  resolution: FleetResolution
  selected: boolean
  onSelect: () => void
}) {
  const rec = resolution.resolved.get(recordKey(unit.id, line.key))!
  const b = badge(rec.status)
  return (
    <div
      className={selected ? 'row-hit line-row is-selected' : 'row-hit line-row'}
      onClick={onSelect}
    >
      <span className="line-dot" style={{ background: b.dot }} />
      <span className="line-part">{line.part || <span className="text-muted">new part</span>}</span>
      <span className="line-desc">{line.desc}</span>
      <span className="line-status text-muted">{b.label}</span>
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
