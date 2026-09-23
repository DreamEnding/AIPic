// Adapted from FlyReq Image Studio; AGPL-3.0-only. See ../LICENSE.
function createImageRoutes({ sendJson, path, fs, IMAGE_DIR, pipeFileToResponse, getContentType, findTaskVideoFile, sendVideoFile }) {
  async function handleImages(req, res, pathname) {
    const apiPathname = pathname.replace(/\/+$/, '');
    const imageMatch = apiPathname.match(/^\/api\/flyreq\/images\/([^/]+)\/(\d+)(?:\/(\d+))?$/);
    if (req.method === 'GET' && imageMatch) {
      const taskId = imageMatch[1];
      const index = Number(imageMatch[2]);
      const hasSubIndex = imageMatch[3] !== undefined;
      const subIndex = hasSubIndex ? Number(imageMatch[3]) : 0;
      if (!/^[a-zA-Z0-9-]+$/.test(taskId)) {
        sendJson(res, 400, { error: 'Invalid taskId' });
        return true;
      }
      try {
        if (!fs.existsSync(IMAGE_DIR)) {
          sendJson(res, 404, { error: 'Not Found' });
          return true;
        }
        // 常见情况：扩展名 png/jpg/webp，直接拼路径命中，
        // 避免对整个 IMAGE_DIR 做同步 readdir 全目录扫描（随图片数线性变慢）。
        let filePath = null;
        for (const ext of ['png', 'jpg', 'webp']) {
          const candidate = path.join(IMAGE_DIR, `${taskId}-${index}-${subIndex}.${ext}`);
          if (fs.existsSync(candidate)) { filePath = candidate; break; }
        }
        // 旧任务地址不含 subIndex 时保留首个子图兼容回退；新地址必须精确命中。
        if (!filePath && !hasSubIndex) {
          const prefix = `${taskId}-${index}-`;
          const files = fs.readdirSync(IMAGE_DIR)
            .filter(name => name.startsWith(prefix))
            .sort();
          if (files.length > 0) filePath = path.join(IMAGE_DIR, files[0]);
        }
        if (!filePath) {
          sendJson(res, 404, { error: 'Not Found' });
          return true;
        }
        const stat = fs.statSync(filePath);
        pipeFileToResponse(res, filePath, 200, {
          'Content-Type': getContentType(filePath),
          'Content-Length': stat.size,
          'Cache-Control': 'private, max-age=3600',
        });
      } catch {
        sendJson(res, 404, { error: 'Not Found' });
      }
      return true;
    }

    const videoFileMatch = apiPathname.match(/^\/api\/flyreq\/videos\/([^/]+)$/);
    if (req.method === 'GET' && videoFileMatch) {
      const filePath = findTaskVideoFile(videoFileMatch[1]);
      if (!filePath) {
        sendJson(res, 404, { error: 'Not Found' });
        return true;
      }
      sendVideoFile(req, res, filePath);
      return true;
    }


    return false;
  }
  return { handleImages };
}
module.exports = { createImageRoutes };
