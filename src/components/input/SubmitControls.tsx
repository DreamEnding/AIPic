import { useState } from 'react'
import ButtonTooltip from './ButtonTooltip'

interface Props {
  compact?: boolean
  isRunning: boolean
  configured: boolean
  disabled: boolean
  label: string
  text: string
  tooltip: string
  onClick: () => void
}

export default function SubmitControls({ compact, isRunning, configured, disabled, label, text, tooltip, onClick }: Props) {
  const [hover, setHover] = useState(false)
  const iconClass = compact ? 'w-5 h-5' : 'w-4 h-4'
  const layout = compact
    ? 'p-2.5 rounded-xl transition-all shadow-sm hover:shadow'
    : 'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all shadow-sm'
  const tone = isRunning
    ? 'bg-red-500 text-white hover:bg-red-600'
    : !configured
      ? 'bg-gray-300 dark:bg-white/[0.06] text-white cursor-pointer'
      : 'bg-cyan-500 text-zinc-950 hover:bg-cyan-300 disabled:bg-gray-300 dark:disabled:bg-white/[0.04] disabled:opacity-50 disabled:cursor-not-allowed'
  return (
    <div className={compact ? 'relative' : 'relative flex-1'} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <ButtonTooltip visible={(isRunning || !configured) && hover} text={tooltip} />
      <button onClick={onClick} disabled={disabled} aria-label={label} className={`${layout} ${tone}`}>
        {isRunning ? (
          <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24">
            <rect x="7" y="7" width="10" height="10" rx="1.5" />
          </svg>
        ) : (
          <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        )}
        {!compact && text}
      </button>
    </div>
  )
}
