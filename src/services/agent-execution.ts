import { callAgentConversationTitleApi, callAgentResponsesApi, callBatchImageSingle, parseBatchImageCallArguments, type AgentApiResultImage } from '../lib/agentApi'
import { collectAgentRoundOutputImageSlots, extractAgentReferenceIds, getAgentCurrentReferenceId, getAgentGeneratedImageReferenceId, replaceAgentPromptImageReferencesForApi } from '../lib/agentImageReferences'
import { getActiveApiProfile, normalizeSettings, validateApiProfile } from '../lib/apiProfiles'
import { validateMaskMatchesImage } from '../lib/canvasImage'
import {
deleteImage,
storeImage
} from '../lib/db'
import { IMAGE_FETCH_CORS_HINT } from '../lib/imageApiShared'
import { orderInputImagesForMask } from '../lib/mask'
import { normalizeParamsForSettings } from '../lib/paramCompatibility'
import { createAgentConversationTitle } from '../services/agent-conversations'
import { genId } from '../services/id'
import { cacheImage, ensureImageCached, imageCache, thumbnailCache } from '../services/image-cache'
import type { AgentInputDraft } from '../services/input-drafts'
import { isRecord } from '../services/input-drafts'
import { createSettingsForApiProfile, getApiRequestNetworkErrorHint, getApiResponseStatusHint, putTask, updateTaskInStore, useStore } from '../store'
import type {
AgentConversation,
AgentMessage,
AgentRound,
ApiProfile,
AppSettings,
ResponsesApiResponse,
ResponsesOutputItem,
TaskParams,
TaskRecord
} from '../types'
import { DEFAULT_AGENT_MAX_TOOL_ROUNDS, DEFAULT_PARAMS } from '../types'

const AGENT_ROUND_IMAGE_MENTION_RE = /@(?:第)?(\d+)轮图(\d+)/g

const agentRoundControllers = new Map<string, AbortController>()

const AGENT_STOPPED_MESSAGE = '已停止生成。'

function getActiveAgentConversation(): AgentConversation {
  const state = useStore.getState()
  const existing = state.agentConversations.find((conversation) => conversation.id === state.activeAgentConversationId)
  if (existing) return existing

  const id = state.createAgentConversation()
  return useStore.getState().agentConversations.find((conversation) => conversation.id === id)!
}

function updateAgentConversation(conversationId: string, updater: (conversation: AgentConversation) => AgentConversation) {
  useStore.setState((state) => ({
    agentConversations: state.agentConversations.map((conversation) =>
      conversation.id === conversationId ? updater(conversation) : conversation,
    ),
  }))
}

function getAgentRoundControllerKey(conversationId: string, roundId: string) {
  return `${conversationId}:${roundId}`
}

function createAgentAbortError() {
  return new DOMException('Agent 请求已停止', 'AbortError')
}

function appendAgentStoppedMessage(content: string) {
  const trimmed = content.trimEnd()
  if (!trimmed) return AGENT_STOPPED_MESSAGE
  if (trimmed.endsWith(AGENT_STOPPED_MESSAGE)) return trimmed
  return `${trimmed}\n\n${AGENT_STOPPED_MESSAGE}`
}

function markAgentRoundTasksStopped(conversationId: string, roundId: string, now = Date.now()) {
  const runningTasks = useStore.getState().tasks.filter((task) =>
    task.status === 'running' &&
    task.agentConversationId === conversationId &&
    task.agentRoundId === roundId,
  )

  for (const task of runningTasks) {
    updateTaskInStore(task.id, {
      status: 'error',
      error: AGENT_STOPPED_MESSAGE,
      falRecoverable: false,
      customRecoverable: false,
      backendRecoverable: false,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    })
  }
  return runningTasks.length > 0
}

function markAgentRoundStopped(conversationId: string, roundId: string) {
  const now = Date.now()
  const stoppedTasks = markAgentRoundTasksStopped(conversationId, roundId, now)
  let stoppedRound = false
  updateAgentConversation(conversationId, (current) => {
    const round = current.rounds.find((item) => item.id === roundId)
    if (!round || round.status !== 'running') return current

    stoppedRound = true
    const existingAssistantMessage = current.messages.find((message) => message.roundId === roundId && message.role === 'assistant')
    const assistantMessageId = existingAssistantMessage?.id ?? genId()
    return {
      ...current,
      updatedAt: now,
      rounds: current.rounds.map((item) =>
        item.id === roundId
          ? {
              ...item,
              ...(assistantMessageId ? { assistantMessageId } : {}),
              status: 'error',
              error: AGENT_STOPPED_MESSAGE,
              finishedAt: now,
            }
          : item,
      ),
      messages: existingAssistantMessage
        ? current.messages.map((message) =>
            message.id === existingAssistantMessage.id
              ? { ...message, content: appendAgentStoppedMessage(message.content) }
              : message,
          )
        : [
            ...current.messages,
            {
              id: assistantMessageId,
              role: 'assistant',
              content: AGENT_STOPPED_MESSAGE,
              roundId,
              createdAt: now,
            },
          ],
    }
  })
  return stoppedRound || stoppedTasks
}

function appendAgentAssistantMessageContent(conversationId: string, messageId: string, delta: string) {
  if (!delta) return
  updateAgentConversation(conversationId, (current) => ({
    ...current,
    updatedAt: Date.now(),
    messages: current.messages.map((message) =>
      message.id === messageId
        ? { ...message, content: `${message.content}${delta}` }
        : message,
    ),
  }))
}

async function generateAgentConversationTitle(
  conversationId: string,
  prompt: string,
  inputImageIds: string[],
  requestSettings: AppSettings,
  activeProfile: ApiProfile,
  fallbackTitle: string,
) {
  useStore.setState((state) => {
    const next = { ...state.agentGeneratingTitleIds, [conversationId]: true as const }
    return { agentGeneratingTitleIds: next }
  })
  try {
    const imageDataUrls = await readAgentImageDataUrls(inputImageIds)
    const title = await callAgentConversationTitleApi({
      settings: requestSettings,
      profile: activeProfile,
      prompt,
      imageDataUrls,
    })
    if (!title || title === fallbackTitle) return

    updateAgentConversation(conversationId, (current) => {
      const firstRound = current.rounds[0]
      if (!firstRound || firstRound.prompt !== prompt || current.title !== fallbackTitle) return current
      return { ...current, title, updatedAt: Date.now() }
    })
  } catch {
    // Title generation is best-effort; keep the local fallback title on failure.
  } finally {
    useStore.setState((state) => {
      const next = { ...state.agentGeneratingTitleIds }
      delete next[conversationId]
      return { agentGeneratingTitleIds: next }
    })
  }
}

export function stopAgentResponse(conversationId = useStore.getState().activeAgentConversationId) {
  if (!conversationId) return
  const conversation = useStore.getState().agentConversations.find((item) => item.id === conversationId)
  if (!conversation) return
  const activeRunningRound = [...getActiveAgentRounds(conversation)].reverse().find((round) => round.status === 'running')
  const runningRound = activeRunningRound ?? conversation.rounds.find((round) => round.status === 'running')
  if (!runningRound) return

  const controller = agentRoundControllers.get(getAgentRoundControllerKey(conversationId, runningRound.id))
  if (controller) {
    controller.abort()
    if (markAgentRoundStopped(conversationId, runningRound.id)) {
      useStore.getState().showToast('已停止生成', 'info')
    }
    return
  }

  markAgentRoundStopped(conversationId, runningRound.id)
  useStore.getState().showToast('已停止生成', 'info')
}

function getAgentRoundChildren(conversation: AgentConversation, parentRoundId: string | null) {
  return conversation.rounds.filter((round) => (round.parentRoundId ?? null) === parentRoundId)
}

function getLatestAgentLeafId(conversation: AgentConversation, startRoundId: string | null = null): string | null {
  let currentId = startRoundId
  if (!currentId) {
    const roots = getAgentRoundChildren(conversation, null)
    currentId = roots[roots.length - 1]?.id ?? null
  }

  while (currentId) {
    const children = getAgentRoundChildren(conversation, currentId)
    const nextId = children[children.length - 1]?.id ?? null
    if (!nextId) return currentId
    currentId = nextId
  }

  return null
}

export function getAgentRoundPath(conversation: AgentConversation, roundId: string | null): AgentRound[] {
  if (!roundId) return []
  const byId = new Map(conversation.rounds.map((round) => [round.id, round]))
  const path: AgentRound[] = []
  const seen = new Set<string>()
  let current = byId.get(roundId) ?? null

  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentRoundId ? byId.get(current.parentRoundId) ?? null : null
  }

  return path
}

export function getActiveAgentRounds(conversation: AgentConversation): AgentRound[] {
  const activeRoundId = conversation.activeRoundId && conversation.rounds.some((round) => round.id === conversation.activeRoundId)
    ? conversation.activeRoundId
    : getLatestAgentLeafId(conversation)
  return getAgentRoundPath(conversation, activeRoundId ?? null)
}

function reindexAgentRounds(conversation: AgentConversation): AgentConversation {
  const indexById = new Map<string, number>()
  const visit = (parentRoundId: string | null, depth: number) => {
    for (const child of getAgentRoundChildren(conversation, parentRoundId)) {
      indexById.set(child.id, depth)
      visit(child.id, depth + 1)
    }
  }
  visit(null, 1)
  return {
    ...conversation,
    rounds: conversation.rounds.map((round) => ({
      ...round,
      index: indexById.get(round.id) ?? round.index,
    })),
  }
}

export function remapAgentRoundMentionsForPathChange(content: string, oldPath: AgentRound[], newPath: AgentRound[]) {
  if (!content || oldPath.length === 0) return content
  const newIndexByRoundId = new Map(newPath.map((round, index) => [round.id, index + 1]))
  return content.replace(AGENT_ROUND_IMAGE_MENTION_RE, (match, roundNumber: string, imageNumber: string) => {
    const oldRound = oldPath[Number(roundNumber) - 1]
    if (!oldRound) return match
    const newRoundIndex = newIndexByRoundId.get(oldRound.id)
    if (!newRoundIndex) return `@已删除轮次图${imageNumber}`
    return `@第${newRoundIndex}轮图${imageNumber}`
  })
}

export function deleteAgentRoundFromConversation(conversation: AgentConversation, roundId: string, now = Date.now()): AgentConversation {
  const targetRound = conversation.rounds.find((round) => round.id === roundId)
  if (!targetRound) return conversation

  const oldPathByRoundId = new Map(conversation.rounds.map((round) => [round.id, getAgentRoundPath(conversation, round.id)]))
  const rounds = conversation.rounds
    .filter((candidate) => candidate.id !== roundId)
    .map((candidate) =>
      candidate.parentRoundId === roundId
        ? { ...candidate, parentRoundId: targetRound.parentRoundId ?? null }
        : candidate,
    )
  const messages = conversation.messages.filter((candidate) => candidate.roundId !== roundId)
  const nextConversation = reindexAgentRounds({
    ...conversation,
    rounds,
    messages,
    activeRoundId: conversation.activeRoundId === roundId ? null : conversation.activeRoundId ?? null,
  })
  const newPathByRoundId = new Map(nextConversation.rounds.map((round) => [round.id, getAgentRoundPath(nextConversation, round.id)]))
  const remappedMessages = nextConversation.messages.map((message) => {
    if (!message.roundId) return message
    const oldPath = oldPathByRoundId.get(message.roundId) ?? []
    const newPath = newPathByRoundId.get(message.roundId) ?? []
    const content = remapAgentRoundMentionsForPathChange(message.content, oldPath, newPath)
    return content === message.content ? message : { ...message, content }
  })
  const withRemappedMessages = { ...nextConversation, messages: remappedMessages }
  const activeRounds = getActiveAgentRounds(withRemappedMessages)
  return {
    ...withRemappedMessages,
    activeRoundId: withRemappedMessages.activeRoundId ?? activeRounds[activeRounds.length - 1]?.id ?? null,
    updatedAt: now,
  }
}

export function getAgentSiblingRounds(conversation: AgentConversation, round: AgentRound) {
  return getAgentRoundChildren(conversation, round.parentRoundId ?? null)
}

export function getAgentBranchLeafId(conversation: AgentConversation, roundId: string) {
  return getLatestAgentLeafId(conversation, roundId) ?? roundId
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)))
}

export function addAgentReferencedImageIds(target: Set<string>, conversations = useStore.getState().agentConversations, inputDrafts = useStore.getState().agentInputDrafts) {
  for (const conversation of conversations) {
    for (const round of conversation.rounds) {
      for (const id of round.inputImageIds) target.add(id)
      if (round.maskImageId) target.add(round.maskImageId)
    }
    for (const message of conversation.messages) {
      if (message.maskImageId) target.add(message.maskImageId)
    }
  }
  for (const draft of Object.values(inputDrafts)) {
    for (const img of draft.inputImages) target.add(img.id)
  }
}

export function addInputDraftReferencedImageIds(target: Set<string>, draft: AgentInputDraft | null) {
  if (!draft) return
  for (const img of draft.inputImages) target.add(img.id)
}

export function addTaskReferencedImageIds(target: Set<string>, task: TaskRecord) {
  for (const id of task.inputImageIds || []) target.add(id)
  if (task.maskImageId) target.add(task.maskImageId)
  for (const id of task.outputImages || []) target.add(id)
  for (const id of task.streamPartialImageIds || []) target.add(id)
}

export async function deleteUnreferencedImageIds(imageIds: Iterable<string>) {
  const candidates = Array.from(new Set(Array.from(imageIds).filter(Boolean)))
  if (candidates.length === 0) return

  const { tasks, inputImages, galleryInputDraft } = useStore.getState()
  const stillUsed = new Set<string>()
  for (const task of tasks) addTaskReferencedImageIds(stillUsed, task)
  addAgentReferencedImageIds(stillUsed)
  addInputDraftReferencedImageIds(stillUsed, galleryInputDraft)
  for (const img of inputImages) stillUsed.add(img.id)

  for (const imgId of candidates) {
    if (stillUsed.has(imgId)) continue
    await deleteImage(imgId)
    imageCache.delete(imgId)
    thumbnailCache.delete(imgId)
  }
}

export async function persistTaskStreamPartialImage(taskId: string, dataUrl: string) {
  try {
    const imgId = await storeImage(dataUrl, 'generated')
    cacheImage(imgId, dataUrl)

    const latestTask = useStore.getState().tasks.find((task) => task.id === taskId)
    if (!latestTask || latestTask.status === 'done') {
      await deleteUnreferencedImageIds([imgId])
      return
    }

    const currentIds = latestTask.streamPartialImageIds || []
    if (currentIds.includes(imgId)) return
    updateTaskInStore(taskId, { streamPartialImageIds: [...currentIds, imgId] })
  } catch (err) {
    console.error(err)
  }
}

async function readAgentImageDataUrls(ids: string[]) {
  const dataUrls: string[] = []
  for (const id of ids) {
    const dataUrl = await ensureImageCached(id)
    if (dataUrl) dataUrls.push(dataUrl)
  }
  return dataUrls
}

async function createAgentUserInputItem(conversation: AgentConversation, round: AgentRound, message: AgentMessage, tasks: TaskRecord[]) {
  const imageDataUrls = await readAgentImageDataUrls(round.inputImageIds)
  const rounds = getAgentRoundPath(conversation, round.id)
  const text = replaceAgentPromptImageReferencesForApi(message.content, round, rounds, tasks)
  const referenceText = round.inputImageIds.length > 0
    ? `\n\n<available_refs>${round.inputImageIds.map((_, index) => `\n  <ref id="${getAgentCurrentReferenceId(round, index)}" />`).join('')}\n</available_refs>`
    : ''
  return {
    role: 'user',
    content: [
      { type: 'input_text', text: `${text}${referenceText}` },
      ...imageDataUrls.map((dataUrl) => ({ type: 'input_image', image_url: dataUrl })),
    ],
  }
}

async function createAgentGeneratedImagesInputItem(round: AgentRound, tasks: TaskRecord[]) {
  const contentParts: Array<{ type: string; text?: string; image_url?: string }> = []
  let imageIndex = 0
  for (const taskId of round.outputTaskIds) {
    const task = tasks.find((item) => item.id === taskId)
    if (!task) {
      contentParts.push({ type: 'input_text', text: `<removed_ref id="${getAgentGeneratedImageReferenceId(round, imageIndex)}" />` })
      imageIndex += 1
      continue
    }
    for (const imageId of task.outputImages) {
      const dataUrl = await ensureImageCached(imageId)
      if (dataUrl) {
        contentParts.push({ type: 'input_image', image_url: dataUrl })
      }
      const refId = getAgentGeneratedImageReferenceId(round, imageIndex)
      const prompt = truncateAgentReferencePrompt(task.prompt || '')
      const promptAttribute = prompt ? ` prompt="${escapeXmlAttribute(prompt)}"` : ''
      contentParts.push({ type: 'input_text', text: `<ref id="${refId}"${promptAttribute} />` })
      imageIndex += 1
    }
  }
  if (contentParts.length === 0) return null
  return { role: 'user', content: contentParts }
}

async function createAgentBatchImagesInputItem(round: AgentRound, tasks: TaskRecord[], batchTaskIds: string[]) {
  const contentParts: Array<{ type: string; text?: string; image_url?: string }> = []
  // Count existing images in the round to compute correct imageIndex offset
  let baseImageIndex = 0
  for (const taskId of round.outputTaskIds) {
    if (batchTaskIds.includes(taskId)) break
    const task = tasks.find((item) => item.id === taskId)
    baseImageIndex += task ? task.outputImages.length : 1
  }
  let imageIndex = baseImageIndex
  for (const taskId of batchTaskIds) {
    const task = tasks.find((item) => item.id === taskId)
    if (!task || task.status !== 'done') continue
    for (const imgId of task.outputImages) {
      const dataUrl = await ensureImageCached(imgId)
      if (dataUrl) {
        contentParts.push({ type: 'input_image', image_url: dataUrl })
      }
      const refId = getAgentGeneratedImageReferenceId(round, imageIndex)
      const prompt = truncateAgentReferencePrompt(task.prompt || '')
      const promptAttribute = prompt ? ` prompt="${escapeXmlAttribute(prompt)}"` : ''
      contentParts.push({ type: 'input_text', text: `<ref id="${refId}"${promptAttribute} />` })
      imageIndex += 1
    }
  }
  if (contentParts.length === 0) return null
  return { role: 'user', content: contentParts }
}

function escapeXmlAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function truncateAgentReferencePrompt(prompt: string) {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  return normalized.length > 1200 ? `${normalized.slice(0, 1200)}...` : normalized
}

function createAgentAssistantFallbackItem(text: string) {
  return {
    role: 'assistant',
    content: [{ type: 'output_text', text }],
  }
}

function parseResponseOutputFromPayload(rawResponsePayload?: string): ResponsesOutputItem[] | null {
  if (!rawResponsePayload) return null
  try {
    const payload = JSON.parse(rawResponsePayload) as { output?: unknown }
    return Array.isArray(payload.output) ? payload.output as ResponsesOutputItem[] : null
  } catch {
    return null
  }
}

function sanitizeResponseOutputItemForInput(item: ResponsesOutputItem): unknown | null {
  if (item.type === 'web_search_call') return null
  if (item.type === 'image_generation_call') return null

  if (item.type === 'message') {
    const content = (item.content ?? [])
      .map((part) => {
        if (typeof part.text !== 'string') return null
        if (part.type === 'output_text' || part.type === 'text') {
          return { type: 'output_text', text: part.text }
        }
        return null
      })
      .filter((part): part is { type: 'output_text'; text: string } => Boolean(part))

    return content.length > 0 ? { role: 'assistant', content } : null
  }

  return item
}

function filterAgentRoundResponseOutputForInput(_round: AgentRound, _tasks: TaskRecord[], output: ResponsesOutputItem[]) {
  // image_generation_call items are now dropped by sanitizeResponseOutputItemForInput;
  // this filter is kept as a structural pass-through for future use.
  return output
}

function scrubResponseOutputForDeletedAgentTasks(round: AgentRound, output: ResponsesOutputItem[], deletedTasks: TaskRecord[]) {
  const deletedTaskIds = new Set(deletedTasks.map((task) => task.id))
  const deletedToolCallIds = new Set(
    deletedTasks
      .filter((task) => task.agentRoundId === round.id && task.agentToolCallId)
      .map((task) => task.agentToolCallId!),
  )
  if (deletedTaskIds.size === 0) return output

  let anonymousImageIndex = 0
  return output.filter((item) => {
    if (item.type !== 'image_generation_call') return true

    if (typeof item.id === 'string' && item.id) {
      return !deletedToolCallIds.has(item.id)
    }

    const taskId = round.outputTaskIds[anonymousImageIndex]
    anonymousImageIndex += 1
    return !deletedTaskIds.has(taskId)
  })
}

function scrubAgentConversationsForDeletedTasks(conversations: AgentConversation[], deletedTasks: TaskRecord[]) {
  if (deletedTasks.length === 0) return conversations

  return conversations.map((conversation) => ({
    ...conversation,
    rounds: conversation.rounds.map((round) => {
      const roundDeletedTasks = deletedTasks.filter((task) => round.outputTaskIds.includes(task.id))
      if (roundDeletedTasks.length === 0 || !round.responseOutput?.length) return round
      return {
        ...round,
        responseOutput: scrubResponseOutputForDeletedAgentTasks(round, round.responseOutput, roundDeletedTasks),
      }
    }),
  }))
}

function scrubTaskRawResponsePayloadForDeletedTasks(task: TaskRecord, conversations: AgentConversation[], deletedTasks: TaskRecord[]) {
  if (!task.rawResponsePayload || !task.agentRoundId) return task

  const round = conversations
    .flatMap((conversation) => conversation.rounds)
    .find((item) => item.id === task.agentRoundId)
  if (!round) return task

  const roundDeletedTasks = deletedTasks.filter((item) => round.outputTaskIds.includes(item.id))
  if (roundDeletedTasks.length === 0) return task

  try {
    const payload = JSON.parse(task.rawResponsePayload) as ResponsesApiResponse
    if (!Array.isArray(payload.output)) return task
    const output = scrubResponseOutputForDeletedAgentTasks(round, payload.output, roundDeletedTasks)
    if (output.length === payload.output.length) return task
    return { ...task, rawResponsePayload: JSON.stringify({ ...payload, output }, null, 2) }
  } catch {
    return task
  }
}

export async function scrubAgentOutputPayloadsForDeletedTasks(deletedTasks: TaskRecord[], remainingTasks: TaskRecord[]) {
  if (deletedTasks.length === 0) return remainingTasks

  const conversations = scrubAgentConversationsForDeletedTasks(useStore.getState().agentConversations, deletedTasks)
  const scrubbedTasks = remainingTasks.map((task) => scrubTaskRawResponsePayloadForDeletedTasks(task, conversations, deletedTasks))
  useStore.setState({ agentConversations: conversations })

  for (const task of scrubbedTasks) {
    const previous = remainingTasks.find((item) => item.id === task.id)
    if (previous?.rawResponsePayload !== task.rawResponsePayload) await putTask(task)
  }

  return scrubbedTasks
}

function sanitizeResponseOutputForInput(output: ResponsesOutputItem[], options: { allowPendingFunctionCalls?: boolean } = {}) {
  const items = output
    .map(sanitizeResponseOutputItemForInput)
    .filter((item): item is unknown => item != null)
  if (options.allowPendingFunctionCalls) return items

  const functionCallIds = new Set<string>()
  const functionOutputCallIds = new Set<string>()
  for (const item of items) {
    if (!isRecord(item)) continue
    const callId = typeof item.call_id === 'string' ? item.call_id : ''
    if (!callId) continue
    if (item.type === 'function_call') functionCallIds.add(callId)
    if (item.type === 'function_call_output') functionOutputCallIds.add(callId)
  }

  return items.filter((item) => {
    if (!isRecord(item)) return true
    const callId = typeof item.call_id === 'string' ? item.call_id : ''
    if (item.type === 'function_call') return callId && functionOutputCallIds.has(callId)
    if (item.type === 'function_call_output') return callId && functionCallIds.has(callId)
    return true
  })
}

function mergeResponseOutputItems(previous: ResponsesOutputItem[], next: ResponsesOutputItem[]) {
  const merged = [...previous]
  for (const item of next) {
    const index = item.id ? merged.findIndex((existing) => existing.id === item.id) : -1
    if (index >= 0) merged[index] = item
    else merged.push(item)
  }
  return merged
}

function countResponseToolCalls(output: ResponsesOutputItem[]) {
  return output.filter((item) => item.type === 'image_generation_call').length
}

function countResponseImageCalls(output: ResponsesOutputItem[]) {
  return output.filter((item) => item.type === 'image_generation_call').length
}

function createAgentContinuationInputItem(newImageRefs: string[], toolCallsUsed: number, maxToolCalls: number) {
  const lines = [
    '[System] The app has saved your generated outputs and is continuing the same Agent turn.',
  ]
  if (newImageRefs.length > 0) {
    lines.push(
      `The following image ref ids are now available for you to reference in subsequent image_generation prompts: ${newImageRefs.join(', ')}`,
    )
  }
  lines.push(
    'Continue generating. Do NOT repeat what you already said in earlier responses.',
    'If you still need another round after this (e.g. more dependent images), call continue_generation.',
    `Tool-call budget: ${toolCallsUsed}/${maxToolCalls} used.`,
  )
  return {
    role: 'user',
    content: [{
      type: 'input_text',
      text: lines.join('\n'),
    }],
  }
}

function buildAgentContinuationInput(baseInput: unknown[], round: AgentRound, tasks: TaskRecord[], currentRoundOutput: ResponsesOutputItem[], toolCallsUsed: number, maxToolCalls: number) {
  const input = [...baseInput, ...sanitizeResponseOutputForInput(currentRoundOutput, { allowPendingFunctionCalls: true })]
  const newImageRefs = collectAgentRoundOutputImageSlots(round, tasks)
    .map((imageId, index) => imageId ? `<ref id="${getAgentGeneratedImageReferenceId(round, index)}" />` : null)
    .filter((ref): ref is string => Boolean(ref))
  input.push(createAgentContinuationInputItem(newImageRefs, toolCallsUsed, maxToolCalls))
  return input
}

function getAgentRoundResponseOutput(round: AgentRound, tasks: TaskRecord[]): ResponsesOutputItem[] | null {
  if (round.responseOutput?.length) return round.responseOutput

  for (const taskId of round.outputTaskIds) {
    const task = tasks.find((item) => item.id === taskId)
    const output = parseResponseOutputFromPayload(task?.rawResponsePayload)
    if (output?.length) return output
  }

  return null
}

async function buildAgentApiInput(conversation: AgentConversation, currentRound: AgentRound, tasks: TaskRecord[]): Promise<unknown[]> {
  const input: unknown[] = []
  const rounds = getAgentRoundPath(conversation, currentRound.id)

  for (const round of rounds) {
    const userMessage = conversation.messages.find((message) => message.id === round.userMessageId)
    if (!userMessage) continue

    input.push(await createAgentUserInputItem(conversation, round, userMessage, tasks))
    if (round.id === currentRound.id) continue

    const output = getAgentRoundResponseOutput(round, tasks)
    if (output?.length) {
      const sanitizedOutput = sanitizeResponseOutputForInput(filterAgentRoundResponseOutputForInput(round, tasks, output))
      if (sanitizedOutput.length > 0) {
        input.push(...sanitizedOutput)
      } else {
        // All output items were filtered (e.g. only image_generation_call); add fallback
        const assistantMessage = round.assistantMessageId
          ? conversation.messages.find((message) => message.id === round.assistantMessageId)
          : null
        input.push(createAgentAssistantFallbackItem(
          assistantMessage?.content || '图像已生成。',
        ))
      }
    } else {
      const assistantMessage = round.assistantMessageId
        ? conversation.messages.find((message) => message.id === round.assistantMessageId)
        : null
      input.push(createAgentAssistantFallbackItem(
        assistantMessage?.content || '[No text response]',
      ))
    }

    // Inject generated images as a separate user message with input_image parts
    if (round.outputTaskIds.length > 0) {
      const imagesItem = await createAgentGeneratedImagesInputItem(round, tasks)
      if (imagesItem) input.push(imagesItem)
    }
  }

  return input
}

export async function submitAgentMessage() {
  const state = useStore.getState()
  const { settings, prompt, inputImages, maskDraft, params, showToast } = state
  const normalizedSettings = normalizeSettings(settings)
  const activeProfile = getActiveApiProfile(normalizedSettings)

  if (activeProfile.provider !== 'openai' || activeProfile.apiMode !== 'responses') {
    state.setAppMode('agent')
    return
  }

  if (validateApiProfile(activeProfile)) {
    showToast(`请先完善请求 API 配置：${validateApiProfile(activeProfile)}`, 'error')
    state.setShowSettings(true)
    return
  }

  const trimmedPrompt = prompt.trim()
  if (!trimmedPrompt) {
    showToast('请输入消息', 'error')
    return
  }

  const conversation = getActiveAgentConversation()
  if (conversation.rounds.some((round) => round.status === 'running')) {
    showToast('请等待生成完成，或先停止生成', 'info')
    return
  }

  let orderedInputImages = inputImages
  let maskImageId: string | null = null
  let maskTargetImageId: string | null = null

  if (maskDraft) {
    try {
      orderedInputImages = orderInputImagesForMask(inputImages, maskDraft.targetImageId)
      await validateMaskMatchesImage(maskDraft.maskDataUrl, orderedInputImages[0].dataUrl)
      maskImageId = await storeImage(maskDraft.maskDataUrl, 'mask')
      cacheImage(maskImageId, maskDraft.maskDataUrl)
      maskTargetImageId = maskDraft.targetImageId
    } catch (err) {
      if (!inputImages.some((img) => img.id === maskDraft.targetImageId)) {
        state.clearMaskDraft()
      }
      showToast(err instanceof Error ? err.message : String(err), 'error')
      return
    }
  }

  const inputImageIds = uniqueIds(orderedInputImages.map((image) => image.id))

  for (const image of orderedInputImages) {
    await storeImage(image.dataUrl)
  }

  const requestSettings = createSettingsForApiProfile(normalizedSettings, activeProfile)
  const now = Date.now()
  const editingRound = state.agentEditingRoundId
    ? conversation.rounds.find((item) => item.id === state.agentEditingRoundId) ?? null
    : null
  const editingRoundAssistantMessage = editingRound?.assistantMessageId
    ? conversation.messages.find((message) => message.id === editingRound.assistantMessageId) ?? null
    : conversation.messages.find((message) => message.roundId === editingRound?.id && message.role === 'assistant') ?? null
  const editingRoundHasAssistantMessage = Boolean(editingRoundAssistantMessage)
  const editingRoundHasErrorAssistantMessage = Boolean(
    editingRound?.status === 'error' && editingRoundAssistantMessage?.content.startsWith('请求失败：'),
  )
  const editingRoundHasChildren = editingRound
    ? conversation.rounds.some((round) => (round.parentRoundId ?? null) === editingRound.id)
    : false
  const shouldAppendToEditingRound = Boolean(
    editingRound && !editingRoundHasChildren && (!editingRoundHasAssistantMessage || editingRoundHasErrorAssistantMessage),
  )
  const roundId = shouldAppendToEditingRound && editingRound ? editingRound.id : genId()
  const userMessageId = shouldAppendToEditingRound && editingRound ? editingRound.userMessageId : genId()
  const activeRounds = getActiveAgentRounds(conversation)
  const activeLeafId = activeRounds[activeRounds.length - 1]?.id ?? null
  const parentRoundId = editingRound ? editingRound.parentRoundId ?? null : activeLeafId
  const parentPath = parentRoundId ? getAgentRoundPath(conversation, parentRoundId) : []
  const normalizedParams = {
    ...normalizeParamsForSettings(params, requestSettings, { hasInputImages: inputImageIds.length > 0 }),
    n: DEFAULT_PARAMS.n,
  }
  const round: AgentRound = {
    id: roundId,
    index: shouldAppendToEditingRound && editingRound ? editingRound.index : parentPath.length + 1,
    parentRoundId,
    ...(editingRoundHasErrorAssistantMessage && editingRoundAssistantMessage ? { assistantMessageId: editingRoundAssistantMessage.id } : {}),
    userMessageId,
    prompt: trimmedPrompt,
    inputImageIds,
    maskTargetImageId,
    maskImageId,
    outputTaskIds: [],
    status: 'running',
    error: null,
    createdAt: now,
    finishedAt: null,
  }
  const userMessage: AgentMessage = {
    id: userMessageId,
    role: 'user',
    content: trimmedPrompt,
    roundId,
    inputImageIds,
    maskTargetImageId,
    maskImageId,
    createdAt: now,
  }

  let fallbackTitle: string | null = null
  updateAgentConversation(conversation.id, (current) => {
    const nextTitle = current.rounds.length === 0 ? createAgentConversationTitle(trimmedPrompt, current.title) : current.title
    if (current.rounds.length === 0) fallbackTitle = nextTitle
    const messages = shouldAppendToEditingRound
      ? current.messages.some((message) => message.id === userMessageId)
        ? current.messages.map((message) => {
            if (message.id === userMessageId) return userMessage
            if (editingRoundHasErrorAssistantMessage && message.id === editingRoundAssistantMessage?.id) {
              return { ...message, content: '', outputTaskIds: [] }
            }
            return message
          })
        : [...current.messages, userMessage]
      : [...current.messages, userMessage]

    return {
      ...current,
      title: nextTitle,
      activeRoundId: roundId,
      updatedAt: now,
      rounds: shouldAppendToEditingRound
        ? current.rounds.map((item) => item.id === roundId ? round : item)
        : [...current.rounds, round],
      messages,
    }
  })

  state.setPrompt('')
  state.clearInputImages()
  state.clearMaskDraft()
  state.setAgentEditingRoundId(null)

  if (fallbackTitle) {
    void generateAgentConversationTitle(conversation.id, trimmedPrompt, inputImageIds, requestSettings, activeProfile, fallbackTitle)
  }

  void executeAgentRound(conversation.id, roundId, normalizedParams, requestSettings, activeProfile)
}

export async function regenerateAgentAssistantMessage(conversationId: string, roundId: string) {
  const state = useStore.getState()
  const { settings, params, showToast } = state
  const normalizedSettings = normalizeSettings(settings)
  const activeProfile = getActiveApiProfile(normalizedSettings)

  if (activeProfile.provider !== 'openai' || activeProfile.apiMode !== 'responses') {
    state.setAppMode('agent')
    return
  }

  if (validateApiProfile(activeProfile)) {
    showToast(`请先完善请求 API 配置：${validateApiProfile(activeProfile)}`, 'error')
    state.setShowSettings(true)
    return
  }

  const conversation = state.agentConversations.find((item) => item.id === conversationId)
  const sourceRound = conversation?.rounds.find((item) => item.id === roundId) ?? null
  const sourceUserMessage = sourceRound
    ? conversation?.messages.find((message) => message.id === sourceRound.userMessageId) ?? null
    : null
  if (!conversation || !sourceRound || !sourceUserMessage) {
    showToast('找不到要重新生成的 Agent 消息', 'error')
    return
  }

  if (conversation.rounds.some((round) => round.status === 'running')) {
    showToast('请等待生成完成，或先停止生成', 'info')
    return
  }

  const inputImageIds = uniqueIds(sourceRound.inputImageIds)
  const requestSettings = createSettingsForApiProfile(normalizedSettings, activeProfile)
  const normalizedParams = {
    ...normalizeParamsForSettings(params, requestSettings, { hasInputImages: inputImageIds.length > 0 }),
    n: DEFAULT_PARAMS.n,
  }
  const now = Date.now()
  if (sourceRound.status === 'error') {
    const assistantMessageId = sourceRound.assistantMessageId
      ?? conversation.messages.find((message) => message.roundId === sourceRound.id && message.role === 'assistant')?.id
    updateAgentConversation(conversationId, (current) => ({
      ...current,
      activeRoundId: sourceRound.id,
      updatedAt: now,
      rounds: current.rounds.map((round) =>
        round.id === sourceRound.id
          ? {
              ...round,
              outputTaskIds: [],
              responseId: undefined,
              responseOutput: undefined,
              status: 'running',
              error: null,
              finishedAt: null,
            }
          : round,
      ),
      messages: assistantMessageId
        ? current.messages.map((message) =>
            message.id === assistantMessageId ? { ...message, content: '', outputTaskIds: [] } : message,
          )
        : current.messages,
    }))
    state.setAgentEditingRoundId(null)
    void executeAgentRound(conversationId, sourceRound.id, normalizedParams, requestSettings, activeProfile)
    return
  }

  const newRoundId = genId()
  const newUserMessageId = genId()
  const newRound: AgentRound = {
    id: newRoundId,
    index: sourceRound.index,
    parentRoundId: sourceRound.parentRoundId ?? null,
    userMessageId: newUserMessageId,
    prompt: sourceRound.prompt || sourceUserMessage.content.trim(),
    inputImageIds,
    maskTargetImageId: sourceRound.maskTargetImageId ?? sourceUserMessage.maskTargetImageId ?? null,
    maskImageId: sourceRound.maskImageId ?? sourceUserMessage.maskImageId ?? null,
    outputTaskIds: [],
    status: 'running',
    error: null,
    createdAt: now,
    finishedAt: null,
  }
  const newUserMessage: AgentMessage = {
    id: newUserMessageId,
    role: 'user',
    content: sourceUserMessage.content,
    roundId: newRoundId,
    inputImageIds,
    maskTargetImageId: sourceRound.maskTargetImageId ?? sourceUserMessage.maskTargetImageId ?? null,
    maskImageId: sourceRound.maskImageId ?? sourceUserMessage.maskImageId ?? null,
    createdAt: now,
  }

  updateAgentConversation(conversationId, (current) => ({
    ...current,
    activeRoundId: newRoundId,
    updatedAt: now,
    rounds: [...current.rounds, newRound],
    messages: [...current.messages, newUserMessage],
  }))
  state.setAgentEditingRoundId(null)
  void executeAgentRound(conversationId, newRoundId, normalizedParams, requestSettings, activeProfile)
}

async function executeAgentRound(
  conversationId: string,
  roundId: string,
  params: TaskParams,
  requestSettings: AppSettings,
  activeProfile: ApiProfile,
) {
  const startedAt = Date.now()
  const controller = new AbortController()
  const controllerKey = getAgentRoundControllerKey(conversationId, roundId)
  agentRoundControllers.set(controllerKey, controller)
  try {
    const latestState = useStore.getState()
    const conversation = latestState.agentConversations.find((item) => item.id === conversationId)
    if (!conversation) return
    const round = conversation.rounds.find((item) => item.id === roundId)
    const userMessage = round ? conversation.messages.find((message) => message.id === round.userMessageId) : null
    if (!round || !userMessage) return
    const maskDataUrl = round.maskImageId ? await ensureImageCached(round.maskImageId) : undefined
    if (round.maskImageId && !maskDataUrl) throw new Error('遮罩图片已不存在')

    const apiInput = await buildAgentApiInput(conversation, round, latestState.tasks)
    if (controller.signal.aborted) throw createAgentAbortError()
    const existingAssistantMessage = round.assistantMessageId
      ? conversation.messages.find((message) => message.id === round.assistantMessageId) ?? null
      : conversation.messages.find((message) => message.roundId === roundId && message.role === 'assistant') ?? null
    const assistantMessageId = existingAssistantMessage?.id ?? genId()
    const shouldStreamAssistantMessage = activeProfile.streamImages === true
    const streamingTaskIds: string[] = []
    const taskIdByToolCallId = new Map<string, string>()

    const attachTaskToAgentRound = (taskId: string) => {
      if (streamingTaskIds.includes(taskId)) return
      streamingTaskIds.push(taskId)
      updateAgentConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((item) =>
          item.id === roundId
            ? { ...item, outputTaskIds: item.outputTaskIds.includes(taskId) ? item.outputTaskIds : [...item.outputTaskIds, taskId] }
            : item,
        ),
        messages: current.messages.map((message) =>
          message.id === assistantMessageId
            ? { ...message, outputTaskIds: [...new Set([...(message.outputTaskIds ?? []), taskId])] }
            : message,
        ),
      }))
    }

    const ensureStreamingAgentTask = async (
      toolCallId: string,
      taskPrompt = '',
      inputImageIds = round.inputImageIds ?? [],
      options: { createdAt?: number; agentBatchCallId?: string; maskTargetImageId?: string | null; maskImageId?: string | null } = {},
    ) => {
      const existingTaskId = taskIdByToolCallId.get(toolCallId)
      if (existingTaskId) return existingTaskId

      const existingTask = useStore.getState().tasks.find((task) => task.agentToolCallId === toolCallId)
      if (existingTask) {
        taskIdByToolCallId.set(toolCallId, existingTask.id)
        attachTaskToAgentRound(existingTask.id)
        return existingTask.id
      }

      const task: TaskRecord = {
        id: genId(),
        prompt: taskPrompt,
        params: { ...params, n: 1 },
        apiProvider: activeProfile.provider,
        apiProfileId: activeProfile.id,
        apiProfileName: activeProfile.name,
        apiMode: activeProfile.apiMode,
        apiModel: activeProfile.model,
        inputImageIds,
        maskTargetImageId: options.maskTargetImageId !== undefined ? options.maskTargetImageId : round.maskTargetImageId ?? null,
        maskImageId: options.maskImageId !== undefined ? options.maskImageId : round.maskImageId ?? null,
        outputImages: [],
        status: 'running',
        error: null,
        createdAt: options.createdAt ?? Date.now(),
        finishedAt: null,
        elapsed: null,
        sourceMode: 'agent',
        agentConversationId: conversationId,
        agentRoundId: roundId,
        agentMessageId: assistantMessageId,
        agentToolCallId: toolCallId,
        ...(options.agentBatchCallId ? { agentBatchCallId: options.agentBatchCallId } : {}),
      }

      taskIdByToolCallId.set(toolCallId, task.id)
      useStore.getState().setTasks([task, ...useStore.getState().tasks])
      attachTaskToAgentRound(task.id)
      await putTask(task)
      return task.id
    }

    const completeAgentImageTask = async (image: AgentApiResultImage, rawResponsePayload?: string) => {
      const toolCallId = image.toolCallId ?? genId()
      const taskId = await ensureStreamingAgentTask(toolCallId)
      const latestTask = useStore.getState().tasks.find((task) => task.id === taskId)
      if (latestTask?.status === 'done' && latestTask.outputImages.length > 0) return taskId

      const imgId = await storeImage(image.dataUrl, 'generated')
      cacheImage(imgId, image.dataUrl)
      const actualParams: Partial<TaskParams> = {
        ...(Object.keys(image.actualParams ?? {}).length ? image.actualParams : {}),
        n: 1,
      }
      updateTaskInStore(taskId, {
        prompt: image.revisedPrompt ?? latestTask?.prompt ?? '',
        outputImages: [imgId],
        actualParams,
        actualParamsByImage: { [imgId]: actualParams },
        revisedPromptByImage: image.revisedPrompt ? { [imgId]: image.revisedPrompt } : undefined,
        rawResponsePayload,
        status: 'done',
        error: null,
        finishedAt: Date.now(),
        elapsed: Date.now() - (latestTask?.createdAt ?? startedAt),
        agentToolAction: image.action,
      })
      useStore.getState().setTaskStreamPreview(taskId)
      return taskId
    }

    if (shouldStreamAssistantMessage) {
      updateAgentConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((item) =>
          item.id === roundId ? { ...item, assistantMessageId } : item,
        ),
        messages: current.messages.some((message) => message.id === assistantMessageId)
          ? current.messages.map((message) => message.id === assistantMessageId ? { ...message, content: '', outputTaskIds: [] } : message)
          : [
              ...current.messages,
              {
                id: assistantMessageId,
                role: 'assistant',
                content: '',
                roundId,
                createdAt: Date.now(),
              },
            ],
      }))
    }
    const maxToolCalls = Number.isFinite(requestSettings.agentMaxToolRounds)
      ? Math.max(1, Math.trunc(requestSettings.agentMaxToolRounds))
      : DEFAULT_AGENT_MAX_TOOL_ROUNDS
    let apiInputForTurn = apiInput
    let accumulatedOutputItems: ResponsesOutputItem[] = []
    let accumulatedText = ''
    const textSegments: string[] = []
    let lastResponseId: string | undefined
    let toolCallsUsed = 0
    let reachedToolLimit = false
    let pendingToolTextSeparator = false

    // Helper: resolve reference image ids to data URLs for batch image calls
    const resolveReferenceImages = async (referenceIds: string[]): Promise<{ dataUrls: string[]; imageIds: string[] }> => {
      const dataUrls: string[] = []
      const imageIds: string[] = []
      for (const refId of referenceIds) {
        // Resolve both generated image refs and current/user input refs from XML tags.
        const latestConv = useStore.getState().agentConversations.find((item) => item.id === conversationId)
        if (!latestConv) continue
        for (const r of getAgentRoundPath(latestConv, roundId)) {
          for (let imgIdx = 0; imgIdx < r.inputImageIds.length; imgIdx++) {
            const currentRefId = getAgentCurrentReferenceId(r, imgIdx)
            if (currentRefId === refId) {
              const imageId = r.inputImageIds[imgIdx]
              const dataUrl = await ensureImageCached(imageId)
              if (dataUrl) dataUrls.push(dataUrl)
              imageIds.push(imageId)
            }
          }
          const outputImages = collectAgentRoundOutputImageSlots(r, useStore.getState().tasks)
          for (let imgIdx = 0; imgIdx < outputImages.length; imgIdx++) {
            const generatedRefId = getAgentGeneratedImageReferenceId(r, imgIdx)
            if (generatedRefId === refId) {
              const imageId = outputImages[imgIdx]
              if (!imageId) continue
              const dataUrl = await ensureImageCached(imageId)
              if (dataUrl) dataUrls.push(dataUrl)
              imageIds.push(imageId)
            }
          }
        }
      }
      return { dataUrls, imageIds }
    }

    // Helper: execute a generate_image_batch function call concurrently
    const executeBatchFunctionCall = async (functionCallItem: ResponsesOutputItem): Promise<string> => {
      const callId = functionCallItem.call_id ?? ''
      const args = functionCallItem.arguments ?? ''
      const batchItems = parseBatchImageCallArguments(args)

      if (!batchItems || batchItems.length === 0) {
        return JSON.stringify({ error: 'Invalid or empty batch arguments' })
      }

      // Create task cards in model-provided order before starting network calls.
      const batchExecutionItems = []
      for (const item of batchItems) {
        const referenceIds = uniqueIds(extractAgentReferenceIds(item.prompt))
        const references = await resolveReferenceImages(referenceIds)
        const batchToolCallId = genId()
        await ensureStreamingAgentTask(batchToolCallId, item.prompt, references.imageIds, {
          createdAt: Date.now(),
          maskTargetImageId: null,
          maskImageId: null,
          ...(callId ? { agentBatchCallId: callId } : {}),
        })
        batchExecutionItems.push({ item, batchToolCallId, references, referenceIds })
      }

      // Fire all batch items concurrently after all cards are visible.
      const batchPromises = batchExecutionItems.map(async ({ item, batchToolCallId, references, referenceIds }) => {

        const batchResult = await callBatchImageSingle({
          profile: activeProfile,
          params,
          batchItemId: item.id,
          prompt: item.prompt,
          referenceImageDataUrls: references.dataUrls,
          referenceIds,
          signal: controller.signal,
          onImageToolStarted: shouldStreamAssistantMessage
            ? async () => {
                if (controller.signal.aborted) return
              }
            : undefined,
          onPartialImage: shouldStreamAssistantMessage
            ? async ({ image, partialImageIndex }) => {
                if (controller.signal.aborted) return
                const taskId = taskIdByToolCallId.get(batchToolCallId)
                if (taskId) {
                  useStore.getState().setTaskStreamPreview(taskId, image, partialImageIndex)
                  if (partialImageIndex === 0 || partialImageIndex == null) {
                    void persistTaskStreamPartialImage(taskId, image)
                  }
                }
              }
            : undefined,
          onImageToolCompleted: shouldStreamAssistantMessage
            ? async (image) => {
                if (controller.signal.aborted) return
                await completeAgentImageTask({ ...image, toolCallId: batchToolCallId })
              }
            : undefined,
        })

        // If not streaming and we have an image, complete the pre-created task.
        if (batchResult.image && !shouldStreamAssistantMessage) {
          await completeAgentImageTask({ ...batchResult.image, toolCallId: batchToolCallId }, batchResult.rawResponsePayload)
        }

        return batchResult
      })

      const batchResults = await Promise.allSettled(batchPromises)

      // Build function_call_output
      const outputImages: Array<{ id: string; status: string; error?: string }> = []
      for (let i = 0; i < batchItems.length; i++) {
        const settled = batchResults[i]
        const batchItem = batchItems[i]
        if (settled.status === 'fulfilled') {
          const r = settled.value
          outputImages.push({
            id: r.batchItemId,
            status: r.image ? 'done' : 'error',
            ...(r.error ? { error: r.error } : {}),
          })
        } else {
          outputImages.push({
            id: batchItem.id,
            status: 'error',
            error: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
          })
        }
      }

      const successCount = outputImages.filter((img) => img.status === 'done').length
      toolCallsUsed += successCount

      return JSON.stringify({ images: outputImages })
    }

    while (true) {
      if (controller.signal.aborted) throw createAgentAbortError()
      const textBeforeResponse = accumulatedText
      let currentResponseOutputItems: ResponsesOutputItem[] = []
      const result = await callAgentResponsesApi({
        settings: requestSettings,
        profile: activeProfile,
        params,
        input: apiInputForTurn,
        maskDataUrl,
        signal: controller.signal,
        onTextDelta: shouldStreamAssistantMessage
          ? (delta) => {
              if (controller.signal.aborted) return
              if (pendingToolTextSeparator && delta && accumulatedText.trim()) {
                accumulatedText += '\n\n'
                appendAgentAssistantMessageContent(conversationId, assistantMessageId, '\n\n')
              }
              pendingToolTextSeparator = false
              accumulatedText += delta
              appendAgentAssistantMessageContent(conversationId, assistantMessageId, delta)
            }
          : undefined,
        onOutputItems: shouldStreamAssistantMessage
          ? (outputItems) => {
              if (controller.signal.aborted) return
              currentResponseOutputItems = outputItems
              updateAgentConversation(conversationId, (current) => ({
                ...current,
                rounds: current.rounds.map((item) => item.id === roundId ? { ...item, responseOutput: mergeResponseOutputItems(accumulatedOutputItems, outputItems) } : item),
              }))
            }
          : undefined,
        onImageToolStarted: shouldStreamAssistantMessage
          ? async ({ toolCallId }) => {
              if (controller.signal.aborted) return
              await ensureStreamingAgentTask(toolCallId)
            }
          : undefined,
        onImagePartialImage: shouldStreamAssistantMessage
          ? async ({ toolCallId, image, partialImageIndex }) => {
              if (controller.signal.aborted) return
              const taskId = await ensureStreamingAgentTask(toolCallId)
              if (controller.signal.aborted) return
              useStore.getState().setTaskStreamPreview(taskId, image, partialImageIndex)
              if (partialImageIndex === 0 || partialImageIndex == null) {
                void persistTaskStreamPartialImage(taskId, image)
              }
            }
          : undefined,
        onImageToolCompleted: shouldStreamAssistantMessage
          ? async (image) => {
              if (controller.signal.aborted) return
              await completeAgentImageTask(image)
            }
          : undefined,
      })
      if (controller.signal.aborted) throw createAgentAbortError()

      lastResponseId = result.responseId ?? lastResponseId
      currentResponseOutputItems = currentResponseOutputItems.length ? currentResponseOutputItems : result.outputItems ?? []
      accumulatedOutputItems = mergeResponseOutputItems(accumulatedOutputItems, currentResponseOutputItems)

      const responseText = result.text.trim()
      if (responseText && accumulatedText === textBeforeResponse) {
        const textToAppend = accumulatedText ? `\n\n${responseText}` : responseText
        accumulatedText += textToAppend
        if (shouldStreamAssistantMessage) appendAgentAssistantMessageContent(conversationId, assistantMessageId, textToAppend)
      }
      const newTextInThisResponse = accumulatedText.slice(textBeforeResponse.length).trim()
      if (newTextInThisResponse) textSegments.push(newTextInThisResponse)

      // Process built-in image_generation_call results (single images)
      for (const image of result.images) {
        if (image.toolCallId && taskIdByToolCallId.has(image.toolCallId)) {
          const completedTaskId = await completeAgentImageTask(image, result.rawResponsePayload)
          const promptRefIds = uniqueIds(extractAgentReferenceIds(image.revisedPrompt ?? ''))
          if (promptRefIds.length > 0) {
            const promptRefs = await resolveReferenceImages(promptRefIds)
            if (promptRefs.imageIds.length > 0) {
              const latestTask = useStore.getState().tasks.find((t) => t.id === completedTaskId)
              if (latestTask) {
                const mergedInputIds = uniqueIds([...latestTask.inputImageIds, ...promptRefs.imageIds])
                if (mergedInputIds.length !== latestTask.inputImageIds.length) {
                  updateTaskInStore(completedTaskId, { inputImageIds: mergedInputIds })
                }
              }
            }
          }
          continue
        }
        const promptRefIds = uniqueIds(extractAgentReferenceIds(image.revisedPrompt ?? ''))
        const promptRefs = await resolveReferenceImages(promptRefIds)
        const imgId = await storeImage(image.dataUrl, 'generated')
        cacheImage(imgId, image.dataUrl)
        const actualParams: Partial<TaskParams> = {
          ...(Object.keys(image.actualParams ?? {}).length ? image.actualParams : {}),
          n: 1,
        }
        const task: TaskRecord = {
          id: genId(),
          prompt: image.revisedPrompt ?? round?.prompt ?? userMessage.content,
          params,
          apiProvider: activeProfile.provider,
          apiProfileId: activeProfile.id,
          apiProfileName: activeProfile.name,
          apiMode: activeProfile.apiMode,
          apiModel: activeProfile.model,
          inputImageIds: uniqueIds([...(round?.inputImageIds ?? []), ...promptRefs.imageIds]),
          maskTargetImageId: round?.maskTargetImageId ?? null,
          maskImageId: round?.maskImageId ?? null,
          outputImages: [imgId],
          actualParams,
          actualParamsByImage: { [imgId]: actualParams },
          revisedPromptByImage: image.revisedPrompt ? { [imgId]: image.revisedPrompt } : undefined,
          rawResponsePayload: result.rawResponsePayload,
          status: 'done',
          error: null,
          createdAt: startedAt,
          finishedAt: Date.now(),
          elapsed: Date.now() - startedAt,
          sourceMode: 'agent',
          agentConversationId: conversationId,
          agentRoundId: roundId,
          agentMessageId: assistantMessageId,
          agentToolCallId: image.toolCallId,
          agentToolAction: image.action,
        }
        useStore.getState().setTasks([task, ...useStore.getState().tasks])
        attachTaskToAgentRound(task.id)
        await putTask(task)
      }

      if (result.rawResponsePayload && streamingTaskIds.length > 0) {
        for (const taskId of streamingTaskIds) {
          const latestTask = useStore.getState().tasks.find((task) => task.id === taskId)
          if (latestTask && !latestTask.rawResponsePayload) updateTaskInStore(taskId, { rawResponsePayload: result.rawResponsePayload })
        }
      }

      // Check for function calls that require continuation
      const batchFunctionCalls = currentResponseOutputItems.filter(
        (item) => item.type === 'function_call' && item.name === 'generate_image_batch',
      )
      const continueFunctionCalls = currentResponseOutputItems.filter(
        (item) => item.type === 'function_call' && item.name === 'continue_generation',
      )

      // Count built-in tool calls (image_generation, web_search) for budget tracking
      const responseToolCalls = countResponseToolCalls(currentResponseOutputItems)
      toolCallsUsed += responseToolCalls

      // Collect function_call_output items for all function calls that need responses
      const functionCallOutputs: ResponsesOutputItem[] = []

      if (batchFunctionCalls.length > 0) {
        for (const fc of batchFunctionCalls) {
          const output = await executeBatchFunctionCall(fc)
          functionCallOutputs.push({
            type: 'function_call_output',
            call_id: fc.call_id,
            output,
          })
        }
      }

      for (const fc of continueFunctionCalls) {
        functionCallOutputs.push({
          type: 'function_call_output',
          call_id: fc.call_id,
          output: JSON.stringify({ status: 'continued' }),
        })
      }

      // If no function calls need output → model decided the task is done → break
      if (functionCallOutputs.length === 0) {
        updateAgentConversation(conversationId, (current) => ({
          ...current,
          updatedAt: Date.now(),
          rounds: current.rounds.map((item) => item.id === roundId ? { ...item, responseId: lastResponseId, responseOutput: accumulatedOutputItems } : item),
        }))
        break
      }

      const accumulatedOutputItemsWithFunctionOutputs = mergeResponseOutputItems(accumulatedOutputItems, functionCallOutputs)

      updateAgentConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((item) => item.id === roundId ? { ...item, responseId: lastResponseId, responseOutput: accumulatedOutputItemsWithFunctionOutputs } : item),
      }))

      if (toolCallsUsed >= maxToolCalls) {
        reachedToolLimit = true
        break
      }

      // Build continuation input with function call outputs and available refs
      const latestConversation = useStore.getState().agentConversations.find((item) => item.id === conversationId)
      const latestRound = latestConversation?.rounds.find((item) => item.id === roundId)
      if (!latestRound) break

      const continuationBase = buildAgentContinuationInput(
        apiInput,
        latestRound,
        useStore.getState().tasks,
        accumulatedOutputItems,
        toolCallsUsed,
        maxToolCalls,
      )
      // Insert function_call_output items before the continuation system message
      continuationBase.splice(continuationBase.length - 1, 0, ...functionCallOutputs)
      // Inject batch-generated images as input_image user message for model visibility
      const batchImagesItem = await createAgentBatchImagesInputItem(latestRound, useStore.getState().tasks, streamingTaskIds)
      if (batchImagesItem) continuationBase.splice(continuationBase.length - 1, 0, batchImagesItem)
      apiInputForTurn = continuationBase
      accumulatedOutputItems = accumulatedOutputItemsWithFunctionOutputs
      pendingToolTextSeparator = true
    }

    const taskIds: string[] = [...streamingTaskIds]
    const outputIds = taskIds.flatMap((taskId) => useStore.getState().tasks.find((task) => task.id === taskId)?.outputImages ?? [])
    const limitNotice = reachedToolLimit ? `已达到最大工具调用次数（${maxToolCalls}），已停止自动续跑。` : ''
    const joinedText = textSegments.join('\n\n').trim()
    const finalContent = [joinedText, limitNotice]
      .filter(Boolean)
      .join(joinedText ? '\n\n' : '')
      || (taskIds.length > 0 || outputIds.length > 0 ? '图像已生成。' : '')

    const assistantMessage: AgentMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: finalContent,
      roundId,
      outputTaskIds: taskIds,
      createdAt: Date.now(),
    }

    updateAgentConversation(conversationId, (current) => ({
      ...current,
      updatedAt: Date.now(),
      rounds: current.rounds.map((round) =>
        round.id === roundId
          ? {
              ...round,
              assistantMessageId,
              outputTaskIds: taskIds,
              responseId: lastResponseId,
              responseOutput: accumulatedOutputItems,
              status: 'done',
              error: null,
              finishedAt: Date.now(),
            }
          : round,
      ),
      messages: current.messages.some((message) => message.id === assistantMessageId)
        ? current.messages.map((message) => message.id === assistantMessageId ? assistantMessage : message)
        : [...current.messages, assistantMessage],
    }))

    useStore.getState().showToast(outputIds.length > 0 ? 'Agent 已生成图片' : 'Agent 已回复', 'success')
  } catch (err) {
    if (controller.signal.aborted) {
      if (markAgentRoundStopped(conversationId, roundId)) {
        useStore.getState().showToast('已停止生成', 'info')
      }
      return
    }

    let message = err instanceof Error ? err.message : String(err)
    const usesApiProxy = activeProfile.apiProxy ?? requestSettings.apiProxy
    const networkErrorHint = getApiRequestNetworkErrorHint(err, startedAt, usesApiProxy, activeProfile)
    if (networkErrorHint && !message.includes(IMAGE_FETCH_CORS_HINT)) {
      message += `\n${networkErrorHint}`
    }
    const responseStatusHint = getApiResponseStatusHint(err, usesApiProxy, activeProfile)
    if (responseStatusHint && !message.includes(responseStatusHint)) {
      message += `\n${responseStatusHint}`
    }

    updateAgentConversation(conversationId, (current) => {
      const failedRound = current.rounds.find((round) => round.id === roundId)
      const existingAssistantMessage = failedRound?.assistantMessageId
        ? current.messages.find((item) => item.id === failedRound.assistantMessageId)
        : current.messages.find((item) => item.roundId === roundId && item.role === 'assistant')
      const errorContent = `请求失败：${message}`

      return {
        ...current,
        title: current.rounds.length === 1 && current.rounds[0].id === roundId ? '新对话' : current.title,
        updatedAt: Date.now(),
        rounds: current.rounds.map((round) =>
          round.id === roundId
            ? {
                ...round,
                ...(existingAssistantMessage ? { assistantMessageId: existingAssistantMessage.id } : {}),
                status: 'error',
                error: message,
                finishedAt: Date.now(),
              }
            : round,
        ),
        messages: existingAssistantMessage
          ? current.messages.map((item) => item.id === existingAssistantMessage.id ? { ...item, content: errorContent } : item)
          : [
              ...current.messages,
              {
                id: genId(),
                role: 'assistant',
                content: errorContent,
                roundId,
                createdAt: Date.now(),
              },
            ],
      }
    })
    useStore.getState().showToast(`Agent 请求失败：${message}`, 'error')
  } finally {
    if (agentRoundControllers.get(controllerKey) === controller) {
      agentRoundControllers.delete(controllerKey)
    }
  }
}
