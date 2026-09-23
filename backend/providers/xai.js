// Adapted from FlyReq Image Studio; AGPL-3.0-only. See ../LICENSE.
function createXaiAdapter({ getXaiImagineEndpoint, appendProtocolApiPath, getImageUpstreamLogOptions, logImageRequestUrl, XAI_IMAGINE_MAX_RETRIES, waitForXaiImagineRequestSlot, createXaiImagineRequestInit, logImageUpstreamRequest, fetchWithTimeout, logImageUpstreamResponse, isImageEventStreamResponse, notifyImageSseResponse, parseGptImageResponse, getRetryAfterDelayMs, delay }) {
async function requestXaiImagineImage(apiKey, request, options = {}) {
  const baseUrl = options.baseUrl || 'https://api.x.ai';
  const endpoint = getXaiImagineEndpoint(request.mode);
  const url = appendProtocolApiPath('openai', baseUrl, endpoint);
  const imageLogOptions = getImageUpstreamLogOptions();
  const logContext = {
    taskId: options.taskId,
    imageIndex: options.imageIndex,
    protocol: 'xai-imagine',
    model: request.model,
    mode: request.mode,
    outputSize: request.outputSize,
    aspectRatio: request.aspectRatio,
  };
  logImageRequestUrl('xai-imagine', request.model, url);

  for (let attempt = 0; attempt <= XAI_IMAGINE_MAX_RETRIES; attempt++) {
    await waitForXaiImagineRequestSlot(apiKey);
    const requestInit = createXaiImagineRequestInit(apiKey, request);
    const attemptContext = { ...logContext, attempt: attempt + 1 };
    logImageUpstreamRequest('generate', url, requestInit, attemptContext, imageLogOptions);
    const response = await fetchWithTimeout(url, { ...requestInit, signal: options.signal });
    logImageUpstreamResponse('headers', url, response, undefined, attemptContext, {
      ...imageLogOptions, isError: !response.ok,
    });
    if (response.status !== 429 || attempt === XAI_IMAGINE_MAX_RETRIES) {
      const usesSse = response.ok && isImageEventStreamResponse(response);
      if (usesSse) notifyImageSseResponse(options);
      try {
        return { image: await parseGptImageResponse(response, {
          apiKey,
          onBody: (text) => logImageUpstreamResponse('generate', url, response, text, attemptContext, {
            ...imageLogOptions, isError: !response.ok,
          }),
          onStreamComplete: (summary) => logImageUpstreamResponse('stream', url, response, JSON.stringify(summary), attemptContext, {
            ...imageLogOptions, isError: !summary.completed,
          }),
        }), usesSse };
      } catch (error) {
        if (usesSse && error && typeof error === 'object') {
          error.usesSse = true;
        }
        throw error;
      }
    }

    const retryDelayMs = getRetryAfterDelayMs(response);
    await response.text();
    console.warn(`[xai-imagine] 收到 429，${Math.ceil(retryDelayMs / 1000)} 秒后重试`);
    await delay(retryDelayMs);
  }

  throw new Error('xAI Imagine 请求重试次数已耗尽');
}
return { requestXaiImagineImage };
}
module.exports = { createXaiAdapter };
