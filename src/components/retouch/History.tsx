import type * as React from 'react'
import { formatElapsed, formatStatus, truncateMiddle } from '../../services/retouch-model'
import type { ApiProfile, TaskParams, TaskRecord } from '../../types'
import { SettingsIcon } from '../icons'
import { HistoryThumb, OutputImage } from './Canvas'

interface Props {
  historyTitle: "生成历史" | "修图历史"
  retouchTasks: TaskRecord[]
  historyTasks: TaskRecord[]
  selectedHistoryTaskId: string | null
  setCompareEnabled: React.Dispatch<React.SetStateAction<boolean>>
  setSelectedHistoryTaskId: React.Dispatch<React.SetStateAction<string | null>>
  showToast: (message: string, type?: "error" | "info" | "success") => void
  params: TaskParams
  currentWorkSummary: string
  prompt: string
  currentPromptFallback: "写清楚主体、场景、风格、构图、色彩、比例和不想出现的内容。" | "先选择一个修图预设，或者在右侧输入框直接写修图要求。"
  visibleTask: TaskRecord | null
  activeProfile: ApiProfile
}

export default function RetouchHistory({ historyTitle, retouchTasks, historyTasks, selectedHistoryTaskId, setCompareEnabled, setSelectedHistoryTaskId, showToast, params, currentWorkSummary, prompt, currentPromptFallback, visibleTask, activeProfile }: Props) {
  return (
    <aside className="retouch-output-panel">
      <div className="retouch-section-heading">
        <span>{historyTitle}</span>
        <strong>{retouchTasks.length ? `${retouchTasks.length} 条` : '暂无'}</strong>
      </div>
      <div className="retouch-history-list">
        {historyTasks.length ? (
          historyTasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className={`retouch-history-card ${selectedHistoryTaskId === task.id ? 'is-active' : ''}`}
              aria-pressed={selectedHistoryTaskId === task.id}
              onClick={() => {
                setCompareEnabled(false)
                setSelectedHistoryTaskId(task.id)
                showToast(`已切换到 ${new Date(task.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 的${task.inputImageIds.length ? '修图' : '生成'}记录`, 'success')
              }}
            >
              <HistoryThumb task={task} />
              <span>
                <strong>{formatStatus(task.status)} · {task.outputImages.length || task.params.n} 张</strong>
                <small>{truncateMiddle(task.prompt, 30)}</small>
              </span>
            </button>
          ))
        ) : (
          <div className="retouch-empty-history">每一次创作，都会保存在这里。</div>
        )}
      </div>

      <div className="retouch-section-heading">
        <span>当前指令</span>
        <strong>{params.n > 1 ? `${params.n} 张输出` : '单张输出'}</strong>
      </div>
      <div className="retouch-current-brief">
        <strong>{currentWorkSummary}</strong>
        <p>{prompt || currentPromptFallback}</p>
      </div>

      <div className="retouch-section-heading">
        <span>任务状态</span>
        <strong>{formatStatus(visibleTask?.status)}</strong>
      </div>
      <div className={`retouch-task-summary ${visibleTask?.status ? `is-${visibleTask.status}` : ''}`}>
        <span>{visibleTask ? new Date(visibleTask.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '暂无任务'}</span>
        <strong>{visibleTask?.apiModel || activeProfile.model || '未设置模型'}</strong>
        {visibleTask?.elapsed != null && <small>{formatElapsed(visibleTask.elapsed)}</small>}
        {visibleTask?.error && <p>{visibleTask.error}</p>}
      </div>

      <div className="retouch-result-strip">
        {visibleTask?.outputImages.length ? (
          visibleTask.outputImages.slice(0, 4).map((imageId, index) => (
            <OutputImage
              key={imageId}
              imageId={imageId}
              imageList={visibleTask.outputImages}
              label={`输出图 ${index + 1}`}
            />
          ))
        ) : (
          <div className="retouch-empty-result">
            <SettingsIcon className="h-4 w-4" />
            <span>你的作品将显示在这里</span>
          </div>
        )}
      </div>
    </aside>
  )
}
