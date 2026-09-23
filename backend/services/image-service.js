// Adapted from FlyReq Image Studio; AGPL-3.0-only. See ../LICENSE.
function createImageService({ parseImageSize, getGptImageSize, sharp, parseBooleanEnv, getRuntimeEnv, shouldAuthorizeRemoteImageDownload, fetchWithTimeout, getSafeUrlLabel, parseIntegerEnv, DEFAULT_REMOTE_IMAGE_MAX_BYTES, saveImageToDisk }) {
function getImageMimeType(format, fallback = 'image/png') {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  if (format === 'png') return 'image/png';
  return fallback;
}

function parseAspectRatio(aspectRatio) {
  const match = String(aspectRatio || '').match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return undefined;

  const decimalPlaces = Math.max(
    (match[1].split('.')[1] || '').length,
    (match[2].split('.')[1] || '').length,
  );
  const multiplier = 10 ** decimalPlaces;
  const width = Math.round(Number(match[1]) * multiplier);
  const height = Math.round(Number(match[2]) * multiplier);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function getImageLayoutTargetSize(request) {
  const customSize = parseImageSize(request.customSize);
  if (customSize) return customSize;

  const requestedSize = getGptImageSize(request.outputSize, request.aspectRatio);
  if (request.protocol === 'openai' && request.imageApiFlavor !== 'xai-imagine' && requestedSize) {
    return parseImageSize(requestedSize);
  }

  // Every supported provider uses 1024x1024 for the 1K square preset.
  if (request.outputSize === '1K' && request.aspectRatio === '1:1') {
    return { width: 1024, height: 1024 };
  }

  return undefined;
}

function getCenteredAspectCrop(width, height, aspectRatio) {
  const ratio = parseAspectRatio(aspectRatio);
  if (!ratio || width <= 0 || height <= 0) return undefined;

  const scale = Math.floor(Math.min(width / ratio.width, height / ratio.height));
  if (scale <= 0) return undefined;

  const cropWidth = scale * ratio.width;
  const cropHeight = scale * ratio.height;
  return {
    left: Math.floor((width - cropWidth) / 2),
    top: Math.floor((height - cropHeight) / 2),
    width: cropWidth,
    height: cropHeight,
  };
}

/**
 * Providers are asked for the requested layout first. This is a final guard for
 * OpenAI-compatible gateways that return an image with a different layout.
 */
async function enforceGeneratedImageLayout(imageBuffer, mimeType, request) {
  const metadata = await sharp(imageBuffer).metadata();
  const sourceWidth = metadata.width;
  const sourceHeight = metadata.height;
  if (!sourceWidth || !sourceHeight) {
    throw new Error('无法读取生成图片尺寸，无法确认输出比例');
  }

  const detectedMimeType = getImageMimeType(metadata.format, mimeType);
  // Preserve actual upstream pixels; never manufacture a 4K result by resizing.
  if (!parseBooleanEnv(getRuntimeEnv().AIPIC_ENFORCE_IMAGE_LAYOUT, false)) {
    return { buffer: imageBuffer, mimeType: detectedMimeType };
  }
  const targetSize = getImageLayoutTargetSize(request);
  if (targetSize && (sourceWidth !== targetSize.width || sourceHeight !== targetSize.height)) {
    const result = await sharp(imageBuffer)
      .rotate()
      .resize(targetSize.width, targetSize.height, { fit: 'cover', position: 'centre' })
      .toBuffer({ resolveWithObject: true });
    console.warn(`[image-layout] 已归一化图片尺寸: ${sourceWidth}x${sourceHeight} -> ${targetSize.width}x${targetSize.height}`);
    return {
      buffer: result.data,
      mimeType: getImageMimeType(result.info.format, detectedMimeType),
    };
  }

  if (!targetSize && request.aspectRatio !== 'auto') {
    const crop = getCenteredAspectCrop(sourceWidth, sourceHeight, request.aspectRatio);
    if (crop && (crop.width !== sourceWidth || crop.height !== sourceHeight)) {
      const result = await sharp(imageBuffer)
        .rotate()
        .extract(crop)
        .toBuffer({ resolveWithObject: true });
      console.warn(`[image-layout] 已归一化图片比例: ${sourceWidth}x${sourceHeight} -> ${crop.width}x${crop.height}`);
      return {
        buffer: result.data,
        mimeType: getImageMimeType(result.info.format, detectedMimeType),
      };
    }
  }

  return { buffer: imageBuffer, mimeType: detectedMimeType };
}

async function downloadUrlToDisk(taskId, itemIndex, subIndex, imageUrl, options = {}) {
  const headers = {};
  if (options.apiKey && shouldAuthorizeRemoteImageDownload(imageUrl, options.request)) {
    headers.Authorization = `Bearer ${options.apiKey}`;
  }
  const response = await fetchWithTimeout(imageUrl, { headers, signal: options.signal });
  if (!response.ok) {
    console.warn(`[image-download] 远程图片下载失败: status=${response.status} task=${taskId} item=${itemIndex} sub=${subIndex} url=${getSafeUrlLabel(imageUrl)}`);
    throw new Error(`远程图片下载失败: ${response.status}`);
  }
  const contentType = response.headers.get('content-type') || 'image/png';
  const maxBytes = parseIntegerEnv(getRuntimeEnv().FLYREQ_REMOTE_IMAGE_MAX_BYTES, DEFAULT_REMOTE_IMAGE_MAX_BYTES, {
    min: 1024,
    max: 200 * 1024 * 1024,
  });
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(`远程图片超过大小限制：最大 ${maxBytes} 字节`);
  }
  const buffer = await readResponseBufferWithLimit(response, maxBytes);
  const normalized = await enforceGeneratedImageLayout(buffer, contentType, options.request || {});
  return saveImageToDisk(taskId, itemIndex, subIndex, normalized.buffer, normalized.mimeType);
}

/**
 * 流式读取远程响应，并在超过字节上限时立即取消响应体。
 * @param {Response} response 已成功返回的远程图片响应。
 * @param {number} maxBytes 允许读取的最大字节数。
 * @returns {Promise<Buffer>} 未超过限制的完整响应体。
 */
async function readResponseBufferWithLimit(response, maxBytes) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error(`远程图片超过大小限制：最大 ${maxBytes} 字节`);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, totalBytes);
  } finally {
    reader.releaseLock();
  }
}
return { getImageMimeType, parseAspectRatio, getImageLayoutTargetSize, getCenteredAspectCrop, enforceGeneratedImageLayout, downloadUrlToDisk, readResponseBufferWithLimit };
}
module.exports = { createImageService };
