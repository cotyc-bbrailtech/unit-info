import { Fragment, useEffect, useRef, useState } from 'react'
import {
  partId,
  partsFor,
  recordsFor,
  recordsOnSub,
  subCodeError,
  subCodes,
  subDef,
  subNameError,
  unitsWith,
} from '../lib/overrides'
import type { PartSpec, SubCode, SubKind, Unit } from '../lib/types'
import { SERIAL_SLOTS } from '../lib/master/schema'
import { useStore } from '../store/useStore'
import { Corners } from './Corners'
import { ArrowLeft, ChevronRight } from './Icons'
import { MasterDataPanel } from './MasterDataPanel'

type Mode = { at: 'edit' } | { at: 'create' }

export function SubsView({ fleet }: { fleet: Unit[] }) {
  const overrides = useStore((s) => s.overrides)
  const records = useStore((s) => s.records)
  const setView = useStore((s) => s.setView)

  const codes = subCodes(overrides)
  const [code, setCode] = useState<SubCode>(codes[0])
  const [mode, setMode] = useState<Mode>({ at: 'edit' })
  const [openPart, setOpenPart] = useState<string | null>(null)

  // A subassembly can vanish under us — a workbook import, or a revert.
  const selected = codes.includes(code) ? code : codes[0]
  const partCount = codes.reduce((n, c) => n + partsFor(c, overrides).length, 0)

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

      <div>
        <h1>Subassemblies</h1>
        <p className="fleet-summary text-muted">
          {codes.length} subassemblies · {partCount} parts on the master lists · every edit here
          reaches every machine carrying the subassembly
        </p>
      </div>

      <div className="two-col two-col-index">
        <div className="blueprint sub-index">
          <Corners />
          <div className="sub-index-list">
            {codes.map((c) => {
              const d = subDef(c, overrides)
              const fitted = unitsWith(c, fleet).length
              return (
                <button
                  key={c}
                  type="button"
                  className={c === selected && mode.at === 'edit' ? 'sub-row is-selected' : 'sub-row'}
                  onClick={() => {
                    setCode(c)
                    setMode({ at: 'edit' })
                    setOpenPart(null)
                  }}
                >
                  <span className="sub-row-code">{c}</span>
                  <span className="sub-row-name">{d.name}</span>
                  <span className="sub-row-meta text-muted">
                    {d.kind} · {d.parts.length} {d.parts.length === 1 ? 'part' : 'parts'} ·{' '}
                    {fitted ? `${fitted} ${fitted === 1 ? 'machine' : 'machines'}` : 'not fitted'}
                    {!d.builtIn && <span className="tag tag-outline sub-row-origin">added here</span>}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="sub-index-foot">
            <button className="btn btn-secondary btn-block" onClick={() => setMode({ at: 'create' })}>
              + New subassembly
            </button>
          </div>
        </div>

        {mode.at === 'create' ? (
          <SubCreateForm
            onDone={(c) => {
              setCode(c)
              setMode({ at: 'edit' })
            }}
            onCancel={() => setMode({ at: 'edit' })}
          />
        ) : (
          <SubEditor
            code={selected}
            fleet={fleet}
            records={records}
            openPart={openPart}
            setOpenPart={setOpenPart}
          />
        )}
      </div>

      <MasterDataPanel fleet={fleet} />
    </div>
  )
}

function SubCreateForm({
  onDone,
  onCancel,
}: {
  onDone: (code: SubCode) => void
  onCancel: () => void
}) {
  const overrides = useStore((s) => s.overrides)
  const createSub = useStore((s) => s.createSub)
  const addPart = useStore((s) => s.addPart)
  const [draft, setDraft] = useState({ code: '', name: '', kind: 'optional' as SubKind })
  const [touched, setTouched] = useState(false)

  const codeErr = draft.code ? subCodeError(draft.code, overrides) : null
  const nameErr = touched ? subNameError(draft.name) : null
  const valid = !subCodeError(draft.code, overrides) && !subNameError(draft.name)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!createSub(draft.code, draft.name, draft.kind)) return
    const code = draft.code.trim().toUpperCase()
    // Nobody creates a subassembly to look at it — start it with a row to type into.
    addPart(code)
    onDone(code)
  }

  return (
    <form className="admin-block blueprint sub-editor-pane" onSubmit={submit}>
      <Corners />
      <div className="admin-block-title">New subassembly</div>

      <div className="admin-unit-grid">
        <div className="field">
          <label htmlFor="new-code">Code</label>
          <input
            id="new-code"
            className="input code-input"
            value={draft.code}
            maxLength={4}
            autoComplete="off"
            autoFocus
            onChange={(e) =>
              setDraft({ ...draft, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })
            }
          />
        </div>
        <div className="field">
          <label htmlFor="new-name">Name</label>
          <input
            id="new-name"
            className="input"
            value={draft.name}
            onBlur={() => setTouched(true)}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div className="field">
          <span className="field-label">Kind</span>
          <KindControl
            name="new-kind"
            value={draft.kind}
            onChange={(kind) => setDraft({ ...draft, kind })}
          />
        </div>
      </div>

      {codeErr && <div className="field-error">{codeErr}</div>}
      {nameErr && <div className="field-error">{nameErr}</div>}

      <div className="admin-note text-muted">
        The code is permanent — audit records are keyed to it, so it cannot be changed later. The
        name can be edited any time. Kind is a label for grouping only; it fits nothing to any
        machine. A new subassembly starts on no machines — fit it from each machine's page.
      </div>

      <div className="master-actions">
        <button type="submit" className="btn btn-primary" disabled={!valid}>
          Create subassembly
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function KindControl({
  name,
  value,
  onChange,
}: {
  name: string
  value: SubKind
  onChange: (k: SubKind) => void
}) {
  return (
    <div className="seg">
      {(['common', 'optional'] as SubKind[]).map((k) => (
        <label className="seg-opt" key={k}>
          <input type="radio" name={name} checked={value === k} onChange={() => onChange(k)} />
          {k === 'common' ? 'Common' : 'Optional'}
        </label>
      ))}
    </div>
  )
}

function SubEditor({
  code,
  fleet,
  records,
  openPart,
  setOpenPart,
}: {
  code: SubCode
  fleet: Unit[]
  records: Record<string, unknown>
  openPart: string | null
  setOpenPart: (id: string | null) => void
}) {
  const overrides = useStore((s) => s.overrides)
  const renameSub = useStore((s) => s.renameSub)
  const setSubKind = useStore((s) => s.setSubKind)
  const revertSub = useStore((s) => s.revertSub)
  const addPart = useStore((s) => s.addPart)
  const setView = useStore((s) => s.setView)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)

  const d = subDef(code, overrides)
  const parts = partsFor(code, overrides)
  const fitted = unitsWith(code, fleet).length
  const captured = recordsOnSub(code, overrides, fleet, records as never)
  const blanks = parts.filter((p) => !p.part.trim()).length

  return (
    <div className="sub-editor-pane">
      <div className="admin-block blueprint">
        <Corners />
        <div className="admin-block-title">Edit subassembly · {code}</div>

        <div className="admin-unit-grid">
          <div className="field">
            <label htmlFor="sub-name">Name</label>
            <input
              id="sub-name"
              className="input"
              value={d.name}
              onChange={(e) => renameSub(code, e.target.value)}
            />
          </div>
          <div className="field">
            <span className="field-label">Kind</span>
            <KindControl name={`kind-${code}`} value={d.kind} onChange={(k) => setSubKind(code, k)} />
          </div>
          <div>
            <div className="meta-label text-muted">Code</div>
            <div className="meta-value">{code}</div>
          </div>
        </div>

        <div className="admin-note text-muted">
          Kind is a label for grouping only — it fits nothing to any machine. Which machines carry
          this is set per machine, on the machine's own page. The code is fixed: audit records are
          keyed to it.
        </div>

        {!fitted && (
          <div className="admin-note text-muted">
            Not fitted to any machine yet — open a machine and use “Fit a subassembly”.{' '}
            <button className="btn btn-ghost btn-tiny" onClick={() => setView('fleet')}>
              Fleet
            </button>
          </div>
        )}

        {d.builtIn && (
          <div className="admin-fit-row">
            <button className="btn btn-secondary btn-tiny" onClick={() => revertSub(code)}>
              Revert to the shipped list
            </button>
          </div>
        )}
      </div>

      <div className="blueprint frame sub-parts">
        <Corners />
        <div className="sub-scope text-muted">
          {fitted ? (
            <>
              Master list · applies to <b>{fitted}</b> {fitted === 1 ? 'machine' : 'machines'} ·{' '}
              <b>{captured}</b> audit {captured === 1 ? 'record' : 'records'} captured
            </>
          ) : (
            <>Master list · not fitted to any machine yet — nothing downstream to change</>
          )}
        </div>

        <table className="table table-parts">
          <thead>
            <tr>
              <th className="th-caret">
                <span className="visually-hidden">Details</span>
              </th>
              <th>Part number</th>
              <th>Identity</th>
              <th>Description</th>
              <th>Rev</th>
              <th>Location on unit</th>
              <th>Serial</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p, i) => (
              <PartRow
                key={partId(p)}
                code={code}
                part={p}
                open={openPart === partId(p)}
                first={i === 0}
                last={i === parts.length - 1}
                fleet={fleet}
                records={records}
                focus={focusId === partId(p)}
                onToggle={() => setOpenPart(openPart === partId(p) ? null : partId(p))}
                onRemove={() => setConfirmRemove(partId(p))}
              />
            ))}
            {!parts.length && (
              <tr>
                <td colSpan={7} className="group-empty text-muted">
                  No parts on this subassembly yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="sub-parts-foot">
          <button
            className="btn btn-secondary"
            onClick={() => setFocusId(addPart(code).split(':')[1])}
          >
            + Add part
          </button>
          <span className="group-spacer" />
          {blanks > 0 && (
            <span className="field-error">
              {blanks} {blanks === 1 ? 'part has' : 'parts have'} no number — the workbook import
              rejects a blank part number.
            </span>
          )}
          <span className="admin-note text-muted">
            Identity is what audit records are keyed to. Renaming a part number is safe; the
            identity never changes.
          </span>
        </div>
      </div>

      {confirmRemove && (
        <RemovePartDialog
          code={code}
          id={confirmRemove}
          subName={d.name}
          fitted={fitted}
          fleet={fleet}
          records={records}
          onClose={() => setConfirmRemove(null)}
        />
      )}
    </div>
  )
}

function PartRow({
  code,
  part,
  open,
  first,
  last,
  fleet,
  records,
  focus,
  onToggle,
  onRemove,
}: {
  code: SubCode
  part: PartSpec
  open: boolean
  first: boolean
  last: boolean
  fleet: Unit[]
  records: Record<string, unknown>
  focus: boolean
  onToggle: () => void
  onRemove: () => void
}) {
  const editPart = useStore((s) => s.editPart)
  const movePart = useStore((s) => s.movePart)
  const setVariant = useStore((s) => s.setVariant)
  const id = partId(part)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focus) ref.current?.focus()
  }, [focus])

  // Same rule the unit detail panel enforces: a Vue part takes the machine's
  // revision, so its own is not the thing to edit.
  const fromMachine = part.slot === 'vue' || !!part.byRev
  const recs = recordsFor(code, id, fleet, records as never)

  return (
    <Fragment>
      <tr>
        <td className="part-caret">
          <button
            type="button"
            className="part-caret-btn"
            aria-expanded={open}
            aria-label={`More for ${part.part || 'this part'}`}
            onClick={onToggle}
          >
            <span className={open ? 'caret is-open' : 'caret'}>
              <ChevronRight />
            </span>
          </button>
        </td>
        <td data-label="Part number">
          <input
            ref={ref}
            className="input"
            value={part.part}
            placeholder="not numbered yet"
            onChange={(e) => editPart(code, id, { part: e.target.value })}
          />
        </td>
        <td
          data-label="Identity"
          className="part-id text-muted"
          title="Stable identity — audit records are keyed to this. It never changes."
        >
          {id}
        </td>
        <td data-label="Description">
          <input
            className="input"
            value={part.desc}
            onChange={(e) => editPart(code, id, { desc: e.target.value })}
          />
        </td>
        <td data-label="Rev">
          <input
            className="input"
            value={part.rev}
            disabled={fromMachine}
            title={fromMachine ? "Taken from the machine's Vue revision." : undefined}
            onChange={(e) => editPart(code, id, { rev: e.target.value })}
          />
        </td>
        <td data-label="Location">
          <input
            className="input"
            value={part.loc}
            onChange={(e) => editPart(code, id, { loc: e.target.value })}
          />
        </td>
        <td data-label="Serial">
          <select
            className="input"
            value={part.slot ?? ''}
            onChange={(e) =>
              editPart(code, id, { slot: (e.target.value || undefined) as PartSpec['slot'] })
            }
          >
            <option value="">none</option>
            {SERIAL_SLOTS.map((slot) => (
              <option key={slot} value={slot}>
                {slot}
              </option>
            ))}
          </select>
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={7} className="part-detail-cell">
            <div className="part-detail">
              <div className="field">
                <label htmlFor={`spec-${id}`}>Rated capacity / spec</label>
                <input
                  id={`spec-${id}`}
                  className="input"
                  value={part.spec ?? ''}
                  placeholder="none"
                  onChange={(e) => editPart(code, id, { spec: e.target.value || undefined })}
                />
              </div>

              <div className="part-variants">
                <div className="meta-label text-muted">Variants by Vue revision</div>
                {Object.entries(part.byRev ?? {}).map(([rev, variant]) => (
                  <div className="part-variant-row" key={rev}>
                    <input
                      className="input"
                      value={rev}
                      aria-label="Vue revision"
                      onChange={(e) => {
                        setVariant(code, id, rev, null)
                        if (e.target.value) setVariant(code, id, e.target.value.toUpperCase(), variant)
                      }}
                    />
                    <input
                      className="input"
                      value={variant}
                      aria-label="Variant fitted"
                      onChange={(e) => setVariant(code, id, rev, e.target.value)}
                    />
                    <button
                      className="btn btn-ghost btn-tiny"
                      onClick={() => setVariant(code, id, rev, null)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  className="btn btn-ghost btn-tiny"
                  onClick={() => setVariant(code, id, nextRev(part), '')}
                >
                  + Variant
                </button>
                <div className="admin-note text-muted">
                  A part with variants takes the machine's Vue revision instead of its own, so its
                  Rev above is read from the machine.
                </div>
              </div>

              <div className="part-detail-actions">
                <button
                  className="btn btn-ghost btn-tiny"
                  disabled={first}
                  onClick={() => movePart(code, id, -1)}
                >
                  Move up
                </button>
                <button
                  className="btn btn-ghost btn-tiny"
                  disabled={last}
                  onClick={() => movePart(code, id, 1)}
                >
                  Move down
                </button>
                <span className="group-spacer" />
                <span className="admin-note text-muted">
                  {recs
                    ? `${recs} audit ${recs === 1 ? 'record' : 'records'} captured`
                    : 'no audit records captured'}
                </span>
                <button className="btn btn-secondary btn-tiny" onClick={onRemove}>
                  Remove part
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}

/** The next unused single letter, so "+ Variant" never collides. */
function nextRev(part: PartSpec): string {
  const taken = new Set(Object.keys(part.byRev ?? {}))
  for (let i = 0; i < 26; i++) {
    const c = String.fromCharCode(65 + i)
    if (!taken.has(c)) return c
  }
  return 'A'
}

function RemovePartDialog({
  code,
  id,
  subName,
  fitted,
  fleet,
  records,
  onClose,
}: {
  code: SubCode
  id: string
  subName: string
  fitted: number
  fleet: Unit[]
  records: Record<string, unknown>
  onClose: () => void
}) {
  const removePart = useStore((s) => s.removePart)
  const overrides = useStore((s) => s.overrides)
  const part = partsFor(code, overrides).find((p) => partId(p) === id)
  const recs = recordsFor(code, id, fleet, records as never)

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog blueprint"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <Corners />
        <div className="dialog-title" id="rm-title">
          Remove {part?.part || 'this part'}?
        </div>
        <div className="dialog-body">
          It leaves {subName} on {fitted === 1 ? 'the 1 machine' : `all ${fitted} machines`} carrying
          it.{' '}
          {recs > 0
            ? `${recs} audit ${recs === 1 ? 'record' : 'records'} captured against ${id} stay in place but go inert — they come back if this part id ever returns.`
            : 'No audit records have been captured against it.'}
        </div>
        <div className="dialog-actions">
          <button className="btn btn-secondary" autoFocus onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              removePart(code, id)
              onClose()
            }}
          >
            Remove part
          </button>
        </div>
      </div>
    </div>
  )
}
