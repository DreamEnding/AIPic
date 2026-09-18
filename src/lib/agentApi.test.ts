import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile, DEFAULT_SETTINGS } from './apiProfiles'
import { callAgentConversationTitleApi, callAgentResponsesApi, callBatchImageSingle } from './agentApi'
import { getImageRequestTimeoutSeconds } from './imageRequestTimeout'

describe('callAgentResponsesApi', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('streams Agent text and requests configured partial images', async () => {
    const streamBody = [
      'data: {"type":"response.output_text.delta","delta":"Hel"}',
      '',
      'data: {"type":"response.output_text.delta","delta":"lo"}',
      '',
      'data: {"type":"response.completed","response":{"id":"resp_1","output":[{"type":"message","content":[{"type":"output_text","text":"Hello"}]},{"type":"image_generation_call","id":"ig_1","result":"ZmluYWw=","size":"1024x1024"}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const textDeltas: string[] = []
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
      streamPartialImages: 2,
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
      onTextDelta: (delta) => textDeltas.push(delta),
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.stream).toBe(true)
    expect(body.tools[0].partial_images).toBe(2)
    expect(textDeltas).toEqual(['Hel', 'lo'])
    expect(result).toMatchObject({
      responseId: 'resp_1',
      text: 'Hello',
      images: [{ toolCallId: 'ig_1', dataUrl: 'data:image/png;base64,ZmluYWw=' }],
    })
  })

  it('passes mask data to the Agent image tool', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'OK' }],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'edit' }] }],
      maskDataUrl: 'data:image/png;base64,bWFzaw==',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.tools[0].input_image_mask).toEqual({ image_url: 'data:image/png;base64,bWFzaw==' })
  })

  it('extracts image_generation results from base64 object fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'image_generation_call',
        id: 'ig_base64',
        result: { base64: 'ZmlsZQ==' },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    expect(result.images).toEqual([{
      toolCallId: 'ig_base64',
      dataUrl: 'data:image/png;base64,ZmlsZQ==',
      actualParams: {},
    }])
  })

  it('stops reading a stream when the caller aborts after output starts', async () => {
    const streamBody = [
      'data: {"type":"response.output_text.delta","delta":"Hel"}',
      '',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(streamBody))
        controller.close()
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const textDeltas: string[] = []
    const abortController = new AbortController()
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
    })

    await expect(callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
      signal: abortController.signal,
      onTextDelta: (delta) => {
        textDeltas.push(delta)
        abortController.abort()
      },
    })).rejects.toMatchObject({ name: 'AbortError' })

    expect(textDeltas).toEqual(['Hel'])
  })

  it('finishes on response.completed even when the upstream connection stays open', async () => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
          type: 'response.completed',
          response: {
            id: 'resp_complete',
            output: [{ type: 'image_generation_call', id: 'ig_complete', result: 'ZmluYWw=' }],
          },
        })}\n\n`))
      },
      cancel,
    }), { headers: { 'Content-Type': 'text/event-stream' } })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile: createDefaultOpenAIProfile({ apiKey: 'test-key', streamImages: true }),
      params: DEFAULT_PARAMS,
      input: 'prompt',
    })

    expect(result.images).toHaveLength(1)
    expect(result.responseId).toBe('resp_complete')
    expect(cancel).toHaveBeenCalledOnce()
    expect(response.body?.locked).toBe(false)
  })

  it('preserves every completed image until DONE without using response.created as the final payload', async () => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({
      start(controller) {
        const events = [
          { type: 'response.created', response: { id: 'resp_multi', output: [] } },
          { type: 'response.output_item.done', item: { type: 'image_generation_call', id: 'ig_1', result: 'b25l' } },
          { type: 'response.output_item.done', item: { type: 'image_generation_call', id: 'ig_2', result: 'dHdv' } },
        ]
        controller.enqueue(new TextEncoder().encode(`${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`))
      },
      cancel,
    }), { headers: { 'Content-Type': 'text/event-stream' } })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
    const onImageToolCompleted = vi.fn()

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile: createDefaultOpenAIProfile({ apiKey: 'test-key', streamImages: true }),
      params: DEFAULT_PARAMS,
      input: 'prompt',
      onImageToolCompleted,
    })

    expect(result.images.map((image) => image.toolCallId)).toEqual(['ig_1', 'ig_2'])
    expect(onImageToolCompleted).toHaveBeenCalledTimes(2)
    expect(cancel).toHaveBeenCalledOnce()
    expect(response.body?.locked).toBe(false)
  })

  it('keeps the deadline active after headers and streamed text arrive', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"Working"}\n\n'))
      },
      cancel,
    }), { headers: { 'Content-Type': 'text/event-stream' } }))
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', streamImages: true, timeout: 1 })
    const timeoutSeconds = getImageRequestTimeoutSeconds(profile, DEFAULT_PARAMS)
    const onTextDelta = vi.fn()
    const result = callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: 'prompt',
      onTextDelta,
    })
    const assertion = expect(result).rejects.toThrow(`请求超时：超过 ${timeoutSeconds} 秒仍未完成`)

    await vi.advanceTimersByTimeAsync(0)
    expect(onTextDelta).toHaveBeenCalledWith('Working')
    await vi.advanceTimersByTimeAsync(timeoutSeconds * 1000)
    await assertion
    expect(cancel).toHaveBeenCalledOnce()
    expect(globalThis.fetch).toHaveBeenCalledOnce()
  })

  it('rejects promptly when the caller aborts during a stalled JSON body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"output":['))
      },
    }), { headers: { 'Content-Type': 'application/json' } }))
    const controller = new AbortController()
    const result = callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile: createDefaultOpenAIProfile({ apiKey: 'test-key' }),
      params: DEFAULT_PARAMS,
      input: 'prompt',
      signal: controller.signal,
    })
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' })

    await Promise.resolve()
    await Promise.resolve()
    controller.abort()
    await assertion
    expect(globalThis.fetch).toHaveBeenCalledOnce()
  })

  it('reports a batch deadline as a timeout rather than caller cancellation', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({ cancel }), {
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', streamImages: true, timeout: 1 })
    const timeoutSeconds = getImageRequestTimeoutSeconds(profile, DEFAULT_PARAMS)
    const result = callBatchImageSingle({
      profile,
      params: DEFAULT_PARAMS,
      batchItemId: 'batch_timeout',
      prompt: 'prompt',
      referenceImageDataUrls: [],
    })

    await vi.advanceTimersByTimeAsync(timeoutSeconds * 1000)
    expect(await result).toMatchObject({
      batchItemId: 'batch_timeout',
      image: null,
      error: `请求超时：超过 ${timeoutSeconds} 秒仍未完成。上游可能仍在生成，请确认结果后再重试。`,
    })
    expect(cancel).toHaveBeenCalledOnce()
    expect(globalThis.fetch).toHaveBeenCalledOnce()
  })

  it('still identifies explicit batch cancellation during a stalled body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream(), {
      headers: { 'Content-Type': 'application/json' },
    }))
    const controller = new AbortController()
    const result = callBatchImageSingle({
      profile: createDefaultOpenAIProfile({ apiKey: 'test-key' }),
      params: DEFAULT_PARAMS,
      batchItemId: 'batch_cancel',
      prompt: 'prompt',
      referenceImageDataUrls: [],
      signal: controller.signal,
    })

    await Promise.resolve()
    await Promise.resolve()
    controller.abort()
    expect(await result).toMatchObject({ image: null, error: '请求已取消' })
    expect(globalThis.fetch).toHaveBeenCalledOnce()
  })

  it('generates a short conversation title without image tools', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: '<title>生成猫咪头像</title>' }],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
    })

    const title = await callAgentConversationTitleApi({
      settings: DEFAULT_SETTINGS,
      profile,
      prompt: '帮我生成一张橘猫头像，要赛博朋克风格',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.instructions).toContain('<title>short title</title>')
    expect(body.tools).toBeUndefined()
    expect(body.stream).toBeUndefined()
    expect(body.input[0].content[0].text).toContain('帮我生成一张橘猫头像，要赛博朋克风格')
    expect(title).toBe('生成猫咪头像')
  })

  it('requests web search and applies citations', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'resp_search',
      output: [
        {
          type: 'web_search_call',
          id: 'ws_1',
          status: 'completed',
          action: { type: 'search', query: 'OpenAI web search docs' },
        },
        {
          type: 'message',
          content: [{
            type: 'output_text',
            text: 'See OpenAI docs.',
            annotations: [{
              type: 'url_citation',
              start_index: 4,
              end_index: 15,
              url: 'https://platform.openai.com/docs',
              title: 'OpenAI Docs',
            }],
          }],
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    const result = await callAgentResponsesApi({
      settings: { ...DEFAULT_SETTINGS, agentWebSearch: true },
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.tools).toEqual(expect.arrayContaining([{ type: 'web_search' }]))
    expect(result.text).toBe('See [OpenAI docs](https://platform.openai.com/docs).')
    expect(result.outputItems?.[0]).toMatchObject({ type: 'web_search_call', status: 'completed' })
  })
})
