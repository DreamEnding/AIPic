/**
 * 逐块读取图片 SSE，最终图片就绪即结束；日志只收集计数，不复制 Base64。
 * @param {Response} response 已成功返回 SSE 响应头的请求。
 * @param {{ extractImage: Function, getErrorMessage: Function, onComplete?: Function }} options 图片提取、错误提取和诊断回调。
 * @returns {Promise<string>} 最终图片 Base64 或 URL 引用。
 */
async function readImageEventStream(response, options) {
  if (!response.body) throw new Error('上游流式响应没有可读取的正文');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const startedAt = Date.now();
  const stats = { bytes: 0, events: 0, heartbeats: 0, partialEvents: 0, firstChunkMs: null, maxChunkGapMs: 0, completed: false };
  let lastChunkAt = startedAt;
  let buffer = '';
  let scanOffset = 0;
  let dataLines = [];
  let eventName = '';
  let finalImage;
  let terminal = false;

  /** 处理一个完整事件，忽略心跳与中间预览，绝不把预览当成成品。 */
  function dispatchEvent() {
    const raw = dataLines.join('\n').trim();
    const name = eventName;
    dataLines = [];
    eventName = '';
    if (!raw) return;
    if (raw === '[DONE]') {
      terminal = true;
      return;
    }
    let payload;
    try { payload = JSON.parse(raw); } catch { throw new Error('上游 SSE 事件包含无效 JSON'); }
    if (!payload || typeof payload !== 'object') return;
    stats.events += 1;
    const type = String(payload.type || name || '').toLowerCase();
    const namedType = name.toLowerCase();
    const event = payload.type || !name ? payload : { ...payload, type: name };
    const error = options.getErrorMessage(event);
    if (error || /(?:^|[._-])(?:failed|error)$/.test(type)) {
      throw new Error(error || payload.message || '上游流式生图失败');
    }
    const object = String(payload.object || '').toLowerCase();
    const upstreamEventType = String(payload.upstream_event_type || '').toLowerCase();
    if (type.includes('partial') || namedType.includes('partial') || upstreamEventType.includes('partial')) {
      stats.partialEvents += 1;
      return;
    }
    const finalEvent = /(?:^|[._-])(?:completed|result|succeeded|success|done)$/.test(type)
      || String(payload.object || '').endsWith('.result');
    if (object.endsWith('.chunk')) return;
    const untypedResult = (!type || type === 'message') && (!object || object === 'list');
    if (!finalEvent && !untypedResult) return;
    try {
      finalImage = options.extractImage(event);
      stats.completed = true;
      terminal = true;
    } catch {
      if (finalEvent) throw new Error('上游最终图片事件没有可用图片数据');
    }
  }

  /** 按 SSE 行规则拆解事件，保留跨网络分块的数据与 event 名称。 */
  function consumeText(text, eof = false) {
    buffer += text;
    let consumed = 0;
    let index = scanOffset;
    for (; index < buffer.length && !terminal; index++) {
      const character = buffer[index];
      if (character !== '\n' && character !== '\r') continue;
      if (character === '\r' && index === buffer.length - 1 && !eof) break;
      const line = buffer.slice(consumed, index);
      if (character === '\r' && buffer[index + 1] === '\n') index += 1;
      consumed = index + 1;
      consumeLine(line);
    }
    buffer = buffer.slice(consumed);
    scanOffset = Math.max(0, index - consumed);
    if (eof && !terminal) {
      if (buffer) consumeLine(buffer);
      buffer = '';
      if (!terminal) dispatchEvent();
    }
  }

  /** 解析一行 SSE；注释行用于保活，不进入图片事件。 */
  function consumeLine(line) {
    if (line === '') { dispatchEvent(); return; }
    if (line.startsWith(':')) { stats.heartbeats += 1; return; }
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'data') dataLines.push(value);
    else if (field === 'event') eventName = value;
  }

  try {
    while (!terminal) {
      const { done, value } = await reader.read();
      if (done) {
        consumeText(decoder.decode(), true);
        break;
      }
      const chunkAt = Date.now();
      stats.bytes += value.byteLength;
      stats.maxChunkGapMs = Math.max(stats.maxChunkGapMs, chunkAt - lastChunkAt);
      lastChunkAt = chunkAt;
      if (stats.firstChunkMs === null) stats.firstChunkMs = chunkAt - startedAt;
      consumeText(decoder.decode(value, { stream: true }));
    }
    if (!finalImage) throw new Error('上游流式连接结束，但未返回最终图片；中间预览不会作为成品保存');
    return finalImage;
  } finally {
    // 不等待服务商关闭保持连接；取消只关闭响应读取，不重发生图请求。
    void reader.cancel().catch(() => {});
    reader.releaseLock();
    if (typeof options.onComplete === 'function') {
      try { options.onComplete({ ...stats, elapsedMs: Date.now() - startedAt }); } catch { /* 日志不能影响图片结果。 */ }
    }
  }
}

module.exports = { readImageEventStream };
