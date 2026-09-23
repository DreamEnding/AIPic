// Adapted from FlyReq Image Studio; AGPL-3.0-only. See ../LICENSE.
function createTaskDatabase({ db, TASK_STATUS, TASK_TTL_MS, deleteTaskImageFiles }) {
function initDatabase() {
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      request_json TEXT NOT NULL,
      result_json TEXT,
      error TEXT,
      warning TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      expires_at TEXT
    );
    CREATE TABLE IF NOT EXISTS task_items (
      task_id TEXT NOT NULL,
      item_index INTEGER NOT NULL,
      status TEXT NOT NULL,
      image_data TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      PRIMARY KEY (task_id, item_index)
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_expires_at ON tasks(expires_at);
    CREATE INDEX IF NOT EXISTS idx_task_items_task_id ON task_items(task_id);
  `);

  const now = new Date().toISOString();
  db.prepare('UPDATE tasks SET status = ? WHERE status = ?').run(TASK_STATUS.QUEUED, TASK_STATUS.LEGACY_QUEUED);
  db.prepare('UPDATE task_items SET status = ? WHERE status = ?').run(TASK_STATUS.QUEUED, TASK_STATUS.LEGACY_QUEUED);
  const interruptedIds = db.prepare(`
    SELECT id FROM tasks WHERE status IN (?, ?)
  `).all(TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING).map(r => r.id);
  db.prepare(`
    UPDATE tasks
    SET status = 'interrupted', error = ?, completed_at = ?, expires_at = ?
    WHERE status IN (?, ?)
  `).run('服务器重启，任务已中断，请重新生成', now, new Date(Date.now() + TASK_TTL_MS).toISOString(), TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING);
  db.prepare("UPDATE task_items SET status = 'interrupted', completed_at = ? WHERE status IN (?, ?)").run(now, TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING);
  for (const id of interruptedIds) {
    deleteTaskImageFiles(id);
  }
}
return { initDatabase };
}
function acknowledgeTask(db, taskId, timestamp = Date.now()) {
  const now = new Date(timestamp).toISOString();
  const expiry = new Date(timestamp + 120000).toISOString();
  return db.prepare(`
    UPDATE tasks SET expires_at = MIN(COALESCE(expires_at, ?), ?)
    WHERE id = ? AND status IN ('completed', 'failed', 'interrupted', 'cancelled')
      AND (expires_at IS NULL OR expires_at > ?)
  `).run(expiry, expiry, taskId, now).changes;
}
module.exports = { createTaskDatabase, acknowledgeTask };
