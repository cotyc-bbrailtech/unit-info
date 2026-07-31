import { useState } from 'react'
import { timeAgo } from '../lib/format'
import { useStore } from '../store/useStore'
import { PinDialog } from './PinDialog'

export function TopBar() {
  const view = useStore((s) => s.view)
  const pending = useStore((s) => s.pending)
  const lastSyncAt = useStore((s) => s.lastSyncAt)
  const admin = useStore((s) => s.admin)
  const setView = useStore((s) => s.setView)
  const lock = useStore((s) => s.lock)
  const [asking, setAsking] = useState(false)

  const label = pending.length
    ? `${pending.length} queued · last sync ${timeAgo(lastSyncAt)}`
    : 'all records synced'

  return (
    <>
      <div className="nav topbar">
        <div className="nav-brand">UNIT INFO</div>
        <div className="sync text-muted">
          <span className="sync-dot" />
          <span>{label}</span>
        </div>
        {admin ? (
          <button className="btn btn-secondary admin-chip" onClick={lock}>
            <span className="admin-dot" />
            Admin · lock
          </button>
        ) : (
          <button className="btn btn-ghost" onClick={() => setAsking(true)}>
            Admin
          </button>
        )}
        <div className="seg">
          <label className="seg-opt">
            <input
              type="radio"
              name="view"
              checked={view !== 'phone'}
              onChange={() => setView('machine')}
            />
            Review
          </label>
          <label className="seg-opt">
            <input
              type="radio"
              name="view"
              checked={view === 'phone'}
              onChange={() => setView('phone')}
            />
            Audit
          </label>
        </div>
      </div>
      {asking && <PinDialog onClose={() => setAsking(false)} />}
    </>
  )
}
