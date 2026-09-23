import type * as React from 'react'
import { dismissAllTooltips } from '../../lib/tooltipDismiss'
import type { AppSettings, TaskParams } from '../../types'
import Select from '../Select'
import ButtonTooltip from './ButtonTooltip'

const selectClass = 'px-3 py-1.5 rounded-xl border border-white/[0.1] bg-white/[0.045] hover:bg-white/[0.08] text-xs text-zinc-100 transition-all duration-200 shadow-sm'

const disabledParamClass = 'px-3 py-1.5 rounded-xl border border-white/[0.08] bg-white/[0.035] text-xs text-zinc-500 opacity-50 cursor-not-allowed transition-all duration-200 shadow-sm'

const enabledParamClass = 'bg-white/[0.045] text-zinc-100 hover:bg-white/[0.08]'


interface Props {
  cols: string
  sizeHint: { visible: boolean; show: () => void; hide: () => void; clearTimer: () => void; startTouch: () => void; }
  setShowSizePicker: React.Dispatch<React.SetStateAction<boolean>>
  displaySizeLabel: string
  isFalTextToImage: boolean
  qualityHint: { visible: boolean; show: () => void; hide: () => void; clearTimer: () => void; startTouch: () => void; }
  settings: AppSettings
  isFalProvider: boolean
  params: TaskParams
  setParams: (p: Partial<TaskParams>) => void
  qualityOptions: { label: string; value: string; }[]
  compressionHint: { visible: boolean; show: () => void; hide: () => void; clearTimer: () => void; startTouch: () => void; }
  outputCompressionInput: string
  setOutputCompressionInput: React.Dispatch<React.SetStateAction<string>>
  commitOutputCompression: () => void
  compressionDisabled: boolean
  moderationHint: { visible: boolean; show: () => void; hide: () => void; clearTimer: () => void; startTouch: () => void; }
  moderationDisabled: boolean
  showAgentNHint: () => void
  hideNLimitHint: () => void
  startAgentNHintTouch: () => void
  clearAgentNHintTouchTimer: () => void
  nInput: string
  handleNInputChange: (value: string) => void
  setNInputFocused: React.Dispatch<React.SetStateAction<boolean>>
  commitN: () => void
  handleNLimitIncreaseAttempt: (preventDefault: () => void) => void
  agentAutoImageCount: boolean
  outputImageLimit: number
  nLimitHint: { visible: boolean; show: () => void; hide: () => void; clearTimer: () => void; startTouch: () => void; }
  nLimitHintText: string
  streamConcurrentByN: boolean
}

export default function OutputParameters({ cols, sizeHint, setShowSizePicker, displaySizeLabel, isFalTextToImage, qualityHint, settings, isFalProvider, params, setParams, qualityOptions, compressionHint, outputCompressionInput, setOutputCompressionInput, commitOutputCompression, compressionDisabled, moderationHint, moderationDisabled, showAgentNHint, hideNLimitHint, startAgentNHintTouch, clearAgentNHintTouchTimer, nInput, handleNInputChange, setNInputFocused, commitN, handleNLimitIncreaseAttempt, agentAutoImageCount, outputImageLimit, nLimitHint, nLimitHintText, streamConcurrentByN }: Props) {
  return (
    <div className={`grid ${cols} gap-2 text-xs flex-1`}>
      <label
        className="relative flex flex-col gap-0.5"
        onMouseEnter={sizeHint.show}
        onMouseLeave={sizeHint.hide}
        onTouchStart={sizeHint.startTouch}
        onTouchEnd={sizeHint.clearTimer}
        onTouchCancel={sizeHint.hide}
        onClick={sizeHint.show}
      >
        <span className="ml-1 text-zinc-500">尺寸</span>
        <button
          type="button"
          onClick={() => { dismissAllTooltips(); setShowSizePicker(true) }}
          className="px-3 py-1.5 rounded-xl border border-white/[0.1] bg-white/[0.045] hover:bg-white/[0.08] focus:outline-none text-xs text-left text-zinc-100 transition-all duration-200 shadow-sm font-mono"
          title="选择尺寸"
        >
          {displaySizeLabel}
        </button>
        <ButtonTooltip
          visible={isFalTextToImage && sizeHint.visible}
          text={<>fal.ai 的文生图模式不支持 <code className="rounded bg-white/10 px-1 py-0.5 font-mono">auto</code> 参数</>}
        />
      </label>
      <label
        className="relative flex flex-col gap-0.5"
        onMouseEnter={qualityHint.show}
        onMouseLeave={qualityHint.hide}
        onTouchStart={qualityHint.startTouch}
        onTouchEnd={qualityHint.clearTimer}
        onTouchCancel={qualityHint.hide}
        onClick={qualityHint.show}
      >
        <span className="ml-1 text-zinc-500">质量</span>
        <Select
          value={settings.codexCli ? 'auto' : isFalProvider && params.quality === 'auto' ? 'high' : params.quality}
          onChange={(val) => {
            if (!settings.codexCli) setParams({ quality: val as any })
          }}
          options={qualityOptions}
          disabled={settings.codexCli}
          tone="dark"
          className={settings.codexCli ? disabledParamClass : selectClass}
        />
        <ButtonTooltip
          visible={(settings.codexCli || isFalProvider) && qualityHint.visible}
          text={isFalProvider ? <>fal.ai 不支持 <code className="rounded bg-white/10 px-1 py-0.5 font-mono">auto</code> 质量参数</> : 'Codex CLI 不支持质量参数'}
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="ml-1 text-zinc-500">格式</span>
        <Select
          value={params.output_format}
          onChange={(val) => setParams({ output_format: val as any })}
          options={[
            { label: 'PNG', value: 'png' },
            { label: 'JPEG', value: 'jpeg' },
            { label: 'WebP', value: 'webp' },
          ]}
          tone="dark"
          className={selectClass}
        />
      </label>
      <label
        className="relative flex flex-col gap-0.5"
        onMouseEnter={compressionHint.show}
        onMouseLeave={compressionHint.hide}
        onTouchStart={compressionHint.startTouch}
        onTouchEnd={compressionHint.clearTimer}
        onTouchCancel={compressionHint.hide}
        onClick={compressionHint.show}
      >
        <span className="ml-1 text-zinc-500">压缩率</span>
        <input
          value={outputCompressionInput}
          onChange={(e) => setOutputCompressionInput(e.target.value)}
          onBlur={commitOutputCompression}
          disabled={compressionDisabled}
          type="number"
          min={0}
          max={100}
          placeholder="0-100"
          className={`px-3 py-1.5 rounded-xl border border-white/[0.1] focus:outline-none text-xs transition-all duration-200 shadow-sm ${
            compressionDisabled
              ? 'bg-white/[0.035] text-zinc-500 opacity-50 cursor-not-allowed'
              : enabledParamClass
            }`}
        />
        <ButtonTooltip
          visible={compressionHint.visible}
          text={isFalProvider ? 'fal.ai 不支持压缩率参数' : '仅 JPEG 和 WebP 支持压缩率'}
        />
      </label>
      <label
        className="relative flex flex-col gap-0.5"
        onMouseEnter={moderationHint.show}
        onMouseLeave={moderationHint.hide}
        onTouchStart={moderationHint.startTouch}
        onTouchEnd={moderationHint.clearTimer}
        onTouchCancel={moderationHint.hide}
        onClick={moderationHint.show}
      >
        <span className="ml-1 text-zinc-500">审核</span>
        <Select
          value={moderationDisabled ? 'auto' : params.moderation}
          onChange={(val) => {
            if (!moderationDisabled) setParams({ moderation: val as any })
          }}
          options={[
            { label: '自动', value: 'auto' },
            { label: '低', value: 'low' },
          ]}
          disabled={moderationDisabled}
          tone="dark"
          className={moderationDisabled ? disabledParamClass : selectClass}
        />
        <ButtonTooltip
          visible={moderationDisabled && moderationHint.visible}
          text="fal.ai 不支持审核参数"
        />
      </label>
      <label
        className="relative flex flex-col gap-0.5"
        onMouseEnter={showAgentNHint}
        onMouseLeave={hideNLimitHint}
        onTouchStart={startAgentNHintTouch}
        onTouchEnd={clearAgentNHintTouchTimer}
        onTouchCancel={() => {
          clearAgentNHintTouchTimer()
          hideNLimitHint()
        }}
        onClick={showAgentNHint}
      >
        <span className="ml-1 text-zinc-500">数量</span>
        <input
          value={nInput}
          onChange={(e) => handleNInputChange(e.target.value)}
          onFocus={() => setNInputFocused(true)}
          onBlur={() => {
            setNInputFocused(false)
            commitN()
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              handleNLimitIncreaseAttempt(() => e.preventDefault())
            }
          }}
          onWheel={(e) => {
            if (e.deltaY < 0) {
              handleNLimitIncreaseAttempt(() => e.preventDefault())
            }
          }}
          disabled={agentAutoImageCount}
          type={agentAutoImageCount ? 'text' : 'number'}
          min={agentAutoImageCount ? undefined : 1}
          max={agentAutoImageCount ? undefined : outputImageLimit}
          className={`px-3 py-1.5 rounded-xl border border-white/[0.1] focus:outline-none text-xs transition-all duration-200 shadow-sm ${
            agentAutoImageCount
              ? 'bg-white/[0.035] text-zinc-500 opacity-50 cursor-not-allowed'
              : enabledParamClass
          }`}
        />
        <ButtonTooltip visible={nLimitHint.visible} text={nLimitHintText} />
        <ButtonTooltip visible={streamConcurrentByN && !nLimitHint.visible} text="数量大于 1 时会将多图生成拆分为并发单图" />
      </label>
    </div>
  )
}
