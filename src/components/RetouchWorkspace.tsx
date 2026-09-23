import type { CSSProperties, PointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getActiveApiProfile, validateApiProfile } from '../lib/apiProfiles'
import { calculateImageSize } from '../lib/size'
import type { RetouchCategoryId, RetouchGenerationMode, RetouchPreviewMode, RetouchStrengthId, RetouchTargetId, RetouchTemplate, RetouchTemplateId } from '../services/retouch-model'
import { buildStackedRetouchPrompt, categoryTemplateAliases, getNearestOutputRatio, getOutputSizePreset, mergeTemplateParams, outputSizeHints, outputSizeTiers, previewZoomMax, previewZoomMin, retouchCategories, retouchTemplates, sameImageIds, strengthOptions, targetOptions, truncateMiddle } from '../services/retouch-model'
import { addImageFromFile, submitTask, useStore } from '../store'
import type { TaskRecord } from '../types'
import SizePickerModal from './SizePickerModal'
import { CloseIcon, EditIcon, PhotoIcon, SettingsIcon } from './icons'
import { useCachedImageSource } from './retouch/Canvas'
import RetouchCanvas from './retouch/CanvasPanel'
import RetouchHistory from './retouch/History'
import RetouchOutputSettings from './retouch/OutputSettings'
import RetouchSidebar from './retouch/Sidebar'

function getApiDisplayLabel(value: string) {
  if (!value || value === '未填写 API 地址') return value
  try {
    const url = new URL(value)
    return url.host
  } catch {
    return truncateMiddle(value)
  }
}

async function loadFiles(files: FileList | File[]) {
  const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'))
  for (const file of imageFiles) {
    await addImageFromFile(file)
  }
  return imageFiles.length
}

export default function RetouchWorkspace() {
  const settings = useStore((s) => s.settings)
  const tasks = useStore((s) => s.tasks)
  const inputImages = useStore((s) => s.inputImages)
  const prompt = useStore((s) => s.prompt)
  const params = useStore((s) => s.params)
  const setPrompt = useStore((s) => s.setPrompt)
  const setParams = useStore((s) => s.setParams)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const setMaskEditorImageId = useStore((s) => s.setMaskEditorImageId)
  const removeInputImage = useStore((s) => s.removeInputImage)
  const clearInputImages = useStore((s) => s.clearInputImages)
  const clearMaskDraft = useStore((s) => s.clearMaskDraft)
  const maskDraft = useStore((s) => s.maskDraft)
  const showSettings = useStore((s) => s.showSettings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const showToast = useStore((s) => s.showToast)

  const previewStageRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showSizePicker, setShowSizePicker] = useState(false)
  const [selectedOutputRatio, setSelectedOutputRatio] = useState<{ size: string; ratio: string } | null>(null)
  const [previewStageSize, setPreviewStageSize] = useState({ width: 0, height: 0 })
  const [previewImageAspect, setPreviewImageAspect] = useState<number | null>(null)
  const [previewZoom, setPreviewZoom] = useState(1)
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 })
  const [previewPanDragging, setPreviewPanDragging] = useState(false)
  const previewPanStartRef = useRef({ pointerId: 0, clientX: 0, clientY: 0, x: 0, y: 0 })
  const [isDraggingUpload, setIsDraggingUpload] = useState(false)
  const [selectedCategoryId, setSelectedCategoryId] = useState<RetouchCategoryId>('aiNative')
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<RetouchTemplateId[]>([])
  const [selectedGroupName, setSelectedGroupName] = useState<string | null>('纸刊海报')
  const [selectedStrengthId, setSelectedStrengthId] = useState<RetouchStrengthId>('standard')
  const [selectedTargetId, setSelectedTargetId] = useState<RetouchTargetId>('auto')
  const [generationMode, setGenerationMode] = useState<RetouchGenerationMode>('edit')
  const [selectedHistoryTaskId, setSelectedHistoryTaskId] = useState<string | null>(null)
  const [compareEnabled, setCompareEnabled] = useState(false)
  const [comparePosition, setComparePosition] = useState(50)
  const [compareDragging, setCompareDragging] = useState(false)
  const [inputSessionStartedAt, setInputSessionStartedAt] = useState(0)
  const [textSessionStartedAt, setTextSessionStartedAt] = useState(0)
  const inputSignatureRef = useRef<string | null>(null)
  const generatedPromptRef = useRef<string | null>(null)
  const promptManuallyEditedRef = useRef(false)
  const activeProfile = useMemo(() => getActiveApiProfile(settings), [settings])
  const apiIssue = validateApiProfile(activeProfile)
  const qualityLocked = activeProfile.provider === 'openai' && activeProfile.codexCli
  const effectiveQuality = qualityLocked ? 'auto' : activeProfile.provider === 'fal' && params.quality === 'auto' ? 'high' : params.quality
  const retouchTasks = useMemo(
    () => tasks.filter((task) => task.sourceMode !== 'agent' && !task.agentConversationId && !task.agentRoundId),
    [tasks],
  )
  const currentInputIds = useMemo(() => inputImages.map((image) => image.id), [inputImages])
  const currentInputSignature = currentInputIds.join('|')
  const hasCurrentInput = currentInputIds.length > 0
  const isTextToImageMode = generationMode === 'text'
  const isImageEditMode = generationMode === 'edit'
  const latestTaskForCurrentInput = hasCurrentInput
    ? retouchTasks.find((task) =>
      task.createdAt >= inputSessionStartedAt &&
      sameImageIds(task.inputImageIds, currentInputIds),
    ) ?? null
    : null
  const latestTaskWithOutputForCurrentInput = latestTaskForCurrentInput?.outputImages.length
    ? latestTaskForCurrentInput
    : hasCurrentInput
      ? retouchTasks.find((task) =>
        task.createdAt >= inputSessionStartedAt &&
        task.outputImages.length > 0 &&
        sameImageIds(task.inputImageIds, currentInputIds),
      ) ?? null
      : null
  const latestTextTask = isTextToImageMode
    ? retouchTasks.find((task) => task.createdAt >= textSessionStartedAt && task.inputImageIds.length === 0) ?? null
    : null
  const latestTextTaskWithOutput = latestTextTask?.outputImages.length
    ? latestTextTask
    : isTextToImageMode
      ? retouchTasks.find((task) =>
        task.createdAt >= textSessionStartedAt &&
        task.inputImageIds.length === 0 &&
        task.outputImages.length > 0,
      ) ?? null
      : null
  const selectedHistoryTask = selectedHistoryTaskId ? retouchTasks.find((task) => task.id === selectedHistoryTaskId) ?? null : null
  const previewMode: RetouchPreviewMode = selectedHistoryTask
    ? 'history'
    : isTextToImageMode
      ? latestTextTask || latestTextTaskWithOutput ? 'current' : 'empty'
      : hasCurrentInput
        ? 'current'
        : 'empty'
  const visibleTask: TaskRecord | null = previewMode === 'history'
    ? selectedHistoryTask
    : previewMode === 'current'
      ? isTextToImageMode
        ? latestTextTaskWithOutput ?? latestTextTask
        : latestTaskWithOutputForCurrentInput ?? latestTaskForCurrentInput
      : null
  const visibleOutputTask: TaskRecord | null = visibleTask?.outputImages.length ? visibleTask : null
  const inputPreview = previewMode === 'current' && isImageEditMode ? inputImages[0]?.dataUrl ?? null : null
  const beforeImageId = visibleOutputTask?.inputImageIds[0] ?? (previewMode === 'current' && isImageEditMode ? currentInputIds[0] : null)
  const outputImageId = visibleOutputTask?.outputImages[0] ?? null
  const beforeImageSrc = useCachedImageSource(beforeImageId, inputPreview)
  const outputImageSrc = useCachedImageSource(outputImageId)
  const outputSizePreset = useMemo(() => getOutputSizePreset(params.size), [params.size])
  // 保留用户指定的比例，避免档位切换时反复从规整后的像素反推而产生偏移。
  const outputSizeRatio = selectedOutputRatio?.size === params.size
    ? selectedOutputRatio.ratio
    : outputSizePreset.ratio ?? getNearestOutputRatio(previewImageAspect)
  const outputSizeOptions = useMemo(
    () => [
      { id: 'auto' as const, label: '自动', hint: outputSizeHints.auto, value: 'auto' },
      ...outputSizeTiers.map((tier) => ({
        id: tier,
        label: tier,
        hint: outputSizeHints[tier],
        value: calculateImageSize(tier, outputSizeRatio) ?? 'auto',
      })),
    ],
    [outputSizeRatio],
  )
  const activeOutputSizeId = outputSizePreset.id
  const hasPreviewImage = Boolean(outputImageSrc || beforeImageSrc)
  const canCompare = Boolean(visibleOutputTask?.inputImageIds[0] && visibleOutputTask?.outputImages[0] && beforeImageSrc && outputImageSrc)
  const canUsePreviewZoom = hasPreviewImage && !(compareEnabled && canCompare)
  const previewTitle = outputImageSrc
    ? previewMode === 'history' ? '历史结果' : isTextToImageMode ? '生成结果' : '修图结果'
    : previewMode === 'history' ? '历史原图' : previewMode === 'current' ? isTextToImageMode ? '生成中' : '输入参考' : '空白画布'
  const previewEmptyHasHistorySelection = previewMode === 'history'
  const currentStatusTask = previewMode === 'current' ? isTextToImageMode ? latestTextTask : latestTaskForCurrentInput : null
  const selectedTemplates = selectedTemplateIds
    .map((id) => retouchTemplates.find((template) => template.id === id))
    .filter((template): template is RetouchTemplate => Boolean(template))
  const selectedConfigCount = selectedTemplates.length
  const selectedTemplateSummary = selectedTemplates.length
    ? selectedTemplates.map((template) => template.title).join(' + ')
    : '自定义修图'
  const currentWorkSummary = isTextToImageMode ? '文生图创作' : selectedTemplateSummary
  const selectedCategory = retouchCategories.find((category) => category.id === selectedCategoryId) ?? retouchCategories[0]
  const selectedStrength = strengthOptions.find((option) => option.id === selectedStrengthId) ?? strengthOptions[1]
  const selectedTarget = targetOptions.find((option) => option.id === selectedTargetId) ?? targetOptions[0]
  const categoryIds = categoryTemplateAliases[selectedCategoryId] ?? [selectedCategoryId]
  const categoryTemplates = retouchTemplates.filter((template) => categoryIds.includes(template.category))
  const groupedCategoryTemplates = categoryTemplates.reduce<Array<{ group: string; templates: RetouchTemplate[] }>>((groups, template) => {
    const group = template.group ?? selectedCategory.title
    const current = groups.find((item) => item.group === group)
    if (current) {
      current.templates.push(template)
    } else {
      groups.push({ group, templates: [template] })
    }
    return groups
  }, [])
  const activeGroupName = selectedGroupName && groupedCategoryTemplates.some((group) => group.group === selectedGroupName)
    ? selectedGroupName
    : groupedCategoryTemplates[0]?.group ?? null
  const activeGroupTemplates = groupedCategoryTemplates.find((group) => group.group === activeGroupName)?.templates ?? []
  const getCategorySelectionCount = (categoryId: RetouchCategoryId) => {
    const ids = categoryTemplateAliases[categoryId] ?? [categoryId]
    return selectedTemplates.filter((template) => ids.includes(template.category)).length
  }
  const getGroupSelectionCount = (templates: RetouchTemplate[]) => (
    templates.filter((template) => selectedTemplateIds.includes(template.id)).length
  )
  const setGeneratedPrompt = (nextPrompt: string) => {
    generatedPromptRef.current = nextPrompt
    promptManuallyEditedRef.current = false
    if (useStore.getState().prompt !== nextPrompt) setPrompt(nextPrompt)
  }
  const canReplaceWithGeneratedPrompt = (nextPrompt: string) => {
    const currentPrompt = useStore.getState().prompt
    if (promptManuallyEditedRef.current) return false
    if (!currentPrompt.trim()) return true
    if (generatedPromptRef.current !== null) return currentPrompt === generatedPromptRef.current
    return currentPrompt === nextPrompt
  }
  const historyTasks = retouchTasks
  const maskTargetInput = maskDraft ? inputImages.find((image) => image.id === maskDraft.targetImageId) ?? null : null
  const referenceImages = maskTargetInput ? inputImages.filter((image) => image.id !== maskTargetInput.id) : inputImages
  const activeBaseUrl = activeProfile.baseUrl.trim()
  const requestBaseUrl = activeBaseUrl
    ? `${activeBaseUrl.replace(/\/+$/, '')}${activeBaseUrl.replace(/\/+$/, '').endsWith('/v1') ? '' : '/v1'}`
    : '未填写 API 地址'
  const previewImageFitStyle = useMemo<CSSProperties | undefined>(() => {
    if (!previewImageAspect || previewImageAspect <= 0 || !previewStageSize.width || !previewStageSize.height) return undefined
    const stageAspect = previewStageSize.width / previewStageSize.height
    const fitWidth = stageAspect > previewImageAspect
      ? previewStageSize.height * previewImageAspect
      : previewStageSize.width
    const fitHeight = stageAspect > previewImageAspect
      ? previewStageSize.height
      : previewStageSize.width / previewImageAspect

    return {
      width: `${Math.max(1, Math.floor(fitWidth))}px`,
      height: `${Math.max(1, Math.floor(fitHeight))}px`,
    }
  }, [previewImageAspect, previewStageSize.height, previewStageSize.width])
  const previewImageTransformStyle = useMemo<CSSProperties | undefined>(() => {
    if (previewZoom <= 1 && previewPan.x === 0 && previewPan.y === 0) return undefined
    return {
      transform: `translate(${previewPan.x}px, ${previewPan.y}px) scale(${previewZoom})`,
      cursor: previewZoom > 1 ? (previewPanDragging ? 'grabbing' : 'grab') : undefined,
      transition: previewPanDragging ? 'none' : undefined,
    }
  }, [previewPan.x, previewPan.y, previewPanDragging, previewZoom])
  const handlePreviewImageMeasure = (aspectRatio: number) => {
    if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return
    setPreviewImageAspect((current) => (
      current != null && Math.abs(current - aspectRatio) < 0.001 ? current : aspectRatio
    ))
  }

  useEffect(() => {
    const node = previewStageRef.current
    if (!node) return

    const updateSize = () => {
      const rect = node.getBoundingClientRect()
      const width = Math.max(0, Math.floor(rect.width))
      const height = Math.max(0, Math.floor(rect.height))
      setPreviewStageSize((current) => (
        current.width === width && current.height === height ? current : { width, height }
      ))
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setPreviewImageAspect(null)
    setPreviewZoom(1)
    setPreviewPan({ x: 0, y: 0 })
  }, [beforeImageId, outputImageId, previewMode])

  useEffect(() => {
    if (selectedHistoryTaskId && !retouchTasks.some((task) => task.id === selectedHistoryTaskId)) {
      setSelectedHistoryTaskId(null)
    }
  }, [retouchTasks, selectedHistoryTaskId])

  useEffect(() => {
    if (inputSignatureRef.current == null) {
      inputSignatureRef.current = currentInputSignature
      return
    }
    if (inputSignatureRef.current === currentInputSignature) return
    inputSignatureRef.current = currentInputSignature
    setInputSessionStartedAt(Date.now())
    setSelectedHistoryTaskId(null)
    setCompareEnabled(false)
  }, [currentInputSignature])

  useEffect(() => {
    if (!hasCurrentInput && !selectedHistoryTaskId && inputSessionStartedAt !== 0) {
      setInputSessionStartedAt(0)
    }
  }, [hasCurrentInput, inputSessionStartedAt, selectedHistoryTaskId])

  useEffect(() => {
    if (!canCompare && compareEnabled) setCompareEnabled(false)
  }, [canCompare, compareEnabled])

  useEffect(() => {
    if (!canUsePreviewZoom && previewZoom !== 1) {
      setPreviewZoom(1)
      setPreviewPan({ x: 0, y: 0 })
    }
  }, [canUsePreviewZoom, previewZoom])

  useEffect(() => {
    if (groupedCategoryTemplates.length && !groupedCategoryTemplates.some((group) => group.group === selectedGroupName)) {
      setSelectedGroupName(groupedCategoryTemplates[0].group)
    }
  }, [groupedCategoryTemplates, selectedGroupName])

  const handleRemoveInputImage = (index: number) => {
    removeInputImage(index)
  }

  const handleClearInputImages = () => {
    clearInputImages()
  }

  const toggleTemplate = (template: RetouchTemplate) => {
    const isRemoving = selectedTemplateIds.includes(template.id)
    // 一张成品只使用一种纸刊版式；普通修图功能仍可叠加。
    const compatibleTemplateIds = template.composition === 'poster'
      ? selectedTemplateIds.filter((id) => retouchTemplates.find((item) => item.id === id)?.composition !== 'poster')
      : selectedTemplateIds
    const nextTemplateIds = isRemoving
      ? selectedTemplateIds.filter((id) => id !== template.id)
      : [...compatibleTemplateIds, template.id]
    const nextTemplates = nextTemplateIds
      .map((id) => retouchTemplates.find((item) => item.id === id))
      .filter((item): item is RetouchTemplate => Boolean(item))

    setSelectedCategoryId(template.category)
    setSelectedGroupName(template.group ?? template.category)
    setSelectedTemplateIds(nextTemplateIds)
    setGeneratedPrompt(buildStackedRetouchPrompt(nextTemplates, selectedStrengthId, selectedTargetId))
    if (nextTemplates.length) setParams(mergeTemplateParams(nextTemplates))
    showToast(
      isRemoving
        ? `已移除「${template.title}」`
        : template.composition === 'poster'
        ? `已选用「${template.title}」纸刊版式`
        : `已叠加「${template.title}」`,
      'success',
    )
  }

  const applyStrength = (strengthId: RetouchStrengthId) => {
    setSelectedStrengthId(strengthId)
    if (selectedTemplates.length) {
      const nextPrompt = buildStackedRetouchPrompt(selectedTemplates, strengthId, selectedTargetId)
      if (canReplaceWithGeneratedPrompt(nextPrompt)) setGeneratedPrompt(nextPrompt)
    }
    showToast(`强度已设为「${strengthOptions.find((option) => option.id === strengthId)?.label ?? '标准'}」`, 'success')
  }

  const applyTarget = (targetId: RetouchTargetId) => {
    setSelectedTargetId(targetId)
    if (selectedTemplates.length) {
      const nextPrompt = buildStackedRetouchPrompt(selectedTemplates, selectedStrengthId, targetId)
      if (canReplaceWithGeneratedPrompt(nextPrompt)) setGeneratedPrompt(nextPrompt)
    }
    showToast(`对象已设为「${targetOptions.find((option) => option.id === targetId)?.label ?? '自动'}」`, 'success')
  }

  const updateComparePosition = (clientX: number) => {
    const rect = previewStageRef.current?.getBoundingClientRect()
    if (!rect) return
    const next = ((clientX - rect.left) / rect.width) * 100
    setComparePosition(Math.max(4, Math.min(96, next)))
  }

  const handleCompareToggle = () => {
    if (!canCompare) {
      showToast('需要先上传参考图并完成一次修图，才能开启前后对比', 'info')
      return
    }
    setCompareEnabled((current) => !current)
  }

  const handleComparePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!canCompare) return
    setCompareEnabled(true)
    setCompareDragging(true)
    updateComparePosition(event.clientX)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleComparePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (compareDragging) updateComparePosition(event.clientX)
  }

  const handleComparePointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    setCompareDragging(false)
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const applyPreviewZoom = (zoom: number) => {
    if (!hasPreviewImage) {
      showToast('先上传参考图或选择历史结果后再放大查看', 'info')
      return
    }
    if (compareEnabled && canCompare) {
      showToast('前后对比模式下暂不支持放大，请先关闭对比', 'info')
      return
    }
    const next = Math.max(previewZoomMin, Math.min(previewZoomMax, zoom))
    setPreviewZoom(next)
    if (next === 1) setPreviewPan({ x: 0, y: 0 })
  }

  const handlePreviewWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!canUsePreviewZoom) return
    event.preventDefault()
    const next = previewZoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12)
    applyPreviewZoom(Math.round(Math.max(previewZoomMin, Math.min(previewZoomMax, next)) * 100) / 100)
  }

  const handlePreviewPanPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!canUsePreviewZoom || previewZoom <= 1 || event.button !== 0) return
    setPreviewPanDragging(true)
    previewPanStartRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: previewPan.x,
      y: previewPan.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePreviewPanPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!previewPanDragging || previewPanStartRef.current.pointerId !== event.pointerId) return
    setPreviewPan({
      x: previewPanStartRef.current.x + event.clientX - previewPanStartRef.current.clientX,
      y: previewPanStartRef.current.y + event.clientY - previewPanStartRef.current.clientY,
    })
  }

  const handlePreviewPanPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (previewPanStartRef.current.pointerId === event.pointerId && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setPreviewPanDragging(false)
  }

  const switchGenerationMode = (mode: RetouchGenerationMode) => {
    if (mode === generationMode) return
    setGenerationMode(mode)
    setSelectedHistoryTaskId(null)
    setCompareEnabled(false)
    if (mode === 'text') {
      setTextSessionStartedAt(Date.now())
      showToast(inputImages.length ? '已切换为文生图，提交时不会引用参考图' : '已切换为文生图', 'success')
    } else {
      showToast('已切换为图生图修图', 'success')
    }
  }

  const handleFiles = async (files: FileList | File[]) => {
    try {
      const count = await loadFiles(files)
      if (count > 0) {
        setGenerationMode('edit')
        setSelectedHistoryTaskId(null)
        setCompareEnabled(false)
        showToast(`已添加 ${count} 张参考图，已切换为图生图修图`, 'success')
      }
    } catch (error) {
      showToast(`上传失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  const handleSubmit = async () => {
    if (apiIssue) {
      showToast(`请先配置 API：${apiIssue}`, 'error')
      setShowSettings(true, 'api')
      return
    }
    if (isImageEditMode && inputImages.length === 0) {
      showToast('图生图修图需要先上传参考图，或切换到文生图', 'info')
      return
    }
    setSelectedHistoryTaskId(null)
    setCompareEnabled(false)
    if (isTextToImageMode && textSessionStartedAt === 0) setTextSessionStartedAt(Date.now())
    void submitTask({ textToImage: isTextToImageMode })
  }

  const handleMaskEdit = () => {
    if (isTextToImageMode) {
      showToast('文生图不需要遮罩；切换到图生图修图后再涂抹区域', 'info')
      return
    }
    const targetId = maskDraft?.targetImageId ?? inputImages[0]?.id
    if (!targetId) {
      showToast('请先上传一张参考图，再涂抹指定区域', 'info')
      return
    }
    setMaskEditorImageId(targetId)
  }

  const openVisibleOutput = () => {
    if (!visibleTask?.outputImages.length) {
      showToast('当前还没有可查看的输出图', 'info')
      return
    }
    setLightboxImageId(visibleTask.outputImages[0], visibleTask.outputImages)
  }

  const promptFieldLabel = isTextToImageMode ? '画面描述' : '修图要求'
  const promptPlaceholder = isTextToImageMode
    ? '直接描述要生成的画面、主体、风格、镜头、光线、构图和比例。例：商业棚拍质感的护肤品海报，白色背景，柔和侧光，干净高级。'
    : '直接描述要修哪里、强度、必须保留什么。例：保留人物身份和镜框结构，去掉皮肤瑕疵，肤色更干净自然。'
  const submitLabel = apiIssue ? '连接 API' : isTextToImageMode ? '生成图像' : maskDraft ? '开始局部修图' : '开始修图'
  const historyTitle = isTextToImageMode ? '生成历史' : '修图历史'
  const currentPromptFallback = isTextToImageMode
    ? '写清楚主体、场景、风格、构图、色彩、比例和不想出现的内容。'
    : '先选择一个修图预设，或者在右侧输入框直接写修图要求。'

  return (
    <section data-no-drag-select aria-label="AIPic 图像工作室" className="retouch-workspace safe-area-x">
      <div className="retouch-studio-shell">
        <div className="retouch-studio-body">
          <RetouchSidebar
            setShowSettings={setShowSettings}
            requestBaseUrl={requestBaseUrl}
            activeProfile={activeProfile}
            apiIssue={apiIssue}
            getApiDisplayLabel={getApiDisplayLabel}
            selectedConfigCount={selectedConfigCount}
            selectedCategoryId={selectedCategoryId}
            getCategorySelectionCount={getCategorySelectionCount}
            setSelectedCategoryId={setSelectedCategoryId}
            setSelectedGroupName={setSelectedGroupName}
            selectedCategory={selectedCategory}
            groupedCategoryTemplates={groupedCategoryTemplates}
            getGroupSelectionCount={getGroupSelectionCount}
            activeGroupName={activeGroupName}
            activeGroupTemplates={activeGroupTemplates}
            selectedTemplateIds={selectedTemplateIds}
            toggleTemplate={toggleTemplate}
            selectedStrength={selectedStrength}
            selectedTarget={selectedTarget}
            selectedStrengthId={selectedStrengthId}
            applyStrength={applyStrength}
            selectedTargetId={selectedTargetId}
            applyTarget={applyTarget}
          />

          <RetouchCanvas
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
            isDraggingUpload={isDraggingUpload}
            setIsDraggingUpload={setIsDraggingUpload}
            handleFiles={handleFiles}
            previewStageRef={previewStageRef}
            outputImageSrc={outputImageSrc}
            beforeImageSrc={beforeImageSrc}
            previewImageFitStyle={previewImageFitStyle}
            handlePreviewImageMeasure={handlePreviewImageMeasure}
            comparePosition={comparePosition}
            setComparePosition={setComparePosition}
            handleComparePointerDown={handleComparePointerDown}
            handleComparePointerMove={handleComparePointerMove}
            handleComparePointerEnd={handleComparePointerEnd}
            handlePreviewWheel={handlePreviewWheel}
            handlePreviewPanPointerDown={handlePreviewPanPointerDown}
            handlePreviewPanPointerMove={handlePreviewPanPointerMove}
            handlePreviewPanPointerEnd={handlePreviewPanPointerEnd}
            previewImageTransformStyle={previewImageTransformStyle}
            previewEmptyHasHistorySelection={previewEmptyHasHistorySelection}
            generationMode={generationMode}
            fileInputRef={fileInputRef}
            currentStatusTask={currentStatusTask}
            hasPreviewImage={hasPreviewImage}
          />

          <aside
            className={`retouch-control-panel ${isDraggingUpload ? 'is-dragging' : ''} ${showSettings ? 'is-muted' : ''}`}
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
            <div className="retouch-section-heading retouch-control-heading">
              <span>创作设置</span>
              <div className="retouch-control-heading-actions">
                <strong>{isTextToImageMode ? '文生图' : maskDraft ? '遮罩编辑' : params.n > 1 ? `${params.n} 张输出` : '单张输出'}</strong>
                <button type="button" className="apple-icon-button retouch-panel-settings" onClick={() => setShowSettings(true, 'api')} aria-label="打开设置" title="设置">
                  <SettingsIcon className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="retouch-side-submit">
              <div className="retouch-segment-group retouch-mode-switch" role="group" aria-label="生成模式">
                <span>模式</span>
                <button
                  type="button"
                  className={isTextToImageMode ? 'is-active' : ''}
                  aria-pressed={isTextToImageMode}
                  onClick={() => switchGenerationMode('text')}
                >
                  <strong>文生图</strong>
                  <small>纯文字</small>
                </button>
                <button
                  type="button"
                  className={isImageEditMode ? 'is-active' : ''}
                  aria-pressed={isImageEditMode}
                  onClick={() => switchGenerationMode('edit')}
                >
                  <strong>图生图</strong>
                  <small>参考图修图</small>
                </button>
              </div>
              <button type="button" className="retouch-upload-button" onClick={() => fileInputRef.current?.click()}>
                <PhotoIcon className="h-4 w-4" />
                <span>{inputImages.length ? `${inputImages.length} 张参考图` : isTextToImageMode ? '上传参考图并修图' : '上传参考图'}</span>
              </button>
              {isTextToImageMode && inputImages.length > 0 && (
                <div className="retouch-mode-note">当前为文生图，提交时不会引用这些参考图。</div>
              )}
              {inputImages.length > 0 && (
                <div className="retouch-thumb-row">
                  {inputImages.slice(0, 5).map((image, index) => (
                    <div
                      key={image.id}
                      className={`retouch-input-thumb ${image.id === maskDraft?.targetImageId ? 'is-mask-target' : ''}`}
                      title={`参考图 ${index + 1}`}
                    >
                      <img src={image.dataUrl} alt={`参考图 ${index + 1}`} />
                      <button type="button" aria-label={`移除参考图 ${index + 1}`} onClick={() => handleRemoveInputImage(index)}>
                        <CloseIcon className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {inputImages.length > 5 && <span className="retouch-thumb-more">+{inputImages.length - 5}</span>}
                  <button type="button" className="retouch-clear-images" onClick={handleClearInputImages}>清空</button>
                </div>
              )}
              {maskDraft && (
                <div className="retouch-mask-status">
                  <span>{maskTargetInput ? '已生成局部遮罩' : '遮罩主图缺失'}</span>
                  <strong>{maskTargetInput ? `${referenceImages.length} 张额外参考图` : '请重新涂抹'}</strong>
                  <button type="button" onClick={clearMaskDraft}>移除遮罩</button>
                </div>
              )}
              <button type="button" className="retouch-mask-button" onClick={handleMaskEdit}>
                <EditIcon className="h-4 w-4" />
                <span>{isTextToImageMode ? '切换修图后可使用局部编辑' : maskDraft ? '编辑已选区域' : '选择局部编辑区域'}</span>
              </button>
              <label className="retouch-prompt-field">
                <span>{promptFieldLabel}</span>
                <textarea
                  value={prompt}
                  onChange={(event) => {
                    promptManuallyEditedRef.current = true
                    setPrompt(event.target.value)
                  }}
                  placeholder={promptPlaceholder}
                  spellCheck={false}
                  rows={5}
                />
              </label>
              <RetouchOutputSettings
                params={params}
                setParams={setParams}
                outputSizeOptions={outputSizeOptions}
                activeOutputSizeId={activeOutputSizeId}
                setSelectedOutputRatio={setSelectedOutputRatio}
                outputSizeRatio={outputSizeRatio}
                showToast={showToast}
                showSizePicker={showSizePicker}
                setShowSizePicker={setShowSizePicker}
                activeProfile={activeProfile}
                qualityLocked={qualityLocked}
                effectiveQuality={effectiveQuality}
                handleSubmit={handleSubmit}
                submitLabel={submitLabel}
              />
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
          </aside>

          <RetouchHistory
            historyTitle={historyTitle}
            retouchTasks={retouchTasks}
            historyTasks={historyTasks}
            selectedHistoryTaskId={selectedHistoryTaskId}
            setCompareEnabled={setCompareEnabled}
            setSelectedHistoryTaskId={setSelectedHistoryTaskId}
            showToast={showToast}
            params={params}
            currentWorkSummary={currentWorkSummary}
            prompt={prompt}
            currentPromptFallback={currentPromptFallback}
            visibleTask={visibleTask}
            activeProfile={activeProfile}
          />
        </div>
      </div>
      {showSizePicker && (
        <SizePickerModal
          currentSize={params.size}
          onSelect={(size, ratio) => {
            setSelectedOutputRatio(ratio ? { size, ratio } : null)
            setParams({ size })
            showToast(size === 'auto' ? '输出尺寸已设为自动' : `输出尺寸已设为 ${size}`, 'success')
          }}
          onClose={() => setShowSizePicker(false)}
        />
      )}
    </section>
  )
}
