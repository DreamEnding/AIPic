// Adapted from FlyReq Image Studio; AGPL-3.0-only. See ../LICENSE.
function createTaskRoutes({ ackTask, sendJson, getQueueStats, path, fs, buildPlatformManifest, resolvePlatformBranding, getRuntimeEnv, resolveImageModelKeyGuide, resolveImagePresetModelIds, resolveDefaultImageModelConfig, resolveDefaultVideoModelConfig, resolveVideoWorkspaceConfig, resolveVideoProtocolConfig, readJsonBody, hashPromptGalleryPassword, selectUpstream, resolveAndLogOutboundBaseUrl, appendProtocolApiPath, fetchWithTimeout, normalizeError, stripProtocolVersionSuffix, readVideoMultipartBody, normalizeVideoTaskPayload, createVideoTaskBatch, db, serializeTask, createVideoTask, cancelVideoTask, createTaskBatch, createTask, isHttpError, sendHttpError, __dirname }) {
async function handleApi(req, res, pathname) {
  try {
    const apiPathname = pathname.replace(/\/+$/, '');

    if (req.method === 'GET' && apiPathname === '/api/flyreq/queue-status') {
      sendJson(res, 200, getQueueStats());
      return true;
    }

    if (req.method === 'GET' && apiPathname === '/api/flyreq/prompts') {
      const promptsPath = path.join(__dirname, 'prompts.json');
      try {
        if (!fs.existsSync(promptsPath)) {
          sendJson(res, 200, []);
          return true;
        }
        const raw = fs.readFileSync(promptsPath, 'utf8');
        const data = JSON.parse(raw);
        sendJson(res, 200, Array.isArray(data) ? data : []);
      } catch {
        sendJson(res, 200, []);
      }
      return true;
    }

    if (req.method === 'GET' && apiPathname === '/api/flyreq/blacklist') {
      const blacklistPath = path.join(__dirname, 'blacklist.json');
      try {
        if (!fs.existsSync(blacklistPath)) {
          sendJson(res, 200, { keywords: [] });
          return true;
        }
        const raw = fs.readFileSync(blacklistPath, 'utf8');
        const data = JSON.parse(raw);
        sendJson(res, 200, { keywords: Array.isArray(data.keywords) ? data.keywords : [] });
      } catch {
        sendJson(res, 200, { keywords: [] });
      }
      return true;
    }

    if (req.method === 'GET' && apiPathname === '/api/flyreq/manifest.webmanifest') {
      sendJson(res, 200, buildPlatformManifest(resolvePlatformBranding(getRuntimeEnv())), {
        'Content-Type': 'application/manifest+json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      return true;
    }

    if (req.method === 'GET' && apiPathname === '/api/flyreq/config') {
      const env = getRuntimeEnv();
      const rawMode = String(env.PROMPT_GALLERY_MODE || '2').trim();
      const mode = ['1', '2', '3'].includes(rawMode) ? rawMode : '2';
      sendJson(
        res,
        200,
        {
          promptGalleryMode: mode,
          promptGalleryPasswordEnabled: String(env.PROMPT_GALLERY_PASSWORD || '').trim().length > 0,
          imageModelKeyGuide: resolveImageModelKeyGuide(env),
          imagePresetModelIds: resolveImagePresetModelIds(env),
          defaultImageModel: resolveDefaultImageModelConfig(env),
          defaultVideoModel: resolveDefaultVideoModelConfig(env),
          videoWorkspace: resolveVideoWorkspaceConfig(env),
          videoProtocols: resolveVideoProtocolConfig(env),
          branding: resolvePlatformBranding(env),
        },
        {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      );
      return true;
    }

    if (req.method === 'POST' && apiPathname === '/api/flyreq/prompt-gallery/verify') {
      const env = getRuntimeEnv();
      const expected = String(env.PROMPT_GALLERY_PASSWORD || '').trim();
      if (!expected) {
        sendJson(res, 200, { ok: true });
        return true;
      }

      const body = await readJsonBody(req);
      const password = String(body?.password || '');
      const ok = hashPromptGalleryPassword(password) === hashPromptGalleryPassword(expected);
      sendJson(res, 200, { ok });
      return true;
    }

    // ===== 文本 AI 代理（流式 + 非流式，OpenAI / Google 协议） =====
    if (req.method === 'POST' && apiPathname === '/api/flyreq/proxy/text') {
      try {
        const body = await readJsonBody(req);
        const { protocol, baseUrl, apiKey, model, stream, requestBody } = body;
        if (!baseUrl || !apiKey) {
          sendJson(res, 400, { error: 'Missing baseUrl or apiKey' });
          return true;
        }

        const normalizedBaseUrl = selectUpstream(getRuntimeEnv(), body.providerId, resolveAndLogOutboundBaseUrl('文本代理', protocol, baseUrl).baseUrl);
        let targetUrl;
        const authHeaders = { 'Content-Type': 'application/json' };

        if (protocol === 'google') {
          targetUrl = appendProtocolApiPath(
            'google',
            normalizedBaseUrl,
            stream
              ? `/v1beta/models/${encodeURIComponent(model || '')}:streamGenerateContent?alt=sse`
              : `/v1beta/models/${encodeURIComponent(model || '')}:generateContent`,
          );
          authHeaders['x-goog-api-key'] = apiKey;
          authHeaders['Authorization'] = `Bearer ${apiKey}`;
        } else {
          targetUrl = appendProtocolApiPath('openai', normalizedBaseUrl, '/v1/responses');
          authHeaders['Authorization'] = `Bearer ${apiKey}`;
        }

        if (stream) {
          authHeaders['Accept'] = 'text/event-stream';
        }

        let forwardedBody;
        if (requestBody) {
          forwardedBody = requestBody;
        } else {
          const clean = { ...body };
          delete clean.protocol;
          delete clean.baseUrl;
          delete clean.apiKey;
          delete clean.model;
          delete clean.stream;
          delete clean.requestBody;
          forwardedBody = clean;
        }

        const upstream = await fetchWithTimeout(targetUrl, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify(forwardedBody),
        });

        if (stream && upstream.ok) {
          res.writeHead(upstream.status, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
          });
          const reader = upstream.body.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) { res.end(); return true; }
              res.write(value);
            }
          } catch {
            res.end();
          }
          return true;
        }

        let data = null;
        try { data = await upstream.json(); } catch { /* ignore */ }
        sendJson(res, upstream.status, data || { error: `上游返回 ${upstream.status}` });
      } catch (error) {
        if (error && error.message && /abort|timeout/i.test(error.message)) {
          sendJson(res, 504, { error: '代理请求上游超时' });
        } else {
          sendJson(res, 502, { error: normalizeError(error) });
        }
      }
      return true;
    }

    // ===== 模型检查与目录代理 =====
    if ((req.method === 'GET' || req.method === 'POST') && apiPathname === '/api/flyreq/proxy/models') {
      try {
        const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        // POST 将密钥放在请求体内，避免 API Key 出现在浏览器地址、代理日志和服务器访问日志中。
        const body = req.method === 'POST' ? await readJsonBody(req) : {};
        const baseUrl = req.method === 'POST' ? body.baseUrl : parsed.searchParams.get('baseUrl');
        const apiKey = req.method === 'POST' ? body.apiKey : parsed.searchParams.get('apiKey');
        const protocol = (req.method === 'POST' ? body.protocol : parsed.searchParams.get('protocol')) || 'openai';
        if (!baseUrl || !apiKey) {
          sendJson(res, 400, { error: 'Missing baseUrl or apiKey' });
          return true;
        }

        const normalizedBaseUrl = selectUpstream(getRuntimeEnv(), body.providerId, resolveAndLogOutboundBaseUrl('模型列表', protocol, baseUrl).baseUrl);
        const isGoogle = protocol === 'google';
        const modelsUrl = `${stripProtocolVersionSuffix(protocol, normalizedBaseUrl)}${isGoogle ? '/v1beta/models' : '/v1/models'}`;
        // Google 原生目录使用 x-goog-api-key；其余兼容协议统一使用 Bearer 认证。
        const headers = isGoogle
          ? { 'x-goog-api-key': String(apiKey) }
          : { Authorization: `Bearer ${apiKey}` };

        const response = await fetchWithTimeout(modelsUrl, { method: 'GET', headers });
        let data = null;
        try { data = await response.json(); } catch { /* ignore */ }
        sendJson(res, response.status, data);
      } catch (error) {
        sendJson(res, 502, { error: normalizeError(error) });
      }
      return true;
    }

    // 批量创建端点：请求体包含公共参数和 parallelCount，响应按图片序号返回独立 taskIds。
    if (req.method === 'POST' && apiPathname === '/api/flyreq/video-tasks') {
      const { fields, files } = await readVideoMultipartBody(req);
      const payload = await normalizeVideoTaskPayload(fields, files);
      if (payload.parallelCount > 1) {
        const taskIds = createVideoTaskBatch(payload, files, req);
        const selectTask = db.prepare('SELECT * FROM tasks WHERE id = ? AND mode = ?');
        const tasks = taskIds.map(taskId => serializeTask(selectTask.get(taskId, 'video-generation')));
        sendJson(res, 202, { taskIds, tasks });
        return true;
      }
      const taskId = createVideoTask(payload, files, req);
      const task = serializeTask(db.prepare('SELECT * FROM tasks WHERE id = ? AND mode = ?').get(taskId, 'video-generation'));
      sendJson(res, 202, { ...task, taskId });
      return true;
    }

    const videoTaskMatch = apiPathname.match(/^\/api\/flyreq\/video-tasks\/([^/]+)(?:\/(ack|cancel))?$/);
    if (videoTaskMatch) {
      const taskId = decodeURIComponent(videoTaskMatch[1]);
      const action = videoTaskMatch[2];
      if (req.method === 'GET' && !action) {
        const task = serializeTask(db.prepare('SELECT * FROM tasks WHERE id = ? AND mode = ?').get(taskId, 'video-generation'));
        sendJson(res, task ? 200 : 404, task || { id: taskId, status: 'expired', error: '该任务已超出取回时间' });
        return true;
      }
      if (req.method === 'POST' && action === 'ack') {
        const existing = db.prepare('SELECT id FROM tasks WHERE id = ? AND mode = ?').get(taskId, 'video-generation');
        if (existing) ackTask(taskId);
        sendJson(res, 200, { ok: true });
        return true;
      }
      if (req.method === 'POST' && action === 'cancel') {
        // 取消端点只接受排队中或处理中的视频任务，并返回写入后的终态快照。
        const cancellation = cancelVideoTask(taskId);
        if (!cancellation.found) {
          sendJson(res, 404, { error: '视频任务不存在或已过期' });
        } else if (!cancellation.cancelled) {
          sendJson(res, 409, { error: '视频任务已经结束，无法取消' });
        } else {
          const task = serializeTask(db.prepare('SELECT * FROM tasks WHERE id = ? AND mode = ?').get(taskId, 'video-generation'));
          sendJson(res, 200, task);
        }
        return true;
      }
      sendJson(res, 405, { error: 'Method Not Allowed' });
      return true;
    }

    if (req.method === 'POST' && apiPathname === '/api/flyreq/tasks/batch') {
      const body = await readJsonBody(req);
      const taskIds = createTaskBatch(body, req);
      sendJson(res, 202, { taskIds });
      return true;
    }

    if (req.method === 'POST' && apiPathname === '/api/flyreq/tasks') {
      const body = await readJsonBody(req);
      const taskId = createTask(body, req);
      sendJson(res, 202, { taskId });
      return true;
    }

    const match = apiPathname.match(/^\/api\/flyreq\/tasks\/([^/]+)(?:\/(ack))?$/);
    if (!match) return false;
    const taskId = decodeURIComponent(match[1]);
    const action = match[2];

    if (req.method === 'GET' && !action) {
      const task = serializeTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId));
      sendJson(res, task ? 200 : 404, task || { id: taskId, status: 'expired', error: '该任务已超出取回时间' });
      return true;
    }

    if (req.method === 'POST' && action === 'ack') {
      ackTask(taskId);
      sendJson(res, 200, { ok: true });
      return true;
    }

    sendJson(res, 405, { error: 'Method Not Allowed' });
    return true;
  } catch (error) {
    if (isHttpError(error)) {
      sendHttpError(res, error);
    } else if (error && typeof error.statusCode === 'number') {
      sendJson(res, error.statusCode, { error: normalizeError(error) });
    } else {
      sendJson(res, 400, { error: normalizeError(error) });
    }
    return true;
  }
}
return { handleApi };
}
module.exports = { createTaskRoutes };
