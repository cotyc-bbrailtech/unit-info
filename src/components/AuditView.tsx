import { NOTES } from '../data/subassemblies'
import { recordKey, serialOf } from '../lib/records'
import type { FleetResolution } from '../lib/records'
import { badge } from '../lib/status'
import type { Unit } from '../lib/types'
import { useStore } from '../store/useStore'
import { Corners } from './Corners'
import { Camera } from './Icons'

export function AuditView({ unit, resolution }: { unit: Unit; resolution: FleetResolution }) {
  const stepRaw = useStore((s) => s.step)
  const records = useStore((s) => s.records)
  const pending = useStore((s) => s.pending)
  const requirePhoto = useStore((s) => s.requirePhoto)
  const setRecord = useStore((s) => s.setRecord)
  const setStep = useStore((s) => s.setStep)
  const sync = useStore((s) => s.sync)

  const lines = unit.lines
  const step = Math.min(stepRaw, lines.length - 1)
  const line = lines[step]
  const rec = resolution.resolved.get(recordKey(unit.id, line.key))!
  const b = badge(rec.status)

  const advance = () => setStep(Math.min(step + 1, lines.length - 1))
  const showBanner = rec.status === 'flagged' || rec.status === 'dup'

  return (
    <div className="audit-wrap">
      <div className="bezel">
        <div className="screen">
          <div className="statusbar">
            <span>9:41</span>
            <span>LTE</span>
          </div>

          <div className="phone-head">
            <div className="phone-head-row">
              <div>
                <div className="phone-title">{unit.id}</div>
                <div className="phone-sub text-muted">{line.subName}</div>
              </div>
              <div className="phone-progress">
                {step + 1} / {lines.length}
              </div>
            </div>
            <div className="phone-track">
              <div
                className="track-fill"
                style={{ width: `${Math.round(((step + 1) / lines.length) * 100)}%` }}
              />
            </div>
          </div>

          <div className="phone-body">
            <div className="card blueprint phone-card">
              <Corners />
              <div className="phone-card-head">
                <div className="card-kicker">{line.loc}</div>
                <span className={b.cls}>{b.label}</span>
              </div>
              <div>
                <div className="phone-part">{line.part}</div>
                <div className="phone-desc">{line.desc}</div>
              </div>
              <div className="chip-row">
                <span className="tag tag-neutral">rev {line.rev}</span>
              </div>
              <div className="field">
                <label htmlFor="audit-serial">Serial number</label>
                <input
                  id="audit-serial"
                  className="input"
                  type="text"
                  placeholder="type or read from the nameplate"
                  value={serialOf(unit, line, records)}
                  onChange={(e) => setRecord(unit, line, { serial: e.target.value })}
                />
              </div>
              <figure className="blueprint duotone photo" style={{ height: 104 }}>
                <Corners />
                <figcaption className="text-muted">
                  {rec.photo ? `photo captured · ${line.part}.jpg` : 'no photo yet'}
                </figcaption>
              </figure>
              <button
                className="btn btn-secondary btn-block"
                onClick={() => setRecord(unit, line, { photo: !rec.photo })}
              >
                <Camera />
                {rec.photo ? 'Retake photo' : 'Take photo'}
              </button>
            </div>

            {showBanner && (
              <div className="blueprint flag-banner">
                <Corners />
                <div className="meta-label">
                  {rec.status === 'dup'
                    ? 'Duplicate serial — engineering review'
                    : 'Flagged for engineering'}
                </div>
                <div className="flag-banner-note">{rec.note || NOTES.differs}</div>
              </div>
            )}

            <span className="phone-spacer" />

            <div className="phone-actions">
              <div className="phone-actions-row">
                <button
                  className="btn btn-primary blueprint btn-present"
                  onClick={() => {
                    // Guard rail: the first press captures the missing photo
                    // instead of advancing.
                    if (requirePhoto && !rec.photo) {
                      setRecord(unit, line, { photo: true })
                      return
                    }
                    setRecord(unit, line, { status: 'verified', note: NOTES.verified })
                    advance()
                  }}
                >
                  <Corners />
                  Present, as listed
                </button>
                <button
                  className="btn btn-secondary btn-differs"
                  onClick={() => setRecord(unit, line, { status: 'flagged', note: NOTES.differs })}
                >
                  Differs
                </button>
              </div>
              <div className="phone-actions-row">
                <button
                  className="btn btn-secondary btn-half"
                  onClick={() => setStep(Math.max(0, step - 1))}
                >
                  Back
                </button>
                <button
                  className="btn btn-secondary btn-half"
                  onClick={() => {
                    setRecord(unit, line, { status: 'absent', note: NOTES.absent })
                    advance()
                  }}
                >
                  Not present
                </button>
              </div>
            </div>
          </div>

          <div className="phone-footer">
            <div className="phone-queue text-muted">
              <span className="phone-queue-dot" />
              <span>{pending.length} queued</span>
            </div>
            <button className="btn btn-ghost" onClick={sync}>
              Sync now
            </button>
          </div>
        </div>
      </div>
      <div className="queue-note text-muted">
        {pending.length} records held locally — they push to GitHub and the OneDrive workbook on the
        next sync.
      </div>
    </div>
  )
}
