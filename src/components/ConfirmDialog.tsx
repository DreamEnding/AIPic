import { useEffect, useId, useState } from 'react'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { Checkbox } from './Checkbox'
import { CopyIcon } from './icons'

function renderMessage(message: string) {
  return message.split(/(`[^`]+`|「[^」]+」|\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className="rounded bg-[var(--apple-surface-secondary)] px-1 py-0.5 text-[0.85em] text-gray-700 dark:text-gray-200">
          {part.slice(1, -1)}
        </code>
      )
    }

    if (part.startsWith('「') && part.endsWith('」')) {
      return (
        <strong key={index} className="font-semibold text-[var(--apple-ink)]">
          {part}
        </strong>
      )
    }

    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-semibold text-[var(--apple-ink)]">
          {part.slice(2, -2)}
        </strong>
      )
    }

    return part
  })
}

export default function ConfirmDialog() {
  const dialogTitleId = useId()
  const dialogDescriptionId = useId()
  const confirmDialog = useStore((s) => s.confirmDialog)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const [canConfirm, setCanConfirm] = useState(true)
  const [checkboxChecked, setCheckboxChecked] = useState(false)

  useEffect(() => {
    const delay = confirmDialog?.minConfirmDelayMs ?? 0
    if (!confirmDialog || delay <= 0) {
      setCanConfirm(true)
      return
    }

    setCanConfirm(false)
    const timer = window.setTimeout(() => setCanConfirm(true), delay)
    return () => window.clearTimeout(timer)
  }, [confirmDialog])

  useEffect(() => {
    setCheckboxChecked(confirmDialog?.checkbox?.defaultChecked ?? false)
  }, [confirmDialog])

  const handleClose = () => {
    if (!canConfirm) return
    setConfirmDialog(null)
  }

  const handleCancel = () => {
    confirmDialog?.cancelAction?.(checkboxChecked)
    handleClose()
  }

  useCloseOnEscape(Boolean(confirmDialog) && canConfirm, handleClose)
  usePreventBackgroundScroll(Boolean(confirmDialog))

  if (!confirmDialog) return null
  const isDestructive = confirmDialog.title.includes('删除') || confirmDialog.title.includes('清空')
  const confirmTone = confirmDialog.tone ?? (isDestructive ? 'danger' : undefined)
  const confirmText = confirmDialog.confirmText ?? (isDestructive ? '确认删除' : '确认')
  const cancelText = confirmDialog.cancelText ?? '取消'
  const customButtons = confirmDialog.buttons?.filter((button) => button.label.trim()) ?? []

  return (
    <div
      data-no-drag-select
      className="fixed inset-0 z-[110] flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div className="apple-dialog-backdrop absolute inset-0 animate-overlay-in" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
        className="apple-dialog relative z-10 w-full max-w-sm p-6 animate-confirm-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={dialogTitleId} className="mb-3 flex items-center gap-3 text-[17px] font-semibold tracking-tight">
          {confirmDialog.icon === 'info' && (
            <svg className="h-5 w-5 shrink-0 text-[var(--apple-accent)]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
          )}
          {confirmDialog.icon === 'copy' && (
            <CopyIcon className="h-5 w-5 shrink-0 text-[var(--apple-accent)]" />
          )}
          {confirmDialog.title}
        </h3>
        <p id={dialogDescriptionId} className={`text-sm text-[var(--apple-secondary)] ${confirmDialog.checkbox ? 'mb-4' : 'mb-6'} leading-relaxed whitespace-pre-line ${confirmDialog.messageAlign === 'center' ? 'text-center' : ''}`}>
          {renderMessage(confirmDialog.message)}
        </p>
        {confirmDialog.checkbox && (
          <Checkbox
            checked={checkboxChecked}
            onChange={setCheckboxChecked}
            label={confirmDialog.checkbox.label}
            tone={confirmDialog.checkbox.tone}
            disabled={confirmDialog.checkbox.disabled}
            className="mb-6"
          />
        )}
        {customButtons.length > 0 ? (
          <div className="flex gap-3">
            {customButtons.map((button) => (
              <button
                key={button.label}
                onClick={() => {
                  if (!canConfirm) return
                  button.action(checkboxChecked)
                  setConfirmDialog(null)
                }}
                disabled={!canConfirm}
                data-tone={button.tone ?? 'primary'}
                className="apple-button min-w-0 flex-1"
              >
                {button.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex gap-3">
            {confirmDialog.showCancel !== false && (
              <button
                onClick={handleCancel}
                data-tone="secondary"
                className="apple-button flex-1"
              >
                {cancelText}
              </button>
            )}
            <button
              onClick={() => {
                if (!canConfirm) return
                confirmDialog.action?.(checkboxChecked)
                setConfirmDialog(null)
              }}
              disabled={!canConfirm}
              data-tone={confirmTone === 'danger' || confirmTone === 'warning' ? confirmTone : 'primary'}
              className="apple-button flex-1"
            >
              {confirmText}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
