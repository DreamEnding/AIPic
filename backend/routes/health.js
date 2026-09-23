function handleHealth(req, res, pathname, { db, storageReady, sendJson }) {
  if (pathname === '/health') { sendJson(res, 200, { ok: true }); return true; }
  if (pathname !== '/ready') return false;
  try {
    db.prepare('SELECT 1').get();
    if (!storageReady) throw new Error('Storage unavailable');
    sendJson(res, 200, { ok: true });
  } catch { sendJson(res, 503, { error: 'Storage unavailable' }); }
  return true;
}
module.exports = { handleHealth };
