import type * as React from 'react'
import { getContentEditablePlainText, getContentEditableSelection, syncMentionTagSelection } from '../../services/prompt-editor'

interface Props {
  textareaRef: React.RefObject<HTMLDivElement | null>
  isUserInputRef: React.RefObject<boolean>
  setCursorPos: React.Dispatch<React.SetStateAction<number>>
  setPrompt: (p: string) => void
  setAtImageMenuIndex: React.Dispatch<React.SetStateAction<number>>
  setAtImageMenuDismissed: React.Dispatch<React.SetStateAction<boolean>>
  handleKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
  handlePromptPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void
  handlePromptCopy: (e: React.ClipboardEvent<HTMLDivElement>) => void
  promptPlaceholder: "写下修图指令：局部清理、生成式填充、色彩匹配、批量变体；输入 @ 引用参考图..."
}

export default function PromptInput({ textareaRef, isUserInputRef, setCursorPos, setPrompt, setAtImageMenuIndex, setAtImageMenuDismissed, handleKeyDown, handlePromptPaste, handlePromptCopy, promptPlaceholder }: Props) {
  return (
    <div
      ref={textareaRef}
      contentEditable
      suppressContentEditableWarning
      onInput={(e) => {
        isUserInputRef.current = true
        const el = e.currentTarget
        const range = getContentEditableSelection(el)
        setCursorPos(range.start)
        syncMentionTagSelection(el)
        const text = getContentEditablePlainText(el)
        setPrompt(text)
        setAtImageMenuIndex(0)
        setAtImageMenuDismissed(false)
      }}
      onSelect={(e) => {
        const el = e.currentTarget
        const range = getContentEditableSelection(el)
        setCursorPos(range.start)
        syncMentionTagSelection(el)
        setAtImageMenuIndex(0)
        setAtImageMenuDismissed(false)
      }}
      onKeyDown={handleKeyDown}
      onPaste={handlePromptPaste}
      onCopy={handlePromptCopy}
      onClick={(e) => {
        const el = textareaRef.current
        if (!el) return
        const target = e.target as HTMLElement
        if (target.classList.contains('mention-tag')) {
          const sel = window.getSelection()
          if (sel) {
            const range = document.createRange()
            range.selectNode(target)
            sel.removeAllRanges()
            sel.addRange(range)
            syncMentionTagSelection(el)
          }
          return
        }

        syncMentionTagSelection(el)
      }}
      aria-label={promptPlaceholder}
      className="col-start-1 row-start-1 min-h-[42px] w-full overflow-hidden ios-rounded-scroll-fix whitespace-pre-wrap break-words rounded-xl border border-white/[0.1] bg-white/[0.045] pl-4 pr-10 py-3 text-sm leading-relaxed text-zinc-100 shadow-sm outline-none transition-[border-color,box-shadow] duration-200 focus:border-cyan-300/50 focus:ring-1 focus:ring-cyan-400/25"
    />
  )
}
