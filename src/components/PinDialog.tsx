import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { Corners } from './Corners'

export function PinDialog({ onClose }: { onClose: () => void }) {
  const unlock = useStore((s) => s.unlock)
  const [pin, setPin] = useState('')
  const [bad, setBad] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.focus(), [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (unlock(pin)) onClose()
    else {
      setBad(true)
      setPin('')
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <form
        className="dialog blueprint"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        aria-label="Unlock admin"
      >
        <Corners />
        <div className="dialog-title">Unlock admin</div>
        <div className="dialog-body">
          Admin unlocks editing of the master parts lists, subassembly fitment, and unit identity.
        </div>
        <div className="field">
          <label htmlFor="admin-pin">4-digit PIN</label>
          <input
            id="admin-pin"
            ref={input}
            className="input pin-input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, ''))
              setBad(false)
            }}
          />
        </div>
        {bad && <div className="pin-error">That PIN is not right.</div>}
        <p className="pin-note text-muted">
          This is a guard rail against accidental edits, not security — the app is a public static
          bundle with no server, so the PIN is readable in the page source.
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={pin.length < 4}>
            Unlock
          </button>
        </div>
      </form>
    </div>
  )
}
