// Shared by the Node backend and Pages Function. No runtime-specific imports.
const MAX_BODY_BYTES = 24 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_REFERENCE_IMAGES = 8;
const BUILTIN_PROVIDERS = Object.freeze({ openai: 'https://api.openai.com/v1', xai: 'https://api.x.ai/v1', grok: 'https://api.x.ai/v1', google: 'https://generativelanguage.googleapis.com/v1beta' });

function fail(statusCode, message) {
  throw Object.assign(new Error(message), { statusCode, code: 'SECURITY_POLICY' });
}

function isPublicAddress(address) {
  const value = String(address).toLowerCase().replace(/^\[|\]$/g, '');
  if (value.includes(':')) {
    // Only ordinary global unicast; exclude mapped IPv4, local, transition and documentation space.
    if (!/^[23][0-9a-f]{3}:/.test(value) || /^(2002:|3fff:|2001:db8:)/.test(value)) return false;
    if (value.startsWith('2001:') && parseInt(value.split(':')[1] || '0', 16) < 0x200) return false;
    return true;
  }
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some(p => !/^\d+$/.test(p) || Number(p) > 255)) return false;
  const [a, b, c] = parts.map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

function validateUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail(403, '上游 URL 无效'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) fail(403, '上游必须使用无凭据的 HTTPS URL');
  const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (host === 'localhost' || !host.includes('.') && !host.includes(':') ||
      /\.(localhost|local|internal|lan|home|test|invalid)$/.test(host) ||
      host === 'metadata.google.internal' ||
      ((host.includes(':') || /^[\d.]+$/.test(host)) && !isPublicAddress(host))) fail(403, '禁止访问本地或非公网地址');
  return url;
}

function providers(env = {}) {
  let custom = {};
  if (env.AIPIC_PROVIDERS) {
    try { custom = JSON.parse(env.AIPIC_PROVIDERS); } catch { fail(503, 'AIPIC_PROVIDERS 配置无效'); }
    if (!custom || Array.isArray(custom) || typeof custom !== 'object') fail(503, 'AIPIC_PROVIDERS 配置无效');
  }
  const result = { ...BUILTIN_PROVIDERS, ...custom };
  result.default = env.API_PROXY_URL || env.DEFAULT_API_URL || result.openai;
  for (const [id, value] of Object.entries(result)) result[id] = validateUrl(value).href.replace(/\/+$/, '');
  return result;
}

function selectUpstream(env, providerId, legacyUrl) {
  const configured = providers(env);
  if (providerId && !Object.hasOwn(configured, providerId)) fail(403, 'Provider 未获授权');
  const selected = configured[providerId || 'default'];
  if (!legacyUrl) return selected;
  const requested = validateUrl(legacyUrl).href.replace(/\/+$/, '');
  if (!Object.values(configured).includes(requested) || (providerId && requested !== selected)) fail(403, '上游不在服务端 allowlist 中');
  return requested;
}

function authenticate(headers, env) {
  const expected = env.AIPIC_ACCESS_TOKEN;
  if (!expected) fail(503, '服务尚未配置 AIPIC_ACCESS_TOKEN');
  // Separate from Authorization: that header belongs to the model provider.
  const supplied = headers.get('x-aipic-access-token') || '';
  let diff = supplied.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (supplied.charCodeAt(i) || 0);
  if (diff) fail(401, '需要应用访问认证');
  return 'authenticated';
}

function validateImages(body) {
  if ((body.images?.length || 0) > MAX_REFERENCE_IMAGES) fail(413, '参考图数量超过限制');
  for (const image of [...(body.images || []), ...(body.mask ? [body.mask] : [])]) {
    if (typeof image.data !== 'string' || image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) fail(413, '单图大小超过限制');
  }
}

async function validateProxyBody(body, contentType = '') {
  if (!body) return;
  const response = new Response(body, { headers: { 'content-type': contentType } });
  const checkCount = value => {
    const count = Number(value);
    if (!Number.isInteger(count) || count < 1 || count > 4) fail(413, '批量数量超过限制');
  };
  if (contentType.includes('application/json')) {
    let parsed;
    try { parsed = await response.json(); } catch { fail(400, '请求 JSON 格式无效'); }
    function visit(value, key = '', depth = 0) {
      if (depth > 32) fail(413, '请求嵌套过深');
      if (/^(n|num_images|parallelCount)$/.test(key)) checkCount(value);
      if (Array.isArray(value) && /^(images|reference_images|input_images)$/.test(key) && value.length > MAX_REFERENCE_IMAGES) fail(413, '参考图数量超过限制');
      if (typeof value === 'string' && value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) fail(413, '单图或文本大小超过限制');
      if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) visit(item, name, depth + 1);
    }
    visit(parsed);
  } else if (contentType.includes('multipart/form-data')) {
    let form;
    try { form = await response.formData(); } catch { fail(400, '表单格式无效'); }
    let count = 0;
    for (const [name, value] of form) {
      if (/^(n|num_images|parallelCount)$/.test(name)) checkCount(value);
      if (typeof value !== 'string') {
        if (value.size > MAX_IMAGE_BYTES || ++count > MAX_REFERENCE_IMAGES + 1) fail(413, '参考图大小或数量超过限制');
      }
    }
  }
}

module.exports = { MAX_BODY_BYTES, MAX_IMAGE_BYTES, MAX_RESPONSE_BYTES, MAX_REFERENCE_IMAGES, BUILTIN_PROVIDERS, fail, isPublicAddress, validateUrl, providers, selectUpstream, authenticate, validateImages, validateProxyBody };
