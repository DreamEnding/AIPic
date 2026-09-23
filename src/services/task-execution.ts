import { callImageApi } from '../lib/api'
import { DEFAULT_SETTINGS, getActiveApiProfile, getCustomProviderDefinition, normalizeSettings, validateApiProfile } from '../lib/apiProfiles'
import { validateMaskMatchesImage } from '../lib/canvasImage'
import {
storeImage
} from '../lib/db'
import { getFlyreqQueuedImageResult, isFlyreqTaskRecoverableError } from '../lib/flyreqImageApi'
import { IMAGE_FETCH_CORS_HINT } from '../lib/imageApiShared'
import { getImageRequestTimeoutSeconds } from '../lib/imageRequestTimeout'
import { orderInputImagesForMask } from '../lib/mask'
import { getCustomQueuedImageResult } from '../lib/openaiCompatibleImageApi'
import { getChangedParams, normalizeParamsForSettings } from '../lib/paramCompatibility'
import { replaceImageMentionsForApi } from '../lib/promptImageMentions'
import { deleteUnreferencedImageIds, persistTaskStreamPartialImage } from '../services/agent-execution'
import { genId } from '../services/id'
import { cacheImage, ensureImageCached, imageCache } from '../services/image-cache'
import { OPENAI_INTERRUPTED_ERROR, putTask, showCodexCliPrompt, updateTaskInStore, useStore } from '../store'
import type {
ApiMode,
ApiProfile,
AppSettings,
TaskParams,
TaskRecord
} from '../types'

const CUSTOM_RECOVERY_POLL_MS = 10_000

const BACKEND_RECOVERY_POLL_MS = 10_000

const customRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()

const backendRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()

const backendRecoveryRunning = new Set<string>()

const TIMEOUT_STREAMING_HINT = '也可尝试打开「流式传输」，并提高「请求中间步骤图像数」来维持连接。'

const TIMEOUT_PARTIAL_IMAGES_ZERO_HINT = '官方流式接口不发送心跳，当前「请求中间步骤图像数」为 0，连接可能因无数据传输而断开。建议提高到 2 或 3。'

const TIMEOUT_PARTIAL_IMAGES_LOW_HINT = '也可尝试提高「请求中间步骤图像数」来维持连接，避免长时间无数据传输导致断开。'

type TimeoutStreamingHintProfile = Pick<ApiProfile, 'provider' | 'streamImages' | 'streamPartialImages'>

function getTimeoutStreamingHint(profile?: TimeoutStreamingHintProfile | null) {
  if (profile?.provider !== 'openai') return ''
  const partialImages = profile.streamPartialImages ?? DEFAULT_SETTINGS.streamPartialImages ?? 0
  if (profile.streamImages !== true) return TIMEOUT_STREAMING_HINT
  if (partialImages === 0) return TIMEOUT_PARTIAL_IMAGES_ZERO_HINT
  return partialImages < 3 ? TIMEOUT_PARTIAL_IMAGES_LOW_HINT : ''
}

function isOpenAITask(task: TaskRecord) {
  return (task.apiProvider ?? 'openai') !== 'fal'
}

function isRunningOpenAITask(task: TaskRecord) {
  return task.status === 'running' && isOpenAITask(task)
}

export function markInterruptedOpenAIRunningTasks(tasks: TaskRecord[], now = Date.now()) {
  const interruptedTasks: TaskRecord[] = []
  const updatedTasks = tasks.map((task) => {
    if (!isRunningOpenAITask(task) || task.customTaskId || task.backendTaskId) return task

    const updated: TaskRecord = {
      ...task,
      status: 'error',
      error: OPENAI_INTERRUPTED_ERROR,
      falRecoverable: false,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    }
    interruptedTasks.push(updated)
    return updated
  })

  return { tasks: updatedTasks, interruptedTasks }
}

function getCustomRecoveryProfile(settings: AppSettings, task: TaskRecord) {
  const provider = task.apiProvider
  if (!provider || provider === 'openai' || provider === 'fal') return null
  const taskProfile = getTaskApiProfile(settings, task)
  if (taskProfile?.provider === provider) return taskProfile
  return null
}

export function getTaskApiProfile(settings: AppSettings, task: TaskRecord): ApiProfile | null {
  const normalized = normalizeSettings(settings)
  const provider = task.apiProvider

  if (!task.apiProfileId) return null

  const byId = normalized.profiles.find((profile) => profile.id === task.apiProfileId)
  if (byId && (!provider || byId.provider === provider)) return byId
  return null
}

export function createSettingsForApiProfile(settings: AppSettings, profile: ApiProfile): AppSettings {
  const normalized = normalizeSettings(settings)
  return normalizeSettings({
    ...normalized,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    timeout: profile.timeout,
    apiMode: profile.apiMode,
    codexCli: profile.codexCli,
    apiProxy: profile.apiProxy,
    streamImages: profile.streamImages,
    streamPartialImages: profile.streamPartialImages,
    profiles: normalized.profiles.map((item) => item.id === profile.id ? profile : item),
    activeProfileId: profile.id,
  })
}

function getReusedTaskApiProfile(settings: AppSettings, profileId: string | null): ApiProfile | null {
  if (!profileId) return null
  return normalizeSettings(settings).profiles.find((profile) => profile.id === profileId) ?? null
}

export function getTaskApiProfileName(task: TaskRecord) {
  return task.apiProfileName || task.apiModel || '未知配置'
}

function isFalConnectionRecoverableError(err: unknown) {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') return true
  const message = err instanceof Error ? err.message : String(err)
  return /abort|network|failed to fetch|fetch failed|load failed|timeout|连接|断开|中断/i.test(message)
}

function isApiRequestNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) {
    const message = err.message.toLowerCase()
    return /failed to fetch|fetch failed|load failed|networkerror|network request failed/i.test(message)
  }
  return false
}

function getApiModeApiName(apiMode: ApiMode) {
  return apiMode === 'responses' ? 'Responses API' : 'Image API'
}

export function getApiRequestNetworkErrorHint(
  err: unknown,
  createdAt: number,
  usesApiProxy: boolean,
  profile?: Pick<ApiProfile, 'provider' | 'apiMode' | 'streamImages' | 'streamPartialImages'> | null,
): string | null {
  if (!isApiRequestNetworkError(err)) return null

  const elapsedSeconds = Math.max(0, (Date.now() - createdAt) / 1000)

  if (elapsedSeconds <= 15) {
    if (usesApiProxy) {
      return '提示：请求已走本地 API 代理但立即失败，请检查本地代理是否仍在运行、API Key 是否有效，或上游 API 服务是否可用。'
    }
    const unsupportedApiHint = profile?.provider === 'openai'
      ? `\n· API 不支持 ${getApiModeApiName(profile.apiMode)}`
      : ''
    return `提示：请求立即失败，可能原因：\n· API 服务器不可达或地址有误，请检查 API URL 是否正确、服务是否正常运行${unsupportedApiHint}\n· 接口不支持浏览器跨域请求，可使用 Docker 部署版或本地运行版并配置 API 代理解决`
  }

  if (elapsedSeconds >= 55 && elapsedSeconds <= 75) {
    return `提示：请求等待约 60 秒后被断开，这通常是 Nginx 等反向代理的默认超时，而非接口本身报错。可调大代理的超时时间（如 proxy_read_timeout），或降低图片尺寸/质量后重试。${getTimeoutStreamingHint(profile)}`
  }

  if (elapsedSeconds >= 110 && elapsedSeconds <= 140) {
    return `提示：请求等待约 120 秒后被断开，这通常是 Cloudflare 等 CDN/网关的超时限制，而非接口本身报错。如果使用 Cloudflare，可考虑升级套餐或使用不经过 CDN 的直连地址。${getTimeoutStreamingHint(profile)}`
  }

  return `提示：请求等待较长时间后被断开，通常是反向代理或网关的超时限制，而非接口本身报错。可检查代理超时设置，或降低图片尺寸/质量后重试。${getTimeoutStreamingHint(profile)}`
}

export function getApiResponseStatusHint(
  err: unknown,
  usesApiProxy: boolean,
  profile?: Pick<ApiProfile, 'provider' | 'streamImages' | 'streamPartialImages'> | null,
): string | null {
  if (!(err instanceof Error)) return null
  const status = 'status' in err ? (err as { status?: unknown }).status : undefined
  if (status === 524) {
    return usesApiProxy
      ? `提示：请求已到达上游服务，但上游源站在网关等待时间内没有返回结果（524）。这不是前端或 Pages 代理故障。请先用 1K、1 张、快速质量测试，开启流式传输/中间图，或换模型/渠道；4K、精修、多图、带参考图更容易触发。${getTimeoutStreamingHint(profile)}`
      : `提示：API 返回 524，说明上游源站长时间没有响应。请先降低尺寸/质量/数量，开启流式传输/中间图，或更换直连地址、模型、渠道后重试。${getTimeoutStreamingHint(profile)}`
  }
  if (status !== 502) return null

  return usesApiProxy
    ? '提示：线上服务端转发已工作，但上游接口返回 502。常见原因是中转站余额不足、渠道故障、当前模型不支持 Image API、或 4K/多图/参考图任务生成时间过长。可先用 1K、1 张、快速质量测试，或切换模型/渠道后重试。'
    : '提示：API 返回 502。常见原因是上游渠道故障、模型不支持当前接口，或高规格图片生成超时。可先降低尺寸/质量/数量后重试。'
}

function getRawErrorPayload(err: unknown): Pick<Partial<TaskRecord>, 'rawImageUrls' | 'rawResponsePayload'> {
  if (!(err instanceof Error)) return {}

  const rawImageUrls = 'rawImageUrls' in err ? (err as { rawImageUrls?: unknown }).rawImageUrls : undefined
  const rawResponsePayload = 'rawResponsePayload' in err ? (err as { rawResponsePayload?: unknown }).rawResponsePayload : undefined
  return {
    rawImageUrls: Array.isArray(rawImageUrls) && rawImageUrls.length ? rawImageUrls.filter((url): url is string => typeof url === 'string') : undefined,
    rawResponsePayload: typeof rawResponsePayload === 'string' ? rawResponsePayload : undefined,
  }
}

function clearCustomRecoveryTimer(taskId: string) {
  const timer = customRecoveryTimers.get(taskId)
  if (timer) clearTimeout(timer)
  customRecoveryTimers.delete(taskId)
}

export function scheduleCustomRecovery(taskId: string, delayMs = CUSTOM_RECOVERY_POLL_MS) {
  if (customRecoveryTimers.has(taskId)) return
  const timer = setTimeout(() => {
    customRecoveryTimers.delete(taskId)
    recoverCustomTask(taskId)
  }, delayMs)
  customRecoveryTimers.set(taskId, timer)
}

function clearBackendRecoveryTimer(taskId: string) {
  const timer = backendRecoveryTimers.get(taskId)
  if (timer) clearTimeout(timer)
  backendRecoveryTimers.delete(taskId)
}

export function scheduleBackendRecovery(taskId: string, delayMs = BACKEND_RECOVERY_POLL_MS) {
  if (backendRecoveryTimers.has(taskId)) return
  const timer = setTimeout(() => {
    backendRecoveryTimers.delete(taskId)
    void recoverBackendTask(taskId)
  }, delayMs)
  backendRecoveryTimers.set(taskId, timer)
}

function hasActualParams(params: Partial<TaskParams> | undefined): params is Partial<TaskParams> {
  return Boolean(params && Object.keys(params).length > 0)
}

function firstActualParams(paramsList: Array<Partial<TaskParams> | undefined> | undefined): Partial<TaskParams> | undefined {
  return paramsList?.find(hasActualParams)
}

function mapActualParamsByImage(outputIds: string[], paramsList: Array<Partial<TaskParams> | undefined> | undefined) {
  const mapped = paramsList?.reduce<Record<string, Partial<TaskParams>>>((acc, params, index) => {
    const imgId = outputIds[index]
    if (imgId && hasActualParams(params)) acc[imgId] = params
    return acc
  }, {})
  return mapped && Object.keys(mapped).length > 0 ? mapped : undefined
}

async function readImageSizeParam(dataUrl: string): Promise<Partial<TaskParams> | undefined> {
  if (typeof Image === 'undefined') return undefined

  return new Promise((resolve) => {
    let settled = false
    const image = new Image()
    const finish = (params: Partial<TaskParams> | undefined) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(params)
    }
    const timer = setTimeout(() => finish(undefined), 2000)
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        finish({ size: `${image.naturalWidth}x${image.naturalHeight}` })
      } else {
        finish(undefined)
      }
    }
    image.onerror = () => finish(undefined)
    image.src = dataUrl
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      finish({ size: `${image.naturalWidth}x${image.naturalHeight}` })
    }
  })
}

async function readImageSizeParamsList(images: string[]): Promise<Array<Partial<TaskParams> | undefined>> {
  return Promise.all(images.map((image) => readImageSizeParam(image)))
}

async function resolveImageSizeParamsList(
  images: string[],
  preferred?: Array<Partial<TaskParams> | undefined>,
): Promise<Array<Partial<TaskParams> | undefined>> {
  if (preferred?.length === images.length && preferred.every(hasActualParams)) return preferred
  const fallback = await readImageSizeParamsList(images)
  return images.map((_, index) => hasActualParams(preferred?.[index]) ? preferred?.[index] : fallback[index])
}

export async function submitTask(options: { allowFullMask?: boolean; useCurrentApiProfileWhenReusedMissing?: boolean; textToImage?: boolean } = {}) {
  const { settings, prompt, inputImages, maskDraft, params, reusedTaskApiProfileId, reusedTaskApiProfileName, reusedTaskApiProfileMissing, showToast, setConfirmDialog } =
    useStore.getState()

  const normalizedSettings = normalizeSettings(settings)
  let activeProfile = getActiveApiProfile(settings)
  let requestSettings = createSettingsForApiProfile(normalizedSettings, activeProfile)
  activeProfile = getActiveApiProfile(requestSettings)
  if (normalizedSettings.reuseTaskApiProfileTemporarily && (reusedTaskApiProfileId || reusedTaskApiProfileMissing)) {
    const reusedProfile = getReusedTaskApiProfile(normalizedSettings, reusedTaskApiProfileId)
    if (!reusedProfile) {
      if (options.useCurrentApiProfileWhenReusedMissing) {
        useStore.getState().setReusedTaskApiProfile(null)
      } else {
        setConfirmDialog({
          title: '找不到 API 配置',
      message: `找不到复用任务所使用的 API 配置「${reusedTaskApiProfileName || '未知配置'}」，要使用当前的 API 配置「${activeProfile.name}」提交任务吗？`,
      confirmText: '使用当前配置提交',
      cancelText: '放弃提交',
      action: () => {
        void submitTask({ ...options, useCurrentApiProfileWhenReusedMissing: true })
      },
        })
        return
      }
    } else {
      activeProfile = reusedProfile
      requestSettings = createSettingsForApiProfile(normalizedSettings, reusedProfile)
    }
  }

  if (validateApiProfile(activeProfile)) {
    showToast(`请先完善请求 API 配置：${validateApiProfile(activeProfile)}`, 'error')
    useStore.getState().setShowSettings(true)
    return
  }

  if (!prompt.trim()) {
    showToast('请输入提示词', 'error')
    return
  }

  const sourceInputImages = options.textToImage ? [] : inputImages
  const sourceMaskDraft = options.textToImage ? null : maskDraft
  let orderedInputImages = sourceInputImages
  let maskImageId: string | null = null
  let maskTargetImageId: string | null = null

  if (sourceMaskDraft) {
    try {
      orderedInputImages = orderInputImagesForMask(sourceInputImages, sourceMaskDraft.targetImageId)
      const coverage = await validateMaskMatchesImage(sourceMaskDraft.maskDataUrl, orderedInputImages[0].dataUrl)
      if (coverage === 'full' && !options.allowFullMask) {
        setConfirmDialog({
          title: '确认编辑整张图片？',
          message: '当前遮罩覆盖了整张图片，提交后可能会重绘全部内容。是否继续？',
          confirmText: '继续提交',
          tone: 'warning',
          action: () => {
            void submitTask({ ...options, allowFullMask: true })
          },
        })
        return
      }
      maskImageId = await storeImage(sourceMaskDraft.maskDataUrl, 'mask')
      cacheImage(maskImageId, sourceMaskDraft.maskDataUrl)
      maskTargetImageId = sourceMaskDraft.targetImageId
    } catch (err) {
      if (!sourceInputImages.some((img) => img.id === sourceMaskDraft.targetImageId)) {
        useStore.getState().clearMaskDraft()
      }
      showToast(err instanceof Error ? err.message : String(err), 'error')
      return
    }
  }

  // 持久化输入图片到 IndexedDB（此前只在内存缓存中）
  for (const img of orderedInputImages) {
    await storeImage(img.dataUrl)
  }

  const normalizedParams = normalizeParamsForSettings(params, requestSettings, { hasInputImages: orderedInputImages.length > 0 })
  const normalizedParamPatch = getChangedParams(params, normalizedParams)
  if (Object.keys(normalizedParamPatch).length) {
    useStore.getState().setParams(normalizedParamPatch)
  }

  const taskId = genId()
  const task: TaskRecord = {
    id: taskId,
    prompt: prompt.trim(),
    params: normalizedParams,
    apiProvider: activeProfile.provider,
    apiProfileId: activeProfile.id,
    apiProfileName: activeProfile.name,
    apiMode: activeProfile.apiMode,
    apiModel: activeProfile.model,
    inputImageIds: orderedInputImages.map((i) => i.id),
    maskTargetImageId,
    maskImageId,
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
    elapsed: null,
  }

  const latestTasks = useStore.getState().tasks
  useStore.getState().setTasks([task, ...latestTasks])
  await putTask(task)
  useStore.getState().showToast('任务已提交', 'success')

  if (settings.clearInputAfterSubmit) {
    useStore.getState().setPrompt('')
    if (!options.textToImage) useStore.getState().clearInputImages()
  }
  useStore.getState().setReusedTaskApiProfile(null)

  // 异步调用 API
  executeTask(taskId)
}

async function executeTask(taskId: string) {
  const { settings } = useStore.getState()
  const task = useStore.getState().tasks.find((t) => t.id === taskId)
  if (!task) return
  const taskProfile = getTaskApiProfile(settings, task)
  if (!taskProfile && task.apiProfileId) {
    updateTaskInStore(taskId, {
      status: 'error',
      error: '找不到此任务所使用的 API 配置。',
      falRecoverable: false,
      customRecoverable: false,
      backendRecoverable: false,
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })
    return
  }
  const activeProfile = taskProfile ?? getActiveApiProfile(settings)
  const requestSettings = createSettingsForApiProfile(settings, activeProfile)
  const taskProvider = task.apiProvider ?? activeProfile.provider
  let customTaskInfo: { taskId: string } | null = task.customTaskId
    ? { taskId: task.customTaskId }
    : null
  let backendTaskInfo: { taskId: string } | null = task.backendTaskId
    ? { taskId: task.backendTaskId }
    : null

  // Each API request owns its timeout. Local image loading/saving must not discard
  // a successful generation, and concurrent requests may return partial success.

  try {
    // 获取输入图片 data URLs
    const inputDataUrls: string[] = []
    for (const imgId of task.inputImageIds) {
      const dataUrl = await ensureImageCached(imgId)
      if (!dataUrl) throw new Error('输入图片已不存在')
      inputDataUrls.push(dataUrl)
    }
    let maskDataUrl: string | undefined
    if (task.maskImageId) {
      maskDataUrl = await ensureImageCached(task.maskImageId)
      if (!maskDataUrl) throw new Error('遮罩图片已不存在')
    }

    const result = await callImageApi({
      settings: requestSettings,
      prompt: replaceImageMentionsForApi(task.prompt, inputDataUrls.length),
      params: task.params,
      inputImageDataUrls: inputDataUrls,
      maskDataUrl,
      onCustomTaskEnqueued: (request) => {
        customTaskInfo = request
        updateTaskInStore(taskId, {
          customTaskId: request.taskId,
          customRecoverable: false,
        })
      },
      onBackendTaskEnqueued: async (request) => {
        backendTaskInfo = request
        updateTaskInStore(taskId, {
          backendTaskId: request.taskId,
          backendRecoverable: false,
        })
        // Persist the server ID before polling, so reloading only resumes this job.
        const queuedTask = useStore.getState().tasks.find((item) => item.id === taskId)
        if (queuedTask) await putTask(queuedTask)
      },
      onPartialImage: (partial) => {
        useStore.getState().setTaskStreamPreview(taskId, partial.image, partial.requestIndex)
        void persistTaskStreamPartialImage(taskId, partial.image)
      },
    })

    const latestBeforeSuccess = useStore.getState().tasks.find((t) => t.id === taskId)
    if (!latestBeforeSuccess || latestBeforeSuccess.status !== 'running') {
      useStore.getState().setTaskStreamPreview(taskId)
      return
    }

    // 存储输出图片
    const outputIds: string[] = []
    for (const dataUrl of result.images) {
      const imgId = await storeImage(dataUrl, 'generated')
      cacheImage(imgId, dataUrl)
      outputIds.push(imgId)
    }
    const isAsyncCustomTask = taskProvider !== 'fal' && taskProvider !== 'openai' && Boolean(customTaskInfo)
    const actualParamsList = taskProvider === 'fal' || Boolean(backendTaskInfo)
      ? await resolveImageSizeParamsList(result.images, result.actualParamsList)
      : isAsyncCustomTask
      ? await readImageSizeParamsList(result.images)
      : result.actualParamsList
    const actualParams = (() => {
      if (taskProvider === 'fal' || backendTaskInfo) return firstActualParams(actualParamsList)
      if (isAsyncCustomTask) return firstActualParams(actualParamsList)
      return { ...result.actualParams, n: outputIds.length }
    })()
    const shouldStoreRevisedPrompts = taskProvider !== 'fal' && !isAsyncCustomTask
    const actualParamsByImage = mapActualParamsByImage(outputIds, actualParamsList)
    const revisedPromptByImage = shouldStoreRevisedPrompts ? result.revisedPrompts?.reduce<Record<string, string>>((acc, revisedPrompt, index) => {
      const imgId = outputIds[index]
      if (imgId && revisedPrompt && revisedPrompt.trim()) acc[imgId] = revisedPrompt
      return acc
    }, {}) : undefined
    const promptWasRevised = shouldStoreRevisedPrompts && result.revisedPrompts?.some(
      (revisedPrompt) => revisedPrompt?.trim() && revisedPrompt.trim() !== task.prompt.trim(),
    )
    const hasRevisedPromptValue = shouldStoreRevisedPrompts && result.revisedPrompts?.some((revisedPrompt) => revisedPrompt?.trim())
    if (taskProvider === 'openai' && activeProfile.apiMode === 'responses' && !activeProfile.codexCli) {
      if (promptWasRevised) {
        showCodexCliPrompt()
      } else if (!hasRevisedPromptValue) {
        showCodexCliPrompt(false, '接口没有返回官方 API 会返回的部分信息')
      }
    }

    // 更新任务
    const latestBeforeUpdate = useStore.getState().tasks.find((t) => t.id === taskId)
    if (!latestBeforeUpdate || latestBeforeUpdate.status !== 'running') {
      useStore.getState().setTaskStreamPreview(taskId)
      return
    }
    const partialImageIdsToClean = latestBeforeUpdate.streamPartialImageIds || []
    useStore.getState().setTaskStreamPreview(taskId)
    updateTaskInStore(taskId, {
      outputImages: outputIds,
      streamPartialImageIds: undefined,
      rawImageUrls: result.rawImageUrls?.length ? result.rawImageUrls : undefined,
      backendWarning: result.warning,
      actualParams,
      actualParamsByImage,
      revisedPromptByImage: revisedPromptByImage && Object.keys(revisedPromptByImage).length > 0 ? revisedPromptByImage : undefined,
      status: 'done',
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
      falRecoverable: false,
      customRecoverable: false,
      backendRecoverable: false,
    })
    void deleteUnreferencedImageIds(partialImageIdsToClean)

    useStore.getState().showToast(result.warning || `生成完成，共 ${outputIds.length} 张图片`, result.warning ? 'info' : 'success')
    const currentMask = useStore.getState().maskDraft
    if (
      maskDataUrl &&
      currentMask &&
      currentMask.targetImageId === task.maskTargetImageId &&
      currentMask.maskDataUrl === maskDataUrl
    ) {
      useStore.getState().clearMaskDraft()
    }
  } catch (err) {
    const latestTask = useStore.getState().tasks.find((t) => t.id === taskId) ?? task
    if (latestTask.status !== 'running') return
    useStore.getState().setTaskStreamPreview(taskId)
    const latestCustomTaskInfo = customTaskInfo ?? (latestTask.customTaskId ? { taskId: latestTask.customTaskId } : null)
    const latestBackendTaskInfo = backendTaskInfo ?? (latestTask.backendTaskId ? { taskId: latestTask.backendTaskId } : null)
    if (latestBackendTaskInfo && isFlyreqTaskRecoverableError(err)) {
      updateTaskInStore(taskId, {
        status: 'running',
        error: err.message,
        ...getRawErrorPayload(err),
        backendTaskId: latestBackendTaskInfo.taskId,
        backendRecoverable: true,
        finishedAt: null,
        elapsed: null,
      })
      scheduleBackendRecovery(taskId)
    } else if (latestCustomTaskInfo && isFalConnectionRecoverableError(err)) {
      updateTaskInStore(taskId, {
        status: 'error',
        error: '与自定义异步任务的连接已断开，之后会继续查询任务结果。',
        customTaskId: latestCustomTaskInfo.taskId,
        customRecoverable: true,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      })
      scheduleCustomRecovery(taskId)
    } else {
      let errorMessage = err instanceof Error ? err.message : String(err)
      const settings = useStore.getState().settings
      const profile = getTaskApiProfile(settings, latestTask)
      const usesApiProxy = profile?.apiProxy ?? settings.apiProxy
      const activeProfile = getActiveApiProfile(settings)
      const hintProfile = profile ?? {
        provider: latestTask.apiProvider ?? activeProfile.provider,
        apiMode: settings.apiMode,
        streamImages: activeProfile.streamImages,
        streamPartialImages: activeProfile.streamPartialImages,
      }
      const networkErrorHint = getApiRequestNetworkErrorHint(err, latestTask.createdAt, usesApiProxy, hintProfile)
      if (networkErrorHint && !errorMessage.includes(IMAGE_FETCH_CORS_HINT)) {
        errorMessage += `\n${networkErrorHint}`
      }
      const responseStatusHint = getApiResponseStatusHint(err, usesApiProxy, hintProfile)
      if (responseStatusHint && !errorMessage.includes(responseStatusHint)) {
        errorMessage += `\n${responseStatusHint}`
      }
      updateTaskInStore(taskId, {
        status: 'error',
        error: errorMessage,
        ...getRawErrorPayload(err),
        falRecoverable: false,
        customRecoverable: false,
        backendRecoverable: false,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      })
      useStore.getState().setDetailTaskId(taskId)
    }
  } finally {
    // 释放输入图片的内存缓存（已持久化到 IndexedDB，后续按需从 DB 加载）
    for (const imgId of task.inputImageIds) {
      imageCache.delete(imgId)
    }
  }
}

export async function retryTask(task: TaskRecord) {
  const { settings } = useStore.getState()
  const activeProfile = getActiveApiProfile(settings)
  const normalizedParams = normalizeParamsForSettings(task.params, settings, { hasInputImages: task.inputImageIds.length > 0 })
  const taskId = genId()
  const newTask: TaskRecord = {
    id: taskId,
    prompt: task.prompt,
    params: normalizedParams,
    apiProvider: activeProfile.provider,
    apiProfileId: activeProfile.id,
    apiProfileName: activeProfile.name,
    apiMode: activeProfile.apiMode,
    apiModel: activeProfile.model,
    inputImageIds: [...task.inputImageIds],
    maskTargetImageId: task.maskTargetImageId ?? null,
    maskImageId: task.maskImageId ?? null,
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
    elapsed: null,
  }

  const latestTasks = useStore.getState().tasks
  useStore.getState().setTasks([newTask, ...latestTasks])
  await putTask(newTask)

  executeTask(taskId)
}

async function recoverBackendTask(taskId: string) {
  if (backendRecoveryRunning.has(taskId)) return
  const { tasks, settings } = useStore.getState()
  const task = tasks.find((item) => item.id === taskId)
  if (!task?.backendTaskId || (task.status !== 'running' && !task.backendRecoverable)) return

  backendRecoveryRunning.add(taskId)
  try {
    const profile = getTaskApiProfile(settings, task)
    const timeoutSeconds = profile ? getImageRequestTimeoutSeconds(profile, task.params) : 1800
    const result = await getFlyreqQueuedImageResult(task.backendTaskId, task.params, timeoutSeconds)
    const latest = useStore.getState().tasks.find((item) => item.id === taskId)
    if (!latest || (latest.status !== 'running' && !latest.backendRecoverable)) return

    const actualParamsList = await resolveImageSizeParamsList(result.images, result.actualParamsList)
    const outputIds: string[] = []
    for (const dataUrl of result.images) {
      const imgId = await storeImage(dataUrl, 'generated')
      cacheImage(imgId, dataUrl)
      outputIds.push(imgId)
    }
    const current = useStore.getState().tasks.find((item) => item.id === taskId)
    if (!current || (current.status !== 'running' && !current.backendRecoverable)) return
    clearBackendRecoveryTimer(taskId)
    useStore.getState().setTaskStreamPreview(taskId)
    updateTaskInStore(taskId, {
      outputImages: outputIds,
      streamPartialImageIds: undefined,
      rawImageUrls: result.rawImageUrls,
      actualParams: firstActualParams(actualParamsList),
      actualParamsByImage: mapActualParamsByImage(outputIds, actualParamsList),
      revisedPromptByImage: undefined,
      status: 'done',
      error: null,
      backendRecoverable: false,
      backendWarning: result.warning,
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })
    void deleteUnreferencedImageIds(current.streamPartialImageIds || [])
    useStore.getState().showToast(result.warning || `后端任务已恢复，共 ${outputIds.length} 张图片`, result.warning ? 'info' : 'success')
  } catch (error) {
    const latest = useStore.getState().tasks.find((item) => item.id === taskId)
    if (!latest || (latest.status !== 'running' && !latest.backendRecoverable)) return
    if (isFlyreqTaskRecoverableError(error)) {
      updateTaskInStore(taskId, {
        status: 'running',
        error: error.message,
        ...getRawErrorPayload(error),
        backendRecoverable: true,
        finishedAt: null,
        elapsed: null,
      })
      scheduleBackendRecovery(taskId)
      return
    }
    clearBackendRecoveryTimer(taskId)
    updateTaskInStore(taskId, {
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      ...getRawErrorPayload(error),
      backendRecoverable: false,
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })
  } finally {
    backendRecoveryRunning.delete(taskId)
  }
}

async function completeRecoveredCustomTask(task: TaskRecord, result: Awaited<ReturnType<typeof getCustomQueuedImageResult>>) {
  const latest = useStore.getState().tasks.find((item) => item.id === task.id)
  if (!latest || latest.status === 'done') return

  const actualParamsList = await readImageSizeParamsList(result.images)
  const outputIds: string[] = []
  for (const dataUrl of result.images) {
    const imgId = await storeImage(dataUrl, 'generated')
    cacheImage(imgId, dataUrl)
    outputIds.push(imgId)
  }

  updateTaskInStore(task.id, {
    outputImages: outputIds,
    actualParams: firstActualParams(actualParamsList),
    actualParamsByImage: mapActualParamsByImage(outputIds, actualParamsList),
    revisedPromptByImage: undefined,
    status: 'done',
    error: null,
    customRecoverable: false,
    finishedAt: Date.now(),
    elapsed: Date.now() - task.createdAt,
  })
  useStore.getState().showToast(`自定义异步任务已恢复，共 ${outputIds.length} 张图片`, 'success')
}

async function recoverCustomTask(taskId: string) {
  const { settings, tasks } = useStore.getState()
  const task = tasks.find((item) => item.id === taskId)
  if (!task || !task.customTaskId || task.status === 'done') return

  const profile = getCustomRecoveryProfile(settings, task)
  const customProvider = task.apiProvider ? getCustomProviderDefinition(settings, task.apiProvider) : null
  if (!profile || !customProvider?.poll) {
    scheduleCustomRecovery(taskId)
    return
  }

  try {
    const result = await getCustomQueuedImageResult(profile, customProvider, task.customTaskId, task.params)
    clearCustomRecoveryTimer(taskId)
    await completeRecoveredCustomTask(task, result)
  } catch (err) {
    clearCustomRecoveryTimer(taskId)
    updateTaskInStore(taskId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      ...getRawErrorPayload(err),
      customRecoverable: false,
      backendRecoverable: false,
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })
  }
}
