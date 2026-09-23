const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPublicLookup, safeFetch } = require('../backend/security/outbound-url');
const { validateUrl, selectUpstream, validateImages, MAX_IMAGE_BYTES, authenticate } = require('../backend/security/policy.cjs');
const { createLimiter } = require('../backend/security/rate-limit');
const { redact } = require('../backend/security/redact');

test('rejects local, metadata, alternate IP encodings and non-HTTPS URLs', () => {
  for (const url of ['http://example.com', 'https://localhost', 'https://localhost.', 'https://127.1', 'https://2130706433', 'https://0x7f000001', 'https://169.254.169.254', 'https://100.100.100.200', 'https://10.1.2.3', 'https://172.31.0.1', 'https://192.168.1.1', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://[fc00::1]', 'https://[fe80::1]', 'https://user:secret@example.com']) assert.throws(() => validateUrl(url), { statusCode: 403 }, url);
});

test('DNS connector rejects every private answer, including mixed records and rebinding', async () => {
  let records = [{ address: '8.8.8.8', family: 4 }];
  const lookup = createPublicLookup((host, options, callback) => callback(null, records));
  const resolve = () => new Promise((yes, no) => lookup('allowed.example', {}, (error, address) => error ? no(error) : yes(address)));
  assert.equal(await resolve(), '8.8.8.8');
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', 'fc00::1', 'fe80::1']) {
    records = [{ address: '8.8.8.8', family: 4 }, { address, family: address.includes(':') ? 6 : 4 }];
    await assert.rejects(resolve, { code: 'OUTBOUND_BLOCKED' });
  }
});

test('fetch invokes the guarded connector instead of resolving a second time', async () => {
  const dns = require('node:dns');
  const original = dns.lookup;
  const modulePath = require.resolve('../backend/security/outbound-url');
  let lookups = 0;
  dns.lookup = (hostname, options, callback) => { lookups++; callback(null, [{ address: '127.0.0.1', family: 4 }]); };
  delete require.cache[modulePath];
  try {
    const guarded = require(modulePath);
    await assert.rejects(() => guarded.safeFetch('https://attacker.example/v1'), error => error.cause?.code === 'OUTBOUND_BLOCKED');
    assert.equal(lookups, 1);
  } finally { dns.lookup = original; delete require.cache[modulePath]; }
});

test('redirect is never followed and upstream errors never echo secrets', async () => {
  const client = require('../backend/node_modules/undici');
  const original = client.fetch;
  const calls = [];
  try {
    client.fetch = async (url, init) => { calls.push(init); return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1' } }); };
    await assert.rejects(() => safeFetch('https://api.openai.com/v1'), /重定向/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].redirect, 'manual');
    assert.ok(calls[0].dispatcher);
    client.fetch = async () => new Response('arbitrary-secret-value', { status: 400 });
    assert.ok(!(await (await safeFetch('https://api.openai.com/v1')).text()).includes('arbitrary-secret-value'));
  } finally { client.fetch = original; }
});

test('server-side provider selection, authentication and image limits fail closed', () => {
  assert.throws(() => selectUpstream({}, '', 'https://evil.example/v1'), { statusCode: 403 });
  assert.equal(selectUpstream({ AIPIC_PROVIDERS: '{"custom":"https://allowed.example/v1"}' }, 'custom'), 'https://allowed.example/v1');
  assert.throws(() => authenticate(new Headers(), {}), { statusCode: 503 });
  assert.throws(() => authenticate(new Headers({ authorization: 'Bearer provider-key' }), { AIPIC_ACCESS_TOKEN: 'app-key' }), { statusCode: 401 });
  assert.throws(() => validateImages({ images: Array(9).fill({ data: 'AA==' }) }), { statusCode: 413 });
  assert.throws(() => validateImages({ images: [{ data: 'A'.repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 1) }] }), { statusCode: 413 });
});

test('rate limits and concurrency release cannot be bypassed or double released', () => {
  const acquire = createLimiter({ requests: 2, concurrency: 1, globalConcurrency: 1 });
  const release = acquire('one', 0);
  assert.throws(() => acquire('one', 0), { statusCode: 429 });
  assert.throws(() => acquire('two', 0), { statusCode: 429 });
  release(); release();
  acquire('one', 0)();
  assert.throws(() => acquire('one', 0), { statusCode: 429 });
  acquire('one', 60001)();
});

test('redacts credentials and image bodies recursively', () => {
  const output = JSON.stringify(redact({ Authorization: 'Bearer abc', apiKey: 'abc', prompt: 'private', body: 'data:image/png;base64,AAAA', url: 'https://example.com/?token=abc&key=abc', detail: '{"prompt":"private","b64_json":"AAAA"}' }));
  assert.ok(!output.includes('abc'));
  assert.ok(!output.includes('private'));
  assert.ok(!output.includes('AAAA'));
});

test('readiness fails when SQLite is unavailable', () => {
  const { handleHealth } = require('../backend/routes/health');
  let status;
  assert.equal(handleHealth({}, {}, '/ready', { storageReady: true, db: { prepare() { throw new Error('database closed'); } }, sendJson: (_, code) => { status = code; } }), true);
  assert.equal(status, 503);
});

test('ACK only shortens live terminal tasks; it cannot expire active tasks or revive expired ones', () => {
  const Database = require('../backend/node_modules/better-sqlite3');
  const { acknowledgeTask } = require('../backend/storage/task-db');
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE tasks (id TEXT, status TEXT, expires_at TEXT)');
    const insert = db.prepare('INSERT INTO tasks VALUES (?, ?, ?)');
    insert.run('active', 'processing', null);
    insert.run('done', 'completed', new Date(600000).toISOString());
    insert.run('expired', 'failed', new Date(0).toISOString());
    assert.equal(acknowledgeTask(db, 'active', 1000), 0);
    assert.equal(acknowledgeTask(db, 'expired', 1000), 0);
    assert.equal(acknowledgeTask(db, 'done', 1000), 1);
    assert.equal(db.prepare('SELECT expires_at FROM tasks WHERE id = ?').get('done').expires_at, new Date(121000).toISOString());
    acknowledgeTask(db, 'done', 2000);
    assert.equal(db.prepare('SELECT expires_at FROM tasks WHERE id = ?').get('done').expires_at, new Date(121000).toISOString());
  } finally { db.close(); }
});
