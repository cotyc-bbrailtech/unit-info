import type { Status } from './types'

interface Badge {
  cls: string
  label: string
  dot: string
}

const BADGES: Record<Status, Badge> = {
  verified: { cls: 'tag tag-accent', label: 'Verified', dot: 'var(--color-accent)' },
  dup: { cls: 'tag tag-outline', label: 'Duplicate serial', dot: 'var(--color-accent-800)' },
  flagged: { cls: 'tag tag-outline', label: 'Flagged', dot: 'var(--color-accent-800)' },
  absent: { cls: 'tag tag-neutral', label: 'Not present', dot: 'var(--color-neutral-400)' },
  open: { cls: 'tag tag-neutral', label: 'Unverified', dot: 'var(--color-neutral-300)' },
}

export const badge = (status: Status): Badge => BADGES[status] ?? BADGES.open
