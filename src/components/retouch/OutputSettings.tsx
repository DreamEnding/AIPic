import type * as React from 'react'
import type { SizeTier } from '../../lib/size'
import { StudioSymbol, formatOptions, qualityOptions } from '../../services/retouch-model'
import type { ApiProfile, TaskParams } from '../../types'
import { SettingsIcon } from '../icons'

interface Props {
  params: TaskParams
  setParams: (p: Partial<TaskParams>) => void
  outputSizeOptions: ({ id: SizeTier; label: SizeTier; hint: string; value: string; } | { id: "auto"; label: string; hint: string; value: string; })[]
  activeOutputSizeId: "auto" | "custom" | SizeTier
  setSelectedOutputRatio: React.Dispatch<React.SetStateAction<{ size: string; ratio: string; } | null>>
  outputSizeRatio: string
  showToast: (message: string, type?: "error" | "info" | "success") => void
  showSizePicker: boolean
  setShowSizePicker: React.Dispatch<React.SetStateAction<boolean>>
  activeProfile: ApiProfile
  qualityLocked: boolean
  effectiveQuality: "auto" | "low" | "medium" | "high"
  handleSubmit: () => Promise<void>
  submitLabel: "连接 API" | "生成图像" | "开始局部修图" | "开始修图"
}

export default function RetouchOutputSettings({ params, setParams, outputSizeOptions, activeOutputSizeId, setSelectedOutputRatio, outputSizeRatio, showToast, showSizePicker, setShowSizePicker, activeProfile, qualityLocked, effectiveQuality, handleSubmit, submitLabel }: Props) {
  return (
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

      <div className="retouch-segment-group" role="group" aria-label="输出尺寸">
        <span>尺寸</span>
        {outputSizeOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            title={option.value === 'auto' ? '由模型自动判断输出尺寸' : `${option.label} · ${option.value}`}
            className={activeOutputSizeId === option.id ? 'is-active' : ''}
            aria-pressed={activeOutputSizeId === option.id}
            onClick={() => {
              setSelectedOutputRatio(option.id === 'auto' ? null : { size: option.value, ratio: outputSizeRatio })
              setParams({ size: option.value })
              showToast(
                option.id === 'auto'
                  ? '输出尺寸已设为自动'
                  : `输出尺寸已设为 ${option.label}（${option.value}）`,
                'success',
              )
            }}
          >
            <strong>{option.label}</strong>
            <small>{option.hint}</small>
          </button>
        ))}
      </div>

      <button
        type="button"
        className="retouch-size-picker"
        aria-haspopup="dialog"
        aria-expanded={showSizePicker}
        title="选择图像比例或自定义宽高"
        onClick={() => setShowSizePicker(true)}
      >
        <SettingsIcon className="h-4 w-4" aria-hidden="true" />
        <span>设置尺寸</span>
        <strong>{params.size === 'auto' ? '自动' : params.size.replace('x', ' × ')}</strong>
        <StudioSymbol name="arrow" className="h-4 w-4" />
      </button>

      <div className="retouch-segment-group" role="group" aria-label="修图质量">
        <span>质量</span>
        {qualityOptions.filter((option) => activeProfile.provider !== 'fal' || option.value !== 'auto').map((option) => (
          <button
            key={option.value}
            type="button"
            title={qualityLocked ? 'Codex 兼容模式使用自动质量' : option.hint}
            disabled={qualityLocked}
            className={effectiveQuality === option.value ? 'is-active' : ''}
            aria-pressed={effectiveQuality === option.value}
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
            onClick={() => setParams({
              output_format: option.value,
              ...(option.value === 'jpeg' && params.background === 'transparent' ? { background: 'opaque' as const } : {}),
            })}
          >
            {option.label}
          </button>
        ))}
      </div>

      <button type="button" className="retouch-submit-button" onClick={handleSubmit}>
        <StudioSymbol name="sparkles" className="h-4 w-4" />
        <span>{submitLabel}</span>
        <StudioSymbol name="arrow" className="h-4 w-4" />
      </button>
    </div>
  )
}
