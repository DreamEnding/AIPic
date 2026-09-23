const dns = require('node:dns');
const undici = require('undici');
const { Agent } = undici;
const { isPublicAddress, validateUrl, fail, MAX_RESPONSE_BYTES } = require('./policy.cjs');

// Validate the exact addresses returned to the connector, with no second DNS lookup.
function createPublicLookup(lookup = dns.lookup) {
  return (hostname, options, callback) => {
    lookup(hostname, { ...options, all: true }, (error, records) => {
      if (error) return callback(error);
      if (!records?.length || records.some(record => !isPublicAddress(record.address))) {
        return callback(Object.assign(new Error('DNS 解析到了非公网地址'), { code: 'OUTBOUND_BLOCKED' }));
      }
      if (options.all) callback(null, records);
      else callback(null, records[0].address, records[0].family);
    });
  };
}

const dispatcher = new Agent({
  connect: { lookup: createPublicLookup(), keepAlive: true, keepAliveInitialDelay: 15000 },
  keepAliveTimeout: 60000,
  headersTimeout: 1800000,
  bodyTimeout: 1800000,
});

async function safeFetch(url, init = {}) {
  validateUrl(url);
  const response = await undici.fetch(url, { ...init, dispatcher, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    fail(502, '禁止上游重定向');
  }
  if (!response.ok) {
    await response.body?.cancel();
    const headers = new Headers();
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) headers.set('retry-after', retryAfter);
    return Response.json({ error: { message: `上游接口返回 HTTP ${response.status}` } }, { status: response.status, headers });
  }
  if (!response.body) return response;
  const reader = response.body.getReader();
  let bytes = 0;
  return new Response(new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { reader.releaseLock(); controller.close(); return; }
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          fail(502, '上游响应超过大小限制');
        }
        controller.enqueue(value);
      } catch (error) { controller.error(error); }
    },
    async cancel(reason) { await reader.cancel(reason); },
  }), { status: response.status, statusText: response.statusText, headers: response.headers });
}

module.exports = { safeFetch, createPublicLookup };
