/** Lucide, stroke-width 1.5, inline on currentColor. */
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

export function ArrowLeft({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  )
}

export function ChevronRight({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

export function Check({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

export function Camera({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  )
}
