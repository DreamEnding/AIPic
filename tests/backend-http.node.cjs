const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const Database = require('../backend/node_modules/better-sqlite3');

test('real Node HTTP boundary, readiness, body limits, rate limit and restart recovery', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aipic-security-'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  let child;
  let childOutput = '';
  const start = async () => {
    child = spawn(process.execPath, ['--require', path.join(__dirname, 'fixtures/mock-outbound.cjs'), 'backend/server.js'], {
      env: { ...process.env, PORT: String(port), AIPIC_HOST: '127.0.0.1', AIPIC_ACCESS_TOKEN: 'app-test', AIPIC_PROVIDERS: '{"custom":"https://models.example.com/v1"}', FLYREQ_BASE_URL_REWRITE_MAP: '{"https://models.example.com/v1?token=logger-secret":"https://api.openai.com/v1?auth=logger-secret"}', FLYREQ_TASK_DB: path.join(directory, 'tasks.sqlite'), FLYREQ_IMAGE_DIR: path.join(directory, 'images'), FLYREQ_VIDEO_DIR: path.join(directory, 'videos'), FLYREQ_FILE_LOG_ENABLED: 'false', FLYREQ_IMAGE_UPSTREAM_LOG_ENABLED: 'false', FLYREQ_VIDEO_UPSTREAM_LOG_ENABLED: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    child.stdout.on('data', data => { childOutput += data; });
    child.stderr.on('data', data => { childOutput += data; });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(`Backend failed: ${childOutput}`);
      try { if ((await fetch(`http://127.0.0.1:${port}/ready`)).ok) return; } catch { /* startup */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Backend startup timed out');
  };
  const stop = async () => { if (child?.exitCode === null) { const ended = new Promise(resolve => child.once('exit', resolve)); child.kill(); await ended; } };
  const request = (route, init = {}) => fetch(`http://127.0.0.1:${port}${route}`, init);
  const headers = { 'x-aipic-access-token': 'app-test', 'content-type': 'application/json' };
  try {
    await start();
    assert.equal((await request('/health')).status, 200);
    assert.equal((await request('/api/flyreq/tasks')).status, 401);
    assert.equal((await request('/api-proxy/models')).status, 401);
    await request('/api/flyreq/proxy/models?protocol=openai&apiKey=provider-test&baseUrl=https%3A%2F%2Fmodels.example.com%2Fv1%3Ftoken%3Dlogger-secret', { headers });
    assert.ok(childOutput.includes('[base-url-rewrite]'));
    assert.ok(!childOutput.includes('logger-secret'), 'Query tokens must not enter process logs');
    assert.equal((await request('/api-proxy/models', { headers: { ...headers, 'x-aipic-upstream': 'https://127.0.0.1' } })).status, 403);
    const proxied = await request('/api-proxy/models', { headers: { 'x-aipic-access-token': 'app-test', 'x-aipic-provider': 'custom', authorization: 'Bearer provider-test' } });
    assert.equal(proxied.status, 200);
    assert.deepEqual(await proxied.json(), {
      target: 'https://models.example.com/v1/models', providerAuthorization: 'Bearer provider-test',
      applicationTokenForwarded: false, upstreamHeaderForwarded: false,
    });
    const payload = { apiKey: 'provider-test', baseUrl: 'https://127.0.0.1', protocol: 'openai', mode: 'text-to-image', prompt: 'test', model: 'test', parallelCount: 1, outputSize: '1K', aspectRatio: '1:1', images: [] };
    assert.equal((await request('/api/flyreq/tasks', { method: 'POST', headers, body: JSON.stringify(payload) })).status, 403);
    assert.equal((await request('/api/flyreq/tasks', { method: 'POST', headers, body: JSON.stringify({ ...payload, baseUrl: 'https://api.openai.com/v1', images: Array(9).fill({ data: 'AA==', mimeType: 'image/png' }) }) })).status, 413);
    assert.equal((await request('/api/flyreq/tasks/batch', { method: 'POST', headers, body: JSON.stringify({ ...payload, baseUrl: 'https://api.openai.com/v1', parallelCount: 5 }) })).status, 400);
    assert.equal((await request('/api/flyreq/tasks', { method: 'POST', headers, body: ' '.repeat(24 * 1024 * 1024 + 1) })).status, 413);
    let uploaded = 0;
    const chunked = new ReadableStream({ pull(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
      if (++uploaded === 25) controller.close();
    } });
    assert.equal((await request('/api-proxy/images/generations', {
      method: 'POST', headers: { 'x-aipic-access-token': 'app-test', 'content-type': 'application/octet-stream' },
      body: chunked, duplex: 'half',
    })).status, 413);
    let status;
    for (let i = 0; i < 21; i++) status = (await request('/api/flyreq/tasks', { method: 'POST', headers, body: '{}' })).status;
    assert.equal(status, 429);
    await stop();
    const db = new Database(path.join(directory, 'tasks.sqlite'));
    const columns = db.prepare('PRAGMA table_info(tasks)').all();
    const row = { id: 'restart-test', status: 'processing', request_json: '{}', created_at: new Date().toISOString() };
    for (const column of columns) if (column.notnull && row[column.name] === undefined && column.dflt_value === null) row[column.name] = '';
    db.prepare(`INSERT INTO tasks (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
    db.close();
    await start();
    const recovered = new Database(path.join(directory, 'tasks.sqlite'));
    assert.equal(recovered.prepare('SELECT status FROM tasks WHERE id = ?').get('restart-test').status, 'interrupted');
    recovered.close();
  } finally {
    await stop();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('aipic-security-'));
    await rm(directory, { recursive: true, force: true });
  }
});
