import { useEffect, useState, type CSSProperties } from 'react'
import type { RetouchGenerationMode } from '../../services/retouch-model'
import { ensureImageCached, useStore } from '../../store'
import { PhotoIcon } from '../icons'

export function useCachedImageSource(imageId?: string | null, fallbackSrc?: string | null) {
  const normalizedImageId = imageId ?? null
  const fallback = fallbackSrc ?? null
  const [loadedImage, setLoadedImage] = useState<{ imageId: string; src: string | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!normalizedImageId) {
      setLoadedImage(null)
      return () => {
        cancelled = true
      }
    }

    setLoadedImage((current) => current?.imageId === normalizedImageId ? current : null)
    ensureImageCached(normalizedImageId).then((url) => {
      if (!cancelled) setLoadedImage({ imageId: normalizedImageId, src: url ?? null })
    })
    return () => {
      cancelled = true
    }
  }, [normalizedImageId])

  if (!normalizedImageId) return fallback
  if (loadedImage?.imageId !== normalizedImageId) return fallback
  return loadedImage.src ?? fallback
}

export function OutputImage({
  imageId,
  imageList,
  label,
}: {
  imageId: string
  imageList: string[]
  label: string
}) {
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const src = useCachedImageSource(imageId)

  return (
    <button
      type="button"
      className="retouch-result-thumb"
      onClick={() => setLightboxImageId(imageId, imageList)}
      aria-label={`查看${label}`}
    >
      {src ? <img src={src} alt={label} /> : <span>读取中</span>}
    </button>
  )
}

export function HistoryThumb({ task }: { task: { outputImages: string[]; inputImageIds: string[] } }) {
  const thumbId = task.outputImages[0] ?? task.inputImageIds[0] ?? null
  const src = useCachedImageSource(thumbId)

  return (
    <span className="retouch-history-thumb">
      {src ? <img src={src} alt="" /> : <PhotoIcon className="h-4 w-4" />}
    </span>
  )
}

export function RetouchPreviewEmpty({
  hasHistorySelection,
  generationMode,
  onUpload,
}: {
  hasHistorySelection: boolean
  generationMode: RetouchGenerationMode
  onUpload: () => void
}) {
  const title = hasHistorySelection
    ? '历史记录缺少可预览图片'
    : generationMode === 'text'
      ? '让灵感成为画面'
      : '从一张照片开始'
  const description = hasHistorySelection
    ? '请选择另一条历史，或重新上传参考图。'
    : generationMode === 'text'
      ? '在右侧写下画面描述，创建你的第一张作品。'
      : '拖入照片，或选择文件。为它挑选一种新的表达。'

  return (
    <button type="button" className="retouch-preview-empty" onClick={onUpload}>
      <span className="retouch-empty-icon"><PhotoIcon className="h-7 w-7" aria-hidden="true" /></span>
      <strong>{title}</strong>
      <span>{description}</span>
      <span className="retouch-preview-upload-cta">
        {generationMode === 'text' ? '上传参考图并修图' : '上传参考图'}
      </span>
    </button>
  )
}

export function RetouchPreviewImage({
  src,
  alt,
  fitStyle,
  imageStyle,
  onImageMeasure,
}: {
  src: string
  alt: string
  fitStyle?: CSSProperties
  imageStyle?: CSSProperties
  onImageMeasure: (aspectRatio: number) => void
}) {
  const [orientation, setOrientation] = useState<'wide' | 'tall' | 'square'>('square')

  return (
    <div className={`retouch-image-plane is-${orientation}`}>
      <div className="retouch-image-fit-box" style={fitStyle}>
        <img
          className="retouch-preview-image"
          src={src}
          alt={alt}
          style={imageStyle}
          onLoad={(event) => {
            const image = event.currentTarget
            const ratio = image.naturalWidth / Math.max(image.naturalHeight, 1)
            setOrientation(ratio > 1.08 ? 'wide' : ratio < 0.92 ? 'tall' : 'square')
            onImageMeasure(ratio)
          }}
        />
      </div>
    </div>
  )
}
