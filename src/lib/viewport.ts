const VIEWPORT_CONTENT = 'width=device-width, initial-scale=1.0, viewport-fit=cover'

/** 保留安全区与浏览器缩放；画布缩放由各自的指针交互处理。 */
export function installMobileViewportGuards() {
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (viewport) viewport.content = VIEWPORT_CONTENT
}
