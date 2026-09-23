import { StudioSymbol, previewZoomMax, previewZoomMin } from '../../services/retouch-model'
import type { TaskRecord } from '../../types'
import { EditIcon } from '../icons'

interface Props {
  previewTitle: "历史结果" | "生成结果" | "修图结果" | "历史原图" | "生成中" | "输入参考" | "空白画布"
  previewZoom: number
  applyPreviewZoom: (zoom: number) => void
  canUsePreviewZoom: boolean
  compareEnabled: boolean
  canCompare: boolean
  handleCompareToggle: () => void
  handleMaskEdit: () => void
  openVisibleOutput: () => void
  visibleTask: TaskRecord | null
}

export default function RetouchToolbar({ previewTitle, previewZoom, applyPreviewZoom, canUsePreviewZoom, compareEnabled, canCompare, handleCompareToggle, handleMaskEdit, openVisibleOutput, visibleTask }: Props) {
  return (
    <div className="retouch-preview-toolbar">
      <div>
        <span>画布</span>
        <strong>{previewTitle}</strong>
      </div>
      <div className="retouch-preview-actions">
        <div className="retouch-zoom-control" role="group" aria-label="预览缩放">
          <button
            type="button"
            className={Math.abs(previewZoom - 1) < 0.01 ? 'is-active' : ''}
            aria-pressed={Math.abs(previewZoom - 1) < 0.01}
            onClick={() => applyPreviewZoom(1)}
            disabled={!canUsePreviewZoom}
          >
            适应
          </button>
          <input
            type="range"
            min={previewZoomMin}
            max={previewZoomMax}
            step={0.01}
            value={previewZoom}
            onChange={(event) => applyPreviewZoom(Number(event.target.value))}
            disabled={!canUsePreviewZoom}
            aria-label="无级缩放"
          />
          <span>{previewZoom > 1 ? `${Math.round(previewZoom * 100)}%` : '100%'}</span>
        </div>
        <button
          type="button"
          className={`retouch-tool-button ${compareEnabled && canCompare ? 'is-active' : ''}`}
          onClick={handleCompareToggle}
          aria-pressed={compareEnabled && canCompare}
          title="对比原图与结果"
        >
          <StudioSymbol name="compare" className="h-4 w-4" />
          <span>对比</span>
        </button>
        <button type="button" className="retouch-tool-button" onClick={handleMaskEdit} title="涂抹需要修改的区域">
          <EditIcon className="h-4 w-4" aria-hidden="true" />
          <span>局部</span>
        </button>
        <button type="button" className="retouch-tool-button" onClick={openVisibleOutput} disabled={!visibleTask?.outputImages.length} title="查看完整输出图">
          <StudioSymbol name="expand" className="h-4 w-4" />
          <span>放大</span>
        </button>
      </div>
    </div>
  )
}
