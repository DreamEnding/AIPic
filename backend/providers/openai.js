// Adapted from FlyReq Image Studio; AGPL-3.0-only. See ../LICENSE.
function createOpenaiAdapter({ validateEnumValue, GPT_IMAGE_QUALITIES, GPT_IMAGE_STYLES, GPT_IMAGE_BACKGROUNDS, GPT_IMAGE_OUTPUT_FORMATS, DEFAULT_GPT_IMAGE_ADVANCED_PARAMS, readImageEventStream, formatImageUpstreamError, resolveFlyreqApiBaseUrl, appendProtocolApiPath, getImageUpstreamLogOptions, logImageRequestUrl, logImageUpstreamRequest, fetchWithTimeout, logImageUpstreamResponse }) {
function normalizeGptImageAdvancedParams(params = {}) {
  const quality = validateEnumValue(params.gptImageQuality, GPT_IMAGE_QUALITIES, 'quality');
  const style = validateEnumValue(params.gptImageStyle, GPT_IMAGE_STYLES, 'style');
  const background = validateEnumValue(params.gptImageBackground, GPT_IMAGE_BACKGROUNDS, 'background');
  const outputFormat = validateEnumValue(params.gptImageOutputFormat, GPT_IMAGE_OUTPUT_FORMATS, 'output_format');

  return {
    quality: quality || DEFAULT_GPT_IMAGE_ADVANCED_PARAMS.quality,
    style: style || DEFAULT_GPT_IMAGE_ADVANCED_PARAMS.style,
    background: background || DEFAULT_GPT_IMAGE_ADVANCED_PARAMS.background,
    outputFormat: outputFormat || DEFAULT_GPT_IMAGE_ADVANCED_PARAMS.outputFormat,
  };
}

function getGptImageRequestAdvancedParams(request) {
  return normalizeGptImageAdvancedParams(request);
}

/**
 * 获取上游私有协议使用的显式图片比例。
 * @param {unknown} value FlyReq 请求中的比例值。
 * @returns {string | undefined} 非自动比例；自动比例不发送该扩展字段。
 */
function getExplicitImageAspectRatio(value) {
  const aspectRatio = String(value || '').trim();
  return aspectRatio && aspectRatio !== 'auto' ? aspectRatio : undefined;
}

function createGptImageRequestInit(apiKey, request, resolvedSize, options = {}) {
  const prompt = request.prompt;
  const advancedParams = getGptImageRequestAdvancedParams(request);
  const stream = Boolean(options.stream);
  const aspectRatio = getExplicitImageAspectRatio(request.aspectRatio);
  const extraParams = {
    ...(request.gptImageOutputCompression !== undefined ? { output_compression: request.gptImageOutputCompression } : {}),
    ...(request.gptImageModeration ? { moderation: request.gptImageModeration } : {}),
    ...(request.responseFormat ? { response_format: request.responseFormat } : {}),
    ...(stream && request.streamPartialImages !== undefined ? { partial_images: request.streamPartialImages } : {}),
  };

  if (request.mode === 'image-to-image') {
    const formData = new FormData();
    formData.append('model', request.model);
    formData.append('prompt', prompt);
    formData.append('n', '1');
    if (stream) {
      formData.append('stream', 'true');
    }
    if (advancedParams) {
      formData.append('quality', advancedParams.quality);
      formData.append('background', advancedParams.background);
      formData.append('output_format', advancedParams.outputFormat);
      if (advancedParams.style === 'vivid' || advancedParams.style === 'natural') {
        formData.append('style', advancedParams.style);
      }
    }
    if (resolvedSize) {
      formData.append('size', resolvedSize);
    }
    if (aspectRatio) {
      formData.append('aspect_ratio', aspectRatio);
    }

    for (const [name, value] of Object.entries(extraParams)) formData.append(name, String(value));
    if (request.mask?.data) {
      const mimeType = request.mask.mimeType || 'image/png';
      const bytes = Buffer.from(request.mask.data, 'base64');
      formData.append('mask', new Blob([bytes], { type: mimeType }), `mask.${mimeType.split('/')[1] || 'png'}`);
    }

    request.images.forEach((img, index) => {
      const mimeType = img.mimeType || 'image/png';
      const extension = mimeType.split('/')[1] || 'png';
      const bytes = Buffer.from(img.data, 'base64');
      const blob = new Blob([bytes], { type: mimeType });
      // 沿用 AIPic 已验证的 multipart 数组字段，避免中转服务按单文件协议解析参考图。
      formData.append('image[]', blob, `input-${index + 1}.${extension}`);
    });

    return {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...(stream ? { 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' } : {}),
      },
      body: formData,
    };
  }

  const payload = {
    prompt,
    model: request.model,
    n: 1,
    ...extraParams,
    ...(stream ? { stream: true } : {}),
    ...(resolvedSize ? { size: resolvedSize } : {}),
    ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
    ...(advancedParams ? {
      quality: advancedParams.quality,
      background: advancedParams.background,
      output_format: advancedParams.outputFormat,
      ...(advancedParams.style === 'vivid' || advancedParams.style === 'natural' ? { style: advancedParams.style } : {}),
    } : {}),
    ...(request.images.length > 0 ? { image: request.images.map(img => `data:${img.mimeType};base64,${img.data}`) } : {}),
  };

  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...(stream ? { 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' } : {}),
    },
    body: JSON.stringify(payload),
  };
}

function parseJsonSafely(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isLikelyHtmlResponse(text) {
  const trimmed = String(text || '').trim().toLowerCase();
  return trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html') || trimmed.startsWith('<head') || trimmed.startsWith('<body');
}

function getMessageFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim();

  const error = payload.error;
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error && typeof error === 'object') {
    if (typeof error.message === 'string' && error.message.trim()) return error.message.trim();
    if (typeof error.code === 'string' && error.code.trim()) return error.code.trim();
  }

  return '';
}

function getErrorMessageFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (payload.error) return getMessageFromPayload(payload);

  const type = typeof payload.type === 'string' ? payload.type.toLowerCase() : '';
  if (type === 'error' || type === 'upstream_error') return getMessageFromPayload(payload);

  return '';
}

function normalizeImagePayloadValue(imageData) {
  if (!imageData || typeof imageData !== 'string') return undefined;
  if (imageData.startsWith('data:image')) return imageData.split(',')[1] || imageData;
  if (/^https?:\/\//i.test(imageData)) return `URL:${imageData}`;
  return imageData;
}

function getImagePayloadValue(data, depth = 0) {
  if (!data || depth > 3) return undefined;
  if (Array.isArray(data)) {
    for (const item of data) {
      const value = getImagePayloadValue(item, depth + 1);
      if (value) return value;
    }
    return undefined;
  }
  if (typeof data !== 'object') return undefined;

  const firstImage = Array.isArray(data.data)
    ? data.data.find(item => item && typeof item === 'object' && (item.b64_json || item.url || item.image_url))
    : undefined;
  const imageData = firstImage?.b64_json || firstImage?.url || firstImage?.image_url
    || data.b64_json || data.url || data.image_url;
  if (imageData) return imageData;

  return getImagePayloadValue(data.result, depth + 1)
    || getImagePayloadValue(data.response, depth + 1)
    || getImagePayloadValue(data.output, depth + 1);
}

function extractImagePayload(data) {
  const imageData = normalizeImagePayloadValue(getImagePayloadValue(data));
  if (!imageData) throw new Error('响应中无图片数据');
  return imageData;
}

function isImageEventStreamResponse(response) {
  return String(response.headers.get('content-type') || '').toLowerCase().includes('text/event-stream');
}

function notifyImageSseResponse(options) {
  if (typeof options?.onSseConfirmed !== 'function') return;
  try {
    options.onSseConfirmed();
  } catch (error) {
    console.warn('[image-stream] 记录 SSE 状态失败:', error?.message || error);
  }
}

/** 解析单次图片响应：SSE 逐块消费，JSON 只读取一次，网关错误不回显 HTML。 */
async function parseGptImageResponse(response, options = {}) {
  if (response.ok && isImageEventStreamResponse(response)) {
    try {
      return await readImageEventStream(response, {
        extractImage: extractImagePayload,
        getErrorMessage: getErrorMessageFromPayload,
        onComplete: options.onStreamComplete,
      });
    } catch (error) {
      const detail = formatImageUpstreamError(undefined, String(error?.message || '流式连接中断'), options);
      throw new Error(`上游流式响应未完成：${detail}`, { cause: error });
    }
  }
  const responseText = await response.text();
  options.onBody?.(responseText);
  if (!response.ok || isLikelyHtmlResponse(responseText)) {
    throw new Error(formatImageUpstreamError(response, responseText, options));
  }
  const data = parseJsonSafely(responseText);
  if (!data || getErrorMessageFromPayload(data)) {
    throw new Error(formatImageUpstreamError(response, responseText, options));
  }
  return extractImagePayload(data);
}

async function requestGptImage(apiKey, request, resolvedSize, options = {}) {
  const baseUrl = options.baseUrl || resolveFlyreqApiBaseUrl();
  const endpoint = request.mode === 'image-to-image'
    ? '/v1/images/edits'
    : '/v1/images/generations';
  const stream = Boolean(options.stream);
  const url = appendProtocolApiPath('openai', baseUrl, endpoint);
  const imageLogOptions = getImageUpstreamLogOptions();
  const requestInit = createGptImageRequestInit(apiKey, request, resolvedSize, { ...options, stream });
  const logContext = {
    taskId: options.taskId,
    imageIndex: options.imageIndex,
    protocol: 'openai',
    model: request.model,
    mode: request.mode,
    outputSize: request.outputSize,
    aspectRatio: request.aspectRatio,
    resolvedSize: resolvedSize || 'auto',
    streamRequested: stream,
  };
  logImageRequestUrl('openai', request.model, url, { size: resolvedSize || 'auto' });
  logImageUpstreamRequest('generate', url, requestInit, logContext, imageLogOptions);
  const startedAt = Date.now();
  const response = await fetchWithTimeout(url, { ...requestInit, signal: options.signal });
  const usesSse = response.ok && isImageEventStreamResponse(response);
  if (usesSse) notifyImageSseResponse(options);
  logImageUpstreamResponse('headers', url, response, undefined, {
    ...logContext, usesSse, headersMs: Date.now() - startedAt,
  }, { ...imageLogOptions, isError: !response.ok });
  try {
    return {
      image: await parseGptImageResponse(response, {
        streamRequested: stream,
        apiKey,
        onBody: (text) => logImageUpstreamResponse('generate', url, response, text, logContext, {
          ...imageLogOptions, isError: !response.ok,
        }),
        onStreamComplete: (summary) => logImageUpstreamResponse('stream', url, response, JSON.stringify(summary), logContext, {
          ...imageLogOptions, isError: !summary.completed,
        }),
      }),
      usesSse,
    };
  } catch (error) {
    if (resolvedSize && error instanceof Error) {
      error.message = `${error.message}（FlyReq 实际发送尺寸：${resolvedSize}）`;
    }
    if (usesSse && error && typeof error === 'object') {
      error.usesSse = true;
    }
    throw error;
  }
}
return { normalizeGptImageAdvancedParams, getGptImageRequestAdvancedParams, getExplicitImageAspectRatio, createGptImageRequestInit, parseJsonSafely, isLikelyHtmlResponse, getMessageFromPayload, getErrorMessageFromPayload, normalizeImagePayloadValue, getImagePayloadValue, extractImagePayload, isImageEventStreamResponse, notifyImageSseResponse, parseGptImageResponse, requestGptImage };
}
module.exports = { createOpenaiAdapter };
