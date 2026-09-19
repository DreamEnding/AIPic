import { useRef, useState } from 'react'
import { addImageFromFile, submitTask, useStore } from '../store'
import { getActiveApiProfile, validateApiProfile } from '../lib/apiProfiles'
import type { TaskParams } from '../types'
import { CloseIcon, PhotoIcon } from './icons'

const qualityOptions: Array<{ label: string; value: TaskParams['quality']; hint: string }> = [
  { label: '快速', value: 'low', hint: '测试构图' },
  { label: '标准', value: 'medium', hint: '客户审片' },
  { label: '精修', value: 'high', hint: '最终交付' },
]

const formatOptions: Array<{ label: string; value: TaskParams['output_format'] }> = [
  { label: 'PNG', value: 'png' },
  { label: 'WebP', value: 'webp' },
  { label: 'JPEG', value: 'jpeg' },
]

async function loadFiles(files: FileList | File[]) {
  const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'))
  for (const file of imageFiles) {
    await addImageFromFile(file)
  }
  return imageFiles.length
}

export default function RetouchSubmitBar() {
  const prompt = useStore((s) => s.prompt)
  const params = useStore((s) => s.params)
  const settings = useStore((s) => s.settings)
  const inputImages = useStore((s) => s.inputImages)
  const showSettings = useStore((s) => s.showSettings)
  const setPrompt = useStore((s) => s.setPrompt)
  const setParams = useStore((s) => s.setParams)
  const removeInputImage = useStore((s) => s.removeInputImage)
  const clearInputImages = useStore((s) => s.clearInputImages)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const showToast = useStore((s) => s.showToast)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const activeProfile = getActiveApiProfile(settings)
  const apiIssue = validateApiProfile(activeProfile)

  const handleFiles = async (files: FileList | File[]) => {
    try {
      const count = await loadFiles(files)
      if (count > 0) showToast(`已添加 ${count} 张参考图`, 'success')
    } catch (error) {
      showToast(`上传失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  const handleSubmit = () => {
    if (apiIssue) {
      showToast(`请先配置 API：${apiIssue}`, 'error')
      setShowSettings(true, 'api')
      return
    }
    void submitTask()
  }

  return (
    <section
      data-no-drag-select
      data-retouch-submit
      aria-label="修图创作设置"
      className={`retouch-submit-dock safe-area-x ${showSettings ? 'hidden pointer-events-none' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setIsDragging(false)
        void handleFiles(event.dataTransfer.files)
      }}
    >
      <div className={`retouch-submit-shell ${isDragging ? 'is-dragging' : ''}`}>
        <div className="retouch-submit-images">
          <button type="button" className="retouch-upload-button" onClick={() => fileInputRef.current?.click()}>
            <PhotoIcon className="h-4 w-4" />
            <span>{inputImages.length ? `${inputImages.length} 张参考图` : '上传参考图'}</span>
          </button>
          {inputImages.length > 0 && (
            <div className="retouch-thumb-row">
              {inputImages.slice(0, 5).map((image, index) => (
                <div key={image.id} className="retouch-input-thumb">
                  <img src={image.dataUrl} alt={`参考图 ${index + 1}`} />
                  <button type="button" aria-label={`移除参考图 ${index + 1}`} onClick={() => removeInputImage(index)}>
                    <CloseIcon className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {inputImages.length > 5 && <span className="retouch-thumb-more">+{inputImages.length - 5}</span>}
              <button type="button" className="retouch-clear-images" onClick={clearInputImages}>清空</button>
            </div>
          )}
        </div>

        <div className="retouch-submit-main">
          <label className="retouch-prompt-field">
            <span>修图要求</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="直接描述要修哪里、强度、必须保留什么。例：保留人物身份和镜框结构，去掉皮肤瑕疵，肤色更干净自然。"
              spellCheck={false}
              rows={3}
            />
          </label>

          <div className="retouch-submit-controls">
            <div className="retouch-segment-group" role="group" aria-label="输出数量">
              <span>数量</span>
              {[1, 4].map((count) => (
                <button
                  key={count}
                  type="button"
                  className={params.n === count ? 'is-active' : ''}
                  aria-pressed={params.n === count}
                  onClick={() => setParams({ n: count })}
                >
                  {count === 1 ? '1 张' : '4 版'}
                </button>
              ))}
            </div>

            <div className="retouch-segment-group" role="group" aria-label="修图质量">
              <span>质量</span>
              {qualityOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  title={option.hint}
                  className={params.quality === option.value ? 'is-active' : ''}
                  aria-pressed={params.quality === option.value}
                  onClick={() => setParams({ quality: option.value })}
                >
                  <strong>{option.label}</strong>
                  <small>{option.hint}</small>
                </button>
              ))}
            </div>

            <div className="retouch-segment-group" role="group" aria-label="交付格式">
              <span>格式</span>
              {formatOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={params.output_format === option.value ? 'is-active' : ''}
                  aria-pressed={params.output_format === option.value}
                  onClick={() => setParams({ output_format: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <button type="button" className="retouch-submit-button" onClick={handleSubmit}>
              {apiIssue ? '连接 API' : '开始修图'}
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = event.target.files
            if (files) void handleFiles(files)
            event.target.value = ''
          }}
        />
      </div>
    </section>
  )
}
