const { fail } = require('./policy.cjs');

function createLimiter({ requests = 20, windowMs = 60000, concurrency = 4, globalConcurrency = 16 } = {}) {
  const buckets = new Map();
  let active = 0;
  return function acquire(key, now = Date.now()) {
    for (const [id, bucket] of buckets) if (!bucket.active && now - bucket.start >= windowMs) buckets.delete(id);
    const bucket = buckets.get(key) || { start: now, count: 0, active: 0 };
    if (now - bucket.start >= windowMs) { bucket.start = now; bucket.count = 0; }
    if (bucket.count >= requests || bucket.active >= concurrency || active >= globalConcurrency || buckets.size >= 10000 && !buckets.has(key)) fail(429, '请求频率或并发超过限制');
    bucket.count++;
    bucket.active++;
    active++;
    buckets.set(key, bucket);
    let released = false;
    return () => { if (!released) { released = true; bucket.active--; active--; } };
  };
}
module.exports = { createLimiter };
