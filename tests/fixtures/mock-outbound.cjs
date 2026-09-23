const outbound = require('../../backend/security/outbound-url');
outbound.safeFetch = async (url, init) => Response.json({
  target: new URL(url).href,
  providerAuthorization: new Headers(init.headers).get('authorization'),
  applicationTokenForwarded: new Headers(init.headers).has('x-aipic-access-token'),
  upstreamHeaderForwarded: new Headers(init.headers).has('x-aipic-upstream'),
});
