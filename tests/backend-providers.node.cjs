const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOpenaiAdapter } = require('../backend/providers/openai');
const { createProviderService } = require('../backend/services/provider-service');

test('OpenAI-compatible adapter preserves request and parses image results after extraction', async () => {
  let sent;
  const noop = () => {};
  const adapter = createOpenaiAdapter({
    validateEnumValue: value => value,
    GPT_IMAGE_QUALITIES: new Set(), GPT_IMAGE_STYLES: new Set(), GPT_IMAGE_BACKGROUNDS: new Set(), GPT_IMAGE_OUTPUT_FORMATS: new Set(),
    DEFAULT_GPT_IMAGE_ADVANCED_PARAMS: { quality: 'auto', style: 'auto', background: 'auto', outputFormat: 'png' },
    resolveFlyreqApiBaseUrl: () => 'https://api.openai.com/v1',
    appendProtocolApiPath: (_, base, endpoint) => base.replace(/\/v1$/, '') + endpoint,
    getImageUpstreamLogOptions: () => ({ enabled: false }),
    logImageRequestUrl: noop, logImageUpstreamRequest: noop, logImageUpstreamResponse: noop,
    fetchWithTimeout: async (url, init) => { sent = { url, init }; return Response.json({ data: [{ b64_json: 'AA==' }] }); },
  });
  const request = { mode: 'text-to-image', model: 'gpt-image-2', prompt: 'fixture', images: [], aspectRatio: '1:1' };
  const result = await adapter.requestGptImage('test-key', request, '1024x1024');
  assert.equal(result.image, 'AA==');
  assert.equal(sent.url, 'https://api.openai.com/v1/images/generations');
  assert.equal(sent.init.headers.Authorization, 'Bearer test-key');
  assert.equal(JSON.parse(sent.init.body).n, 1);
  const edit = adapter.createGptImageRequestInit('test-key', { ...request, mode: 'image-to-image', images: [{ data: 'AA==', mimeType: 'image/png' }] }, '1024x1024');
  assert.equal(edit.body.get('image[]').size, 1);
});

test('provider service dispatches OpenAI, Grok/custom compatibility, xAI and Gemini through adapters', async () => {
  const generate = createProviderService({
    requestGptImage: async () => ({ provider: 'openai' }),
    requestXaiImagineImage: async () => ({ provider: 'xai' }),
    generateFlyreqGeminiImage: async () => 'google-image',
    resolveGptImageRequestSize: () => '1024x1024',
    resolveAndLogOutboundBaseUrl: () => ({ baseUrl: 'https://api.openai.com/v1' }),
    resolveFlyreqApiBaseUrl: () => 'https://api.openai.com/v1',
  });
  assert.equal((await generate('key', { protocol: 'openai', images: [] })).provider, 'openai');
  assert.equal((await generate('key', { protocol: 'openai', model: 'grok-imagine-image', images: [] })).provider, 'openai');
  assert.equal((await generate('key', { protocol: 'openai', imageApiFlavor: 'xai-imagine', images: [] })).provider, 'xai');
  assert.equal((await generate('key', { protocol: 'google', images: [] })).image, 'google-image');
  await assert.rejects(() => generate('key', { imageApiFlavor: 'xai-imagine', images: [{}, {}] }), /参考图/);
});
