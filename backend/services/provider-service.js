const capabilities = require('../providers/capabilities');

function createProviderService({ requestGptImage, requestXaiImagineImage, generateFlyreqGeminiImage, resolveGptImageRequestSize, resolveAndLogOutboundBaseUrl, resolveFlyreqApiBaseUrl }) {
  const adapters = {
    openai: (key, request, options) => requestGptImage(key, request, resolveGptImageRequestSize(request), { ...options, stream: Boolean(request.streamImages) }),
    xai: requestXaiImagineImage,
    google: async (key, request, options) => ({ image: await generateFlyreqGeminiImage(key, request, options), usesSse: false }),
  };
  return async function generateFlyreqImage(apiKey, request, options = {}) {
    const provider = request.imageApiFlavor === 'xai-imagine' ? 'xai' : request.protocol === 'google' ? 'google' : 'openai';
    const baseUrl = request.baseUrl
      ? resolveAndLogOutboundBaseUrl('图片生成', request.protocol, request.baseUrl).baseUrl
      : resolveFlyreqApiBaseUrl();
    if ((request.images?.length || 0) > capabilities[provider].maxReferenceImages) throw new Error('参考图数量超过 provider 限制');
    return adapters[provider](apiKey, request, { ...options, baseUrl });
  };
}
module.exports = { createProviderService };
