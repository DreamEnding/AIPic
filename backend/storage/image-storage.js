// Adapted from FlyReq Image Studio; AGPL-3.0-only. See ../LICENSE.
function createImageStorage({ fs, IMAGE_DIR, path, VIDEO_DIR }) {
// ===== Image Storage Service =====

/**
 * 确保图片结果目录可写，失败时记录错误并交由启动流程安全退出。
 * @returns {boolean} 目录可用时返回 true，创建失败时返回 false。
 */
function ensureImageDir() {
  try {
    if (!fs.existsSync(IMAGE_DIR)) {
      fs.mkdirSync(IMAGE_DIR, { recursive: true });
    }
    console.log(`[image-storage] 图片存储目录: ${IMAGE_DIR}`);
    return true;
  } catch (error) {
    console.error(`[image-storage] 无法创建图片存储目录: ${IMAGE_DIR}`, error);
    return false;
  }
}

function getImageExtension(mimeType) {
  if (mimeType?.includes('jpeg') || mimeType?.includes('jpg')) return 'jpg';
  if (mimeType?.includes('webp')) return 'webp';
  return 'png';
}

/**
 * 将生成图片写入磁盘，并返回可唯一定位子图的 HTTP 地址。
 * @param taskId 服务端任务标识。
 * @param itemIndex 任务内图片请求序号。
 * @param subIndex 单次上游响应中的子图序号。
 * @param imageBuffer 待保存的图片二进制数据。
 * @param mimeType 图片 MIME 类型。
 * @returns 保存路径与包含子图序号的图片访问地址。
 */
function saveImageToDisk(taskId, itemIndex, subIndex, imageBuffer, mimeType) {
  const ext = getImageExtension(mimeType);
  const fileName = `${taskId}-${itemIndex}-${subIndex}.${ext}`;
  const filePath = path.join(IMAGE_DIR, fileName);
  fs.writeFileSync(filePath, imageBuffer);
  return { filePath, httpUrl: `/api/flyreq/images/${taskId}/${itemIndex}/${subIndex}` };
}

/**
 * 确保视频结果目录存在，目录不可用时终止启动以避免产生不可取回任务。
 * @returns {boolean} 目录可用时返回 true，创建失败时返回 false。
 */
function ensureVideoDir() {
  try {
    if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });
    // 服务重启时清理上次异常退出留下的临时文件，最终视频文件不受影响。
    for (const name of fs.readdirSync(VIDEO_DIR)) {
      if (/^[a-f0-9-]+\.(?:mp4|webm|mov)\.part$/i.test(name)) fs.rmSync(path.join(VIDEO_DIR, name), { force: true });
    }
    console.log(`[video-storage] 视频存储目录: ${VIDEO_DIR}`);
    return true;
  } catch (error) {
    console.error(`[video-storage] 无法创建视频存储目录: ${VIDEO_DIR}`, error);
    return false;
  }
}

/**
 * 根据响应类型选择视频扩展名。
 * @param mimeType 上游视频响应的 MIME 类型。
 * @returns 受支持的视频文件扩展名。
 */
function getVideoExtension(mimeType) {
  if (mimeType?.includes('webm')) return 'webm';
  if (mimeType?.includes('quicktime')) return 'mov';
  return 'mp4';
}

/**
 * 查找指定任务已缓存的视频文件。
 * @param taskId 视频任务标识。
 * @returns 视频绝对路径；不存在时返回 null。
 */
function findTaskVideoFile(taskId) {
  if (!/^[a-f0-9-]+$/i.test(taskId) || !fs.existsSync(VIDEO_DIR)) return null;
  for (const ext of ['mp4', 'webm', 'mov']) {
    const candidate = path.join(VIDEO_DIR, `${taskId}.${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * 删除指定任务对应的视频结果文件。
 * @param taskId 视频任务标识。
 * @returns 无返回值。
 */
function deleteTaskVideoFile(taskId) {
  const filePath = findTaskVideoFile(taskId);
  if (filePath) {
    try { fs.unlinkSync(filePath); } catch { /* 文件已被清理时无需重复报错。 */ }
  }
}

/**
 * 通过支持 Range 的响应发送视频文件。
 * @param req 原始 HTTP 请求，用于读取 Range 请求头。
 * @param res 原始 HTTP 响应。
 * @param filePath 待发送的视频绝对路径。
 * @returns 无返回值，响应会在文件流结束后关闭。
 */
function sendVideoFile(req, res, filePath) {
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === '.webm' ? 'video/webm' : ext === '.mov' ? 'video/quicktime' : 'video/mp4';
  const range = String(req.headers.range || '');
  if (!range) {
    res.writeHead(200, { 'Content-Type': mimeType, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }
  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  let start;
  let end;
  if (match?.[1]) {
    // 普通范围 bytes=start-end；省略 end 时读取到文件末尾。
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
  } else if (match?.[2]) {
    // 后缀范围 bytes=-length 表示读取文件末尾 length 字节。
    const suffixLength = Number(match[2]);
    if (Number.isSafeInteger(suffixLength) && suffixLength > 0) {
      start = Math.max(0, stat.size - suffixLength);
      end = stat.size - 1;
    }
  }
  if (!match || start === undefined || end === undefined || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
    res.end();
    return;
  }
  res.writeHead(206, {
    'Content-Type': mimeType,
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  });
  fs.createReadStream(filePath, { start, end }).pipe(res);
}

function getTaskImageFiles(taskId) {
  try {
    if (!fs.existsSync(IMAGE_DIR)) return [];
    const prefix = `${taskId}-`;
    return fs.readdirSync(IMAGE_DIR)
      .filter(name => name.startsWith(prefix))
      .map(name => path.join(IMAGE_DIR, name));
  } catch {
    return [];
  }
}

function deleteImageFile(filePath, _taskId) {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: true, reason: 'not_found' };
    }
    fs.unlinkSync(filePath);
    return { success: true };
  } catch (error) {
    console.warn(`[image-lifecycle] 删除文件失败: ${filePath}`, error?.message || error);
    return { success: false, reason: error?.message || String(error) };
  }
}

function deleteTaskImageFiles(taskId) {
  const files = getTaskImageFiles(taskId);
  let successCount = 0;
  let notFoundCount = 0;
  let failedCount = 0;
  for (const filePath of files) {
    const result = deleteImageFile(filePath, taskId);
    if (result.success && result.reason === 'not_found') {
      notFoundCount++;
    } else if (result.success) {
      successCount++;
    } else {
      failedCount++;
    }
  }
  console.log(`[image-lifecycle] 任务图片清理完成: taskId=${taskId}, total=${files.length}, success=${successCount}, notFound=${notFoundCount}, failed=${failedCount}`);
  return { total: files.length, success: successCount, notFound: notFoundCount, failed: failedCount };
}
return { ensureImageDir, getImageExtension, saveImageToDisk, ensureVideoDir, getVideoExtension, findTaskVideoFile, deleteTaskVideoFile, sendVideoFile, getTaskImageFiles, deleteImageFile, deleteTaskImageFiles };
}
module.exports = { createImageStorage };
