const AIPIC_HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);
// Adapted from FlyReq Image Studio; AGPL-3.0-only. See ../LICENSE.
function createProxyRoutes({ parseBooleanEnv, getRuntimeEnv, sendJson, selectUpstream, readRawBody, validateProxyBody, fetchWithTimeout, pipeline, Readable, normalizeError }) {
// 转发已有同步接口；环境开关仅控制此路由，不影响独立的后台生图任务。
async function handleAipicProxy(req, res, parsedUrl) {
  if (!parseBooleanEnv(getRuntimeEnv().ENABLE_API_PROXY, true)) {
    sendJson(res, 404, { error: 'API 代理已关闭' });
    return;
  }
  const endpoint = parsedUrl.pathname.slice('/api-proxy/'.length).replace(/^\/+/, '');
  if (!endpoint) {
    sendJson(res, 400, { error: '缺少 API 代理路径' });
    return;
  }
  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': '*, x-aipic-upstream, x-aipic-proxy-stream, x-aipic-timeout-seconds',
    'access-control-max-age': '86400',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }
  const controller = new AbortController();
  const abortFromUpload = () => controller.abort(new DOMException('Request upload aborted', 'AbortError'));
  const abortFromResponse = () => {
    if (!res.writableFinished) controller.abort(new DOMException('Client disconnected', 'AbortError'));
  };
  req.once('aborted', abortFromUpload);
  res.once('close', abortFromResponse);
  try {
    const env = getRuntimeEnv();
    const baseUrl = selectUpstream(env, req.headers['x-aipic-provider'], req.headers['x-aipic-upstream']);
    const upstreamUrl = new URL(`${baseUrl}/${endpoint}`);
    upstreamUrl.search = parsedUrl.search;
    const connectionHeaders = String(req.headers.connection || '').toLowerCase().split(',').map(name => name.trim());
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined || AIPIC_HOP_BY_HOP_HEADERS.has(name) || connectionHeaders.includes(name)) continue;
      if (/^(x-aipic-|cf-access-|x-forwarded-)/.test(name)) continue;
      if (['host', 'origin', 'cookie', 'x-aipic-access-token', 'x-aipic-provider', 'x-aipic-upstream', 'x-aipic-proxy-stream', 'x-aipic-timeout-seconds'].includes(name)) continue;
      if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
      else headers.set(name, value);
    }
    const hasBody = !['GET', 'HEAD'].includes(req.method || 'GET');
    const proxyBody = hasBody ? await readRawBody(req) : undefined;
    await validateProxyBody(proxyBody, req.headers['content-type']);
    const upstream = await fetchWithTimeout(upstreamUrl, {
      method: req.method,
      headers,
      signal: controller.signal,
      ...(hasBody ? { body: proxyBody } : {}),
    });
    const responseHeaders = { ...corsHeaders };
    const responseConnectionHeaders = String(upstream.headers.get('connection') || '').toLowerCase().split(',').map(name => name.trim());
    upstream.headers.forEach((value, name) => {
      if (AIPIC_HOP_BY_HOP_HEADERS.has(name) || responseConnectionHeaders.includes(name)) return;
      // Fetch decodes compressed bodies; the origin's compressed length no longer applies.
      if (['content-encoding', 'content-length', 'set-cookie', 'location'].includes(name)) return;
      responseHeaders[name] = value;
    });
    res.writeHead(upstream.status, responseHeaders);
    if (!upstream.body || req.method === 'HEAD') {
      if (upstream.body) await upstream.body.cancel();
      res.end();
      return;
    }
    res.flushHeaders();
    await pipeline(Readable.fromWeb(upstream.body), res, { signal: controller.signal });
  } catch (error) {
    if (!res.headersSent && !res.destroyed) {
      sendJson(res, error.statusCode || (/timeout|timed out/i.test(String(error?.message)) ? 504 : 502), { error: normalizeError(error) }, corsHeaders);
    } else if (!res.destroyed) {
      res.destroy();
    }
  } finally {
    req.removeListener('aborted', abortFromUpload);
    res.removeListener('close', abortFromResponse);
  }
}
return { handleAipicProxy };
}
module.exports = { createProxyRoutes };
