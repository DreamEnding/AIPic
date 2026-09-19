import { useRef, useState } from 'react'
import { useStore } from '../store'
import HistoryModal from './HistoryModal'
import { EditIcon, HistoryIcon, PhotoIcon, SettingsIcon } from './icons'

/** 助手模式的紧凑工具组；修图工作台使用自己的设置入口。 */
export default function Header() {
  const setAppMode = useStore((s) => s.setAppMode)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const createConversation = useStore((s) => s.createAgentConversation)
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const historyButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <nav data-no-drag-select className="aipic-agent-toolbar" aria-label="助手工具">
        <button type="button" className="aipic-toolbar-button" onClick={() => setAppMode('gallery')} title="返回修图工作台" aria-label="返回修图工作台">
          <PhotoIcon className="h-5 w-5" aria-hidden="true" />
          <span className="aipic-agent-toolbar-title">工作台</span>
        </button>
        <div className="relative">
          <button
            ref={historyButtonRef}
            type="button"
            className="aipic-toolbar-button"
            onClick={() => setShowHistoryModal((visible) => !visible)}
            aria-label="对话历史"
            aria-expanded={showHistoryModal}
            title="对话历史"
          >
            <HistoryIcon className="h-5 w-5" aria-hidden="true" />
          </button>
          {showHistoryModal && <HistoryModal onClose={() => setShowHistoryModal(false)} ignoreOutsideClickRef={historyButtonRef} />}
        </div>
        <button type="button" className="aipic-toolbar-button" onClick={() => createConversation()} aria-label="新建对话" title="新建对话">
          <EditIcon className="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" className="aipic-toolbar-button" onClick={() => setShowSettings(true, 'api')} aria-label="打开设置" title="设置">
          <SettingsIcon className="h-5 w-5" aria-hidden="true" />
        </button>
      </nav>
      <div className="aipic-agent-toolbar-spacer" aria-hidden="true" />
    </>
  )
}
