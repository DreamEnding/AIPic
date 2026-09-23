const { authenticate } = require('./policy.cjs');

function authorizeRequest(req, env) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
  return authenticate(headers, env);
}
module.exports = { authorizeRequest };
