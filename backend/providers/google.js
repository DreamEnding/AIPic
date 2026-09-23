// Adapted from FlyReq Image Studio; AGPL-3.0-only. See ../LICENSE.
function createGoogleAdapter({ resolveFlyreqApiBaseUrl, appendProtocolApiPath, getImageUpstreamLogOptions, logImageRequestUrl, logImageUpstreamRequest, fetchWithTimeout, logImageUpstreamResponse, getUpstreamHttpErrorPrefix, isLikelyHtmlResponse, parseJsonSafely, getErrorMessageFromPayload }) {
function extractGeminiImagePayload(data) {
  const imagePart = data?.candidates?.[0]?.content?.parts?.find(part => part?.inlineData?.data || part?.inline_data?.data);
  const inlineData = imagePart?.inlineData || imagePart?.inline_data;
  if (!inlineData?.data) throw new Error('响应中无图片数据');
  return inlineData.data;
}

async function generateFlyreqGeminiImage(apiKey, request, options = {}) {
  const baseUrl = options.baseUrl || resolveFlyreqApiBaseUrl();
  const parts = [
    { text: request.prompt },
    ...request.images.map(img => ({ inlineData: { data: img.data, mimeType: img.mimeType } })),
  ];
  const url = appendProtocolApiPath('google', baseUrl, `/v1beta/models/${encodeURIComponent(request.model)}:generateContent`);
  const imageLogOptions = getImageUpstreamLogOptions();
  const requestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        ...(typeof request.temperature === 'number' ? { temperature: request.temperature } : {}),
        responseModalities: ['IMAGE'],
        imageConfig: { imageSize: request.outputSize, aspectRatio: request.aspectRatio },
      },
    }),
  };
  const logContext = {
    taskId: options.taskId,
    imageIndex: options.imageIndex,
    protocol: 'google',
    model: request.model,
    mode: request.mode,
    outputSize: request.outputSize,
    aspectRatio: request.aspectRatio,
  };
  logImageRequestUrl('google', request.model, url);
  logImageUpstreamRequest('generate', url, requestInit, logContext, imageLogOptions);
  const response = await fetchWithTimeout(url, { ...requestInit, signal: options.signal });
  if (imageLogOptions.enabled) {
    const responseText = await response.clone().text();
    logImageUpstreamResponse('generate', url, response, responseText, logContext, {
      ...imageLogOptions,
      isError: !response.ok,
    });
  }

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`${getUpstreamHttpErrorPrefix(response.status)}：${responseText}`);
  }

  const responseText = await response.text();
  if (isLikelyHtmlResponse(responseText)) {
    throw new Error(`上游服务错误：${responseText}`);
  }
  const data = parseJsonSafely(responseText);
  if (!data) {
    throw new Error(`上游服务错误：${responseText}`);
  }
  const errorMessage = getErrorMessageFromPayload(data);
  if (errorMessage) {
    throw new Error(`上游服务错误：${responseText}`);
  }
  return extractGeminiImagePayload(data);
}
return { extractGeminiImagePayload, generateFlyreqGeminiImage };
}
module.exports = { createGoogleAdapter };
