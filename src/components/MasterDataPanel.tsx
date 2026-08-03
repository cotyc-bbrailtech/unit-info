import { useRef, useState } from 'react'
import { serialOf } from '../lib/records'
import type { ImportPlan } from '../lib/master/import'
import type { Unit } from '../lib/types'
import { useStore } from '../store/useStore'
import { Corners } from './Corners'

type Stage =
  | { at: 'idle' }
  | { at: 'busy'; what: string }
  | { at: 'failed'; message: string }
  | { at: 'checked'; plan: ImportPlan; filename: string }
  | { at: 'done'; message: string }

const APP_VERSION = '0.1.0'

export function MasterDataPanel({ fleet }: { fleet: Unit[] }) {
  const overrides = useStore((s) => s.overrides)
  const records = useStore((s) => s.records)
  const applyMasterData = useStore((s) => s.applyMasterData)
  const [stage, setStage] = useState<Stage>({ at: 'idle' })
  const fileInput = useRef<HTMLInputElement>(null)

  const download = async () => {
    setStage({ at: 'busy', what: 'Building the workbook' })
    try {
      const m = await import('../lib/master/lazy')
      const exportedAt = new Date().toISOString()
      const blob = m.buildWorkbook({
        fleet,
        overrides,
        records,
        serialFor: (unit, lineKey) => {
          const line = unit.lines.find((l) => l.key === lineKey)
          return line ? serialOf(unit, line, records) : ''
        },
        exportedAt,
        appVersion: APP_VERSION,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = m.exportFilename(exportedAt)
      a.click()
      URL.revokeObjectURL(url)
      setStage({ at: 'done', message: `Exported ${m.exportFilename(exportedAt)}` })
    } catch (e) {
      setStage({ at: 'failed', message: `Export failed: ${(e as Error).message}` })
    }
  }

  const check = async (file: File) => {
    setStage({ at: 'busy', what: `Checking ${file.name}` })
    try {
      const m = await import('../lib/master/lazy')
      if (!m.canRead()) {
        setStage({
          at: 'failed',
          message: 'Importing needs a newer browser (Chrome 103+, Firefox 113+, Safari 16.4+). Export still works here.',
        })
        return
      }
      const plan = await m.readAndValidate(file, { fleet, overrides, records })
      setStage({ at: 'checked', plan, filename: file.name })
    } catch (e) {
      setStage({ at: 'failed', message: (e as Error).message })
    }
  }

  const apply = (plan: ImportPlan) => {
    applyMasterData(plan.overrides)
    setStage({
      at: 'done',
      message: `Master data replaced — ${plan.summary.parts} parts across the fleet.`,
    })
    if (fileInput.current) fileInput.current.value = ''
  }

  const reset = () => {
    setStage({ at: 'idle' })
    if (fileInput.current) fileInput.current.value = ''
  }

  return (
    <div className="admin-block blueprint master-panel">
      <Corners />
      <div className="admin-block-title">Master data workbook</div>
      <div className="admin-note text-muted">
        Excel export of the parts lists, machine identity, and fitment. Import replaces all of it —
        export first if you want a way back.
      </div>

      <div className="master-actions">
        <button className="btn btn-secondary" onClick={download} disabled={stage.at === 'busy'}>
          Export .xlsx
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => fileInput.current?.click()}
          disabled={stage.at === 'busy'}
        >
          Import .xlsx
        </button>
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void check(f)
          }}
        />
      </div>

      {stage.at === 'busy' && <div className="admin-note text-muted">{stage.what}…</div>}

      {stage.at === 'done' && (
        <div className="master-note master-ok">
          {stage.message}
          <button className="btn btn-ghost btn-tiny" onClick={reset}>
            Dismiss
          </button>
        </div>
      )}

      {stage.at === 'failed' && (
        <div className="master-note master-bad">
          {stage.message}
          <button className="btn btn-ghost btn-tiny" onClick={reset}>
            Dismiss
          </button>
        </div>
      )}

      {stage.at === 'checked' && (
        <div className="master-report">
          <div className="master-filename">{stage.filename}</div>

          {stage.plan.errors.length > 0 && (
            <>
              <div className="master-note master-bad">
                Rejected — {stage.plan.errors.length} problem
                {stage.plan.errors.length > 1 ? 's' : ''}. Nothing has been changed.
              </div>
              <ul className="master-issues">
                {stage.plan.errors.slice(0, 12).map((issue) => (
                  <li key={issue.code + (issue.where ?? '')}>{issue.message}</li>
                ))}
                {stage.plan.errors.length > 12 && <li>…and {stage.plan.errors.length - 12} more.</li>}
              </ul>
            </>
          )}

          {stage.plan.warnings.length > 0 && (
            <ul className="master-issues master-warn">
              {stage.plan.warnings.map((issue) => (
                <li key={issue.code + (issue.where ?? '')}>{issue.message}</li>
              ))}
            </ul>
          )}

          {stage.plan.ok && <div className="master-confirm">{stage.plan.confirm}</div>}

          <div className="master-actions">
            {stage.plan.ok && (
              <button className="btn btn-primary" onClick={() => apply(stage.plan)}>
                Replace master data
              </button>
            )}
            <button className="btn btn-secondary" onClick={reset}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
