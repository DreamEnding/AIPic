// Optional service binding for custom providers. No public Worker route.
// Node performs connection-time DNS validation and denies redirects.
import policy from '../../backend/security/policy.cjs';

export default {
  async fetch(request, env) {
    if (!env.NODE_EGRESS_URL || !env.NODE_EGRESS_TOKEN) return new Response('Egress not configured', { status: 503 });
    const requested = policy.validateUrl(request.url);
    const base = Object.values(policy.providers(env)).find(value => requested.href.startsWith(`${value}/`));
    if (!base) return new Response('Provider not allowed', { status: 403 });
    const target = policy.validateUrl(env.NODE_EGRESS_URL);
    target.pathname = `/api-proxy/${requested.pathname.slice(new URL(base).pathname.length + 1)}`;
    target.search = requested.search;
    const headers = new Headers(request.headers);
    headers.set('x-aipic-access-token', env.NODE_EGRESS_TOKEN);
    headers.set('x-aipic-upstream', base);
    headers.delete('host');
    return fetch(new Request(target, { method: request.method, headers, body: request.body, duplex: 'half', redirect: 'manual', signal: request.signal }));
  },
};
