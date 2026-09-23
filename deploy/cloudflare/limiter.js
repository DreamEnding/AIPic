// AGPL-3.0-only: server-side resource protection for the Pages proxy.
// A single named Durable Object serializes admission across all Pages isolates.
export class AipicLimiter {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const input = await request.json();
    return this.state.storage.transaction(async storage => {
      const now = Date.now();
      const record = await storage.get('limits') || { start: now, count: 0, leases: {} };
      for (const [id, expires] of Object.entries(record.leases)) if (expires <= now) delete record.leases[id];
      if (input.action === 'release') {
        delete record.leases[input.lease];
        await storage.put('limits', record);
        return Response.json({ ok: true });
      }
      if (now - record.start >= 60000) { record.start = now; record.count = 0; }
      if (record.count >= 20 || Object.keys(record.leases).length >= 4) return Response.json({ error: '请求频率或并发超过限制' }, { status: 429 });
      const lease = crypto.randomUUID();
      record.count++;
      record.leases[lease] = now + 3630000;
      await storage.put('limits', record);
      return Response.json({ lease });
    });
  }
}
export default { fetch() { return new Response('Not Found', { status: 404 }); } };
