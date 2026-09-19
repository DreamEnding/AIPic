/**
 * 将图片上游错误压缩为可展示的诊断信息，不回显网关 HTML、认证信息或 IP。
 * 只读取已提供的响应和正文；不会消费流、请求上游或触发重试。
 */
const MAX_MESSAGE_CHARS = 1200;
const MAX_JSON_CHARS = 64 * 1024;
const HTML_PATTERN = /<!doctype\s+html|<\/?(?:html|head|body|script|style|title|div|span|iframe|!\[cdata\[)\b/i;

function bounded(value, limit) {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readHeader(response, name) {
  const headers = response?.headers;
  if (typeof headers?.get === 'function') return headers.get(name) || '';
  if (!isRecord(headers)) return '';
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return typeof entry?.[1] === 'string' ? entry[1] : '';
}

/** 精确屏蔽当前密钥，并移除错误文本中常见的认证值、链接、IP 和长令牌。 */
function sanitizeDetail(value, apiKey, limit) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  let text = String(value);
  if (HTML_PATTERN.test(text)) return '';
  if (typeof apiKey === 'string' && apiKey) {
    const secrets = new Set([apiKey]);
    try { secrets.add(encodeURIComponent(apiKey)); } catch { /* 原始密钥仍会被精确隐藏。 */ }
    for (const secret of secrets) {
      text = text.split(secret).join('[已隐藏]');
    }
  }
  text = text
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"'<>]+/gi, '[认证信息已隐藏]')
    .replace(/\b(?:sk|sess|xai|key)-[A-Za-z0-9_-]+/gi, '[密钥已隐藏]')
    .replace(/((?:["']?)(?:authorization|proxy[-_ ]?authorization|(?:x[-_ ]?)?api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|secret|password|cookie)(?:["']?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[已隐藏]')
    .replace(/((?:api[-_ ]?key|密钥|令牌)\s+(?:provided|supplied|used|is|was|为|是)\s*[:=]?\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[已隐藏]')
    .replace(/((?:api\s*key|密钥|令牌)\s+)(?:"[^"]*"|'[^']*'|[A-Za-z0-9_./+=-]{8,})/gi, '$1[已隐藏]')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[链接已隐藏]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP 已隐藏]')
    .replace(/(?:\b[\da-f]{1,4}:){2,}[\da-f:]+\b|::(?:ffff:)?(?:[\da-f]{1,4}:)*[\da-f]{1,4}\b/gi, '[IP 已隐藏]')
    .replace(/\b[A-Za-z0-9_+/=-]{40,}\b/g, '[长令牌已隐藏]')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return bounded(text, limit);
}

/** 诊断 ID 只接受短的可打印标识符；不从 HTML 页面中提取任何内容。 */
function safeRequestId(value, apiKey) {
  if (typeof value !== 'string') return '';
  const id = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id)) return '';
  if (/^(?:sk|sess|xai|key)-|bearer|authorization|api[-_]?key/i.test(id)) return '';
  if (apiKey && id.includes(apiKey)) return '';
  if (/\b(?:\d{1,3}\.){3}\d{1,3}\b|(?:[\da-f]{1,4}:){2}|::/i.test(id)) return '';
  return id;
}

function getJsonErrorDetails(payload) {
  if (!isRecord(payload)) return {};
  const error = isRecord(payload.error) ? payload.error : undefined;
  const nestedError = isRecord(error?.error) ? error.error : undefined;
  return {
    code: nestedError?.code ?? error?.code ?? payload.code,
    message: nestedError?.message ?? error?.message
      ?? (typeof payload.error === 'string' ? payload.error : undefined)
      ?? payload.message ?? payload.detail,
    requestId: error?.request_id ?? error?.requestId ?? payload.request_id ?? payload.requestId,
  };
}

/**
 * 生成不超过 1200 字符的中文图片上游错误，保留状态、API 错误和安全追踪 ID。
 * HTTP 524 明确区分请求了流式传输和上游实际输出，且提示不会自动重复提交。
 * @param {{ status?: number, headers?: Headers|Object }} response 上游响应或轻量响应元数据。
 * @param {string} responseText 已读取的错误正文；HTML 始终只使用通用描述。
 * @param {{ streamRequested?: boolean, apiKey?: string }} [options] 请求的流式标记，以及仅用于精确脱敏的内存密钥。
 * @returns {string} 可用于 Error.message、日志摘要或任务状态的安全错误说明。
 */
function formatImageUpstreamError(response, responseText, options = {}) {
  const status = Number.isInteger(response?.status) ? response.status : undefined;
  const prefix = `上游服务错误${status === undefined ? '' : `（HTTP ${status}）`}：`;
  const raw = typeof responseText === 'string' ? responseText.trim() : '';
  const isHtml = /text\/html|application\/xhtml\+xml/i.test(readHeader(response, 'content-type'))
    || HTML_PATTERN.test(raw);
  let payload;
  if (!isHtml && raw.length <= MAX_JSON_CHARS) {
    try { payload = JSON.parse(raw); } catch { /* 非 JSON 正文仅保留经过脱敏的短文本。 */ }
  }
  const details = getJsonErrorDetails(payload);
  const diagnosticIds = [];
  const requestId = [
    readHeader(response, 'x-request-id'),
    readHeader(response, 'request-id'),
    readHeader(response, 'x-correlation-id'),
    details.requestId,
  ].map(value => safeRequestId(value, options.apiKey)).find(Boolean);
  if (requestId) diagnosticIds.push(`请求 ID：${requestId}`);
  const ray = readHeader(response, 'cf-ray').trim();
  if (/^[a-f\d]{8,32}(?:-[a-z]{3})?$/i.test(ray) && (!options.apiKey || !ray.includes(options.apiKey))) {
    diagnosticIds.push(`CF-Ray：${ray}`);
  }
  const suffix = diagnosticIds.length ? `（${diagnosticIds.join('；')}）` : '';

  let message;
  if (status === 524) {
    message = options.streamRequested
      ? '本次已提交 stream=true，但上游网关在收到可用响应前超时（Cloudflare 524）。流式参数不代表上游已开始持续输出；需上游及时发送并转发真实 SSE 心跳或事件，或由服务商提供直连源站地址。'
      : '上游源站未在 Cloudflare 网关等待时间内返回可用响应（524）。可确认上游支持并及时发送真实 SSE 心跳或事件，或由服务商提供直连源站地址。';
    const code = sanitizeDetail(details.code, options.apiKey, 100);
    const detail = sanitizeDetail(details.message, options.apiKey, 500);
    if (code || detail) message += `上游说明：${code ? `${code}；` : ''}${detail}。`;
    message += '任务可能仍在上游执行，未自动重试，以免重复计费。';
  } else if (isHtml) {
    message = '上游返回了网关错误页面，未返回有效的图片 API 数据。请根据 HTTP 状态和请求 ID 联系服务商排查。未自动重试。';
  } else {
    const code = sanitizeDetail(details.code, options.apiKey, 100);
    const detail = sanitizeDetail(details.message, options.apiKey, 850)
      || (!isRecord(payload) && !Array.isArray(payload) && !/^[\[{]/.test(raw)
        ? sanitizeDetail(raw, options.apiKey, 850)
        : '')
      || '上游没有返回可用的错误说明。';
    message = `${code ? `错误码 ${code}；` : ''}${detail} 未自动重试。`;
  }
  return `${prefix}${bounded(message, MAX_MESSAGE_CHARS - prefix.length - suffix.length)}${suffix}`;
}

module.exports = { formatImageUpstreamError };
