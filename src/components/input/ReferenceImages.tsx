import type * as React from 'react'
import { createPortal } from 'react-dom'
import type { InputImage } from '../../types'

interface Props {
  imagesRef: React.RefObject<HTMLDivElement | null>
  inputImages: InputImage[]
  renderImageThumb: (img: InputImage, idx: number) => React.JSX.Element
  renderClearAllButton: () => React.JSX.Element
  touchDragPreview: { src: string; x: number; y: number; } | null
}

export default function ReferenceImages({ imagesRef, inputImages, renderImageThumb, renderClearAllButton, touchDragPreview }: Props) {
  return (
    <div ref={imagesRef}>
      <div className="grid grid-cols-[repeat(auto-fill,52px)] justify-between gap-x-2 gap-y-3 mb-3">
        {inputImages.map((img, idx) => renderImageThumb(img, idx))}
        {renderClearAllButton()}
      </div>
      {touchDragPreview?.src && createPortal(
        <div
          className="fixed z-[140] h-[52px] w-[52px] overflow-hidden rounded-xl shadow-xl pointer-events-none opacity-90"
          style={{ left: touchDragPreview.x, top: touchDragPreview.y, transform: 'translate(-50%, -50%)' }}
        >
          <img src={touchDragPreview.src} className="h-full w-full object-cover" alt="" />
        </div>,
        document.body,
      )}
    </div>
  )
}
