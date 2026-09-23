const SECRET_KEY = /authorization|api.?key|token|password|secret|cookie|prompt|body|b64|base64|image_data/i;
function redact(value) {
  if (value instanceof Error) return redact(value.message);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEY.test(key) ? '[REDACTED]' : redact(item)]));
  if (typeof value !== 'string') return value;
  return value
    .replace(/([?&](?:key|api[_-]?key|(?:access[_-]?|refresh[_-]?)?token|secret|signature|password)=)[^&#\s"']+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[^\s"',}]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[\w-]+/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|authorization|token|password|secret)["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi, '$1[REDACTED]')
    .replace(/("(?:prompt|body|b64_json|base64|image_data)"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2')
    .replace(/data:[^;\s]+;base64,[a-z\d+/=]+/gi, '[REDACTED IMAGE]');
}
module.exports = { redact };
