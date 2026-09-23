import type * as React from 'react'
import type { CSSProperties, PointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import type { RetouchGenerationMode } from '../../services/retouch-model'
import type { TaskRecord } from '../../types'
import { PhotoIcon } from '../icons'
import { RetouchPreviewEmpty, RetouchPreviewImage } from './Canvas'
import RetouchToolbar from './Toolbar'

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
  isDraggingUpload: boolean
  setIsDraggingUpload: React.Dispatch<React.SetStateAction<boolean>>
  handleFiles: (files: FileList | File[]) => Promise<void>
  previewStageRef: React.RefObject<HTMLDivElement | null>
  outputImageSrc: string | null
  beforeImageSrc: string | null
  previewImageFitStyle: CSSProperties | undefined
  handlePreviewImageMeasure: (aspectRatio: number) => void
  comparePosition: number
  setComparePosition: React.Dispatch<React.SetStateAction<number>>
  handleComparePointerDown: (event: PointerEvent<HTMLButtonElement>) => void
  handleComparePointerMove: (event: PointerEvent<HTMLButtonElement>) => void
  handleComparePointerEnd: (event: PointerEvent<HTMLButtonElement>) => void
  handlePreviewWheel: (event: ReactWheelEvent<HTMLDivElement>) => void
  handlePreviewPanPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  handlePreviewPanPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  handlePreviewPanPointerEnd: (event: PointerEvent<HTMLDivElement>) => void
  previewImageTransformStyle: CSSProperties | undefined
  previewEmptyHasHistorySelection: boolean
  generationMode: RetouchGenerationMode
  fileInputRef: React.RefObject<HTMLInputElement | null>
  currentStatusTask: TaskRecord | null
  hasPreviewImage: boolean
}

export default function RetouchCanvas({ previewTitle, previewZoom, applyPreviewZoom, canUsePreviewZoom, compareEnabled, canCompare, handleCompareToggle, handleMaskEdit, openVisibleOutput, visibleTask, isDraggingUpload, setIsDraggingUpload, handleFiles, previewStageRef, outputImageSrc, beforeImageSrc, previewImageFitStyle, handlePreviewImageMeasure, comparePosition, setComparePosition, handleComparePointerDown, handleComparePointerMove, handleComparePointerEnd, handlePreviewWheel, handlePreviewPanPointerDown, handlePreviewPanPointerMove, handlePreviewPanPointerEnd, previewImageTransformStyle, previewEmptyHasHistorySelection, generationMode, fileInputRef, currentStatusTask, hasPreviewImage }: Props) {
  return (
    <main className="retouch-preview-panel">
      <RetouchToolbar
        previewTitle={previewTitle}
        previewZoom={previewZoom}
        applyPreviewZoom={applyPreviewZoom}
        canUsePreviewZoom={canUsePreviewZoom}
        compareEnabled={compareEnabled}
        canCompare={canCompare}
        handleCompareToggle={handleCompareToggle}
        handleMaskEdit={handleMaskEdit}
        openVisibleOutput={openVisibleOutput}
        visibleTask={visibleTask}
      />

      <div
        className={`retouch-preview-frame ${isDraggingUpload ? 'is-dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setIsDraggingUpload(true)
        }}
        onDragLeave={() => setIsDraggingUpload(false)}
        onDrop={(event) => {
          event.preventDefault()
          setIsDraggingUpload(false)
          void handleFiles(event.dataTransfer.files)
        }}
      >
        <div ref={previewStageRef} className={`retouch-preview-stage ${compareEnabled && canCompare ? 'is-comparing' : ''}`}>
          {compareEnabled && canCompare && outputImageSrc && beforeImageSrc ? (
            <div className="retouch-compare-plane">
              <div className="retouch-image-plane">
                <div className="retouch-image-fit-box" style={previewImageFitStyle}>
                  <img
                    className="retouch-preview-image"
                    src={outputImageSrc}
                    alt="修图后"
                    style={undefined}
                    onLoad={(event) => {
                      const image = event.currentTarget
                      handlePreviewImageMeasure(image.naturalWidth / Math.max(image.naturalHeight, 1))
                    }}
                  />
                </div>
              </div>
              <div className="retouch-compare-before" style={{ clipPath: `inset(0 ${100 - comparePosition}% 0 0)` }}>
                <div className="retouch-image-plane">
                  <div className="retouch-image-fit-box" style={previewImageFitStyle}>
                    <img
                      className="retouch-preview-image"
                      src={beforeImageSrc}
                      alt="修图前"
                      style={undefined}
                      onLoad={(event) => {
                        const image = event.currentTarget
                        handlePreviewImageMeasure(image.naturalWidth / Math.max(image.naturalHeight, 1))
                      }}
                    />
                  </div>
                </div>
              </div>
              <span className="retouch-compare-label is-before">原图</span>
              <span className="retouch-compare-label is-after">修图后</span>
              <button
                type="button"
                className="retouch-compare-handle"
                style={{ left: `${comparePosition}%` }}
                role="slider"
                aria-label="原图与结果对比位置"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(comparePosition)}
                aria-valuetext={`原图显示 ${Math.round(comparePosition)}%`}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    event.preventDefault()
                    setComparePosition((position) => Math.min(100, Math.max(0, position + (event.key === 'ArrowRight' ? 5 : -5))))
                  } else if (event.key === 'Home' || event.key === 'End') {
                    event.preventDefault()
                    setComparePosition(event.key === 'Home' ? 0 : 100)
                  }
                }}
                onPointerDown={handleComparePointerDown}
                onPointerMove={handleComparePointerMove}
                onPointerUp={handleComparePointerEnd}
                onPointerCancel={handleComparePointerEnd}
              >
                <span />
              </button>
            </div>
          ) : outputImageSrc ? (
            <div
              className="retouch-preview-pan-layer"
              style={{ touchAction: previewZoom > 1 ? 'none' : 'pan-y pinch-zoom' }}
              onWheel={handlePreviewWheel}
              onPointerDown={handlePreviewPanPointerDown}
              onPointerMove={handlePreviewPanPointerMove}
              onPointerUp={handlePreviewPanPointerEnd}
              onPointerCancel={handlePreviewPanPointerEnd}
            >
              <RetouchPreviewImage
                src={outputImageSrc}
                alt="修图结果"
                fitStyle={previewImageFitStyle}
                imageStyle={previewImageTransformStyle}
                onImageMeasure={handlePreviewImageMeasure}
              />
            </div>
          ) : beforeImageSrc ? (
            <div
              className="retouch-preview-pan-layer"
              style={{ touchAction: previewZoom > 1 ? 'none' : 'pan-y pinch-zoom' }}
              onWheel={handlePreviewWheel}
              onPointerDown={handlePreviewPanPointerDown}
              onPointerMove={handlePreviewPanPointerMove}
              onPointerUp={handlePreviewPanPointerEnd}
              onPointerCancel={handlePreviewPanPointerEnd}
            >
              <RetouchPreviewImage
                src={beforeImageSrc}
                alt="修图预览"
                fitStyle={previewImageFitStyle}
                imageStyle={previewImageTransformStyle}
                onImageMeasure={handlePreviewImageMeasure}
              />
            </div>
          ) : (
            <RetouchPreviewEmpty
              hasHistorySelection={previewEmptyHasHistorySelection}
              generationMode={generationMode}
              onUpload={() => fileInputRef.current?.click()}
            />
          )}
        </div>
        {currentStatusTask?.status === 'running' && <div className="retouch-running-badge" role="status"><span className="retouch-progress-dot" aria-hidden="true" />正在生成</div>}
        {visibleTask?.status === 'error' && <div className="retouch-error-badge" role="status">生成失败</div>}
        {hasPreviewImage && <div className="retouch-fit-badge">{previewZoom > 1 ? `${Math.round(previewZoom * 100)}%` : '完整显示'}</div>}
        {hasPreviewImage && (
          <button
            type="button"
            className="retouch-preview-upload-float"
            onClick={() => fileInputRef.current?.click()}
          >
            <PhotoIcon className="h-4 w-4" aria-hidden="true" />
            添加照片
          </button>
        )}
      </div>
    </main>
  )
}
