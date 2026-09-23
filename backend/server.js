// AIPic server lifecycle. Backend remains AGPL-3.0-only; see LICENSE.
const http = require('node:http');
const { handleImages, shutdownTasks, setupWebSocketServer, HOSTNAME, PORT, sendJson, db, storageReady, getRuntimeEnv, createHttpError, handleAipicProxy, handleApi, serveStatic, handleServerListenError, flushDailyFileLogs } = require('./services/task-service');
const { authorizeRequest } = require('./security/auth');
const { createLimiter } = require('./security/rate-limit');
const { MAX_BODY_BYTES } = require('./security/policy.cjs');
const { handleHealth } = require('./routes/health');
const acquireRequest = createLimiter();
const acquireRead = createLimiter({ requests: 1200, concurrency: 16, globalConcurrency: 32 });

const startServer = () => {
  let stopping = false;
  const wss = setupWebSocketServer();
  const httpServer = http.createServer(async (req, res) => {
    if (stopping) { sendJson(res, 503, { error: '服务正在停止' }); return; }
    let parsedUrl;
    try { parsedUrl = new URL(req.url || '/', 'http://localhost'); }
    catch { sendJson(res, 400, { error: '请求 URL 无效' }); return; }
    if (handleHealth(req, res, parsedUrl.pathname, { db, storageReady, sendJson })) return;
    if (/^\/(api\/flyreq|api-proxy)(\/|$)/.test(parsedUrl.pathname) && req.method !== 'OPTIONS') {
      try {
        const identity = authorizeRequest(req, getRuntimeEnv());
        const release = (req.method === 'GET' || req.method === 'HEAD' ? acquireRead : acquireRequest)(identity);
        res.once('close', release);
        res.once('finish', release);
        if (Number(req.headers['content-length']) > MAX_BODY_BYTES) throw createHttpError(413, 'PAYLOAD_TOO_LARGE', '请求体过大');
      } catch (error) { sendJson(res, error.statusCode || 500, { error: error.message }, error.statusCode === 429 ? { 'Retry-After': '60' } : {}); return; }
    }
    if (parsedUrl.pathname === '/api-proxy' || parsedUrl.pathname?.startsWith('/api-proxy/')) {
      await handleAipicProxy(req, res, parsedUrl);
      return;
    }
    if (parsedUrl.pathname?.startsWith('/api/flyreq/')) {
      if (await handleImages(req, res, parsedUrl.pathname)) return;
      const handled = await handleApi(req, res, parsedUrl.pathname);
      if (handled || res.headersSent || res.writableEnded) return;
    }
    if (serveStatic(req, res, parsedUrl.pathname || '/')) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  });

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url || '/', `http://${req.headers.host || `${HOSTNAME}:${PORT}`}`).pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname === '/api/flyreq/ws') {
      try {
        const release = acquireRead(authorizeRequest(req, getRuntimeEnv()));
        socket.once('close', release);
      } catch { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
      return;
    }
    socket.destroy();
  });

  // Browsers only submit/poll short task requests; slow model work runs in the queue.
  httpServer.requestTimeout = 5 * 60 * 1000;
  httpServer.timeout = 0;
  httpServer.once('error', handleServerListenError);
  httpServer.listen(PORT, HOSTNAME, () => {
    const localUrl = `http://localhost:${PORT}`;
    const listenUrl = `http://${HOSTNAME}:${PORT}`;
    console.log(`AIPic FlyReq backend ready on ${localUrl}`);
    if (HOSTNAME !== 'localhost' && HOSTNAME !== '127.0.0.1') {
      console.log(`Listening on ${listenUrl}`);
    }
  });
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    httpServer.close();
    for (const ws of wss.clients) ws.close(1001, 'Server shutdown');
    void shutdownTasks().finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
};

if (!storageReady) {
  // 文件系统错误已经写入日志队列；等待落盘完成后退出，避免丢失最关键的启动诊断。
  void flushDailyFileLogs().finally(() => process.exit(1));
} else {
  startServer();
}
