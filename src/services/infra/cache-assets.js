const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../../utils/logger');

const CACHE_DIR = path.join(process.cwd(), 'data', 'cache');
const AUDIO_CACHE_DIR = path.join(CACHE_DIR, 'audio');
const IMAGE_CACHE_DIR = path.join(CACHE_DIR, 'img');
const CACHE_URL_BASE = 'http://cache-cleanup.local';
const CATALOG_FILES = [
  path.join(process.cwd(), 'regalos_tiktok.json'),
  path.join(process.cwd(), 'minecraft_renders.json')
];

function safeJsonParse(input, fallback) {
  try {
    return JSON.parse(input);
  } catch {
    return fallback;
  }
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseCacheAsset(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return null;

  let pathname = '';

  try {
    pathname = new URL(value, CACHE_URL_BASE).pathname || '';
  } catch {
    return null;
  }

  if (pathname.startsWith('/cache/audio/')) {
    const fileName = path.posix.basename(pathname);
    if (!fileName || fileName === '.' || fileName === '..') return null;
    return { type: 'audio', fileName };
  }

  if (pathname.startsWith('/cache/img/')) {
    const fileName = path.posix.basename(pathname);
    if (!fileName || fileName === '.' || fileName === '..') return null;
    return { type: 'img', fileName };
  }

  return null;
}

function collectImageFileNamesFromValue(value, output = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectImageFileNamesFromValue(item, output);
    }
    return output;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectImageFileNamesFromValue(item, output);
    }
    return output;
  }

  if (typeof value !== 'string') return output;

  const parsed = parseCacheAsset(value);
  if (parsed?.type === 'img') {
    output.add(parsed.fileName);
  }

  return output;
}

function collectHttpUrls(value, output = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectHttpUrls(item, output);
    }
    return output;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectHttpUrls(item, output);
    }
    return output;
  }

  if (typeof value !== 'string') return output;

  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return output;

  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) return output;
    output.add(trimmed);
  } catch {
    // Ignore malformed URLs
  }

  return output;
}

function getCachedImageFileNameFromRemoteUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    const extFromUrl = path.extname(parsed.pathname) || '.png';
    const ext = extFromUrl.toLowerCase().split('?')[0] || '.png';
    const hash = crypto.createHash('sha1').update(trimmed).digest('hex');
    return `${hash}${ext}`;
  } catch {
    return '';
  }
}

function getProtectedCatalogImageFileNames() {
  const fileNames = new Set();

  for (const file of CATALOG_FILES) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = safeJsonParse(fs.readFileSync(file, 'utf8'), null);
      if (!parsed) continue;

      const urls = collectHttpUrls(parsed);
      for (const url of urls) {
        const fileName = getCachedImageFileNameFromRemoteUrl(url);
        if (fileName) fileNames.add(fileName);
      }
    } catch (error) {
      logger.warn(`No se pudo leer catalogo para proteccion de cache (${file}): ${error?.message || error}`);
    }
  }

  return fileNames;
}

function getAudioRefFileNames(db) {
  const fileNames = new Set();

  const actionRows = db.prepare(`
    SELECT audio_asset
    FROM actions
    WHERE audio_asset IS NOT NULL AND audio_asset <> ''
  `).all();

  for (const row of actionRows) {
    const parsed = parseCacheAsset(row.audio_asset);
    if (parsed?.type === 'audio') fileNames.add(parsed.fileName);
  }

  const galleryRows = db.prepare(`
    SELECT audio_asset
    FROM gallery_actions
    WHERE audio_asset IS NOT NULL AND audio_asset <> ''
  `).all();

  for (const row of galleryRows) {
    const parsed = parseCacheAsset(row.audio_asset);
    if (parsed?.type === 'audio') fileNames.add(parsed.fileName);
  }

  return fileNames;
}

function getImageRefFileNames(db) {
  const fileNames = new Set();

  const overlayRows = db.prepare(`
    SELECT elements_json, groups_json, preview
    FROM overlays
  `).all();

  for (const row of overlayRows) {
    collectImageFileNamesFromValue(safeJsonParse(row.elements_json, []), fileNames);
    collectImageFileNamesFromValue(safeJsonParse(row.groups_json, []), fileNames);
    collectImageFileNamesFromValue(row.preview || '', fileNames);
  }

  return fileNames;
}

function deleteFileIfExists(absPath) {
  try {
    if (fs.existsSync(absPath)) {
      fs.unlinkSync(absPath);
      return true;
    }
  } catch (error) {
    logger.warn(`No se pudo borrar cache ${absPath}: ${error?.message || error}`);
  }

  return false;
}

function cleanupOrphanAudioAsset(db, assetPath) {
  const parsed = parseCacheAsset(assetPath);
  if (!parsed || parsed.type !== 'audio') return { checked: false, deleted: false };

  const refs = getAudioRefFileNames(db);
  if (refs.has(parsed.fileName)) {
    return { checked: true, deleted: false, reason: 'still-referenced' };
  }

  const absPath = path.join(AUDIO_CACHE_DIR, parsed.fileName);
  if (!absPath.startsWith(AUDIO_CACHE_DIR)) {
    return { checked: true, deleted: false, reason: 'invalid-path' };
  }

  return {
    checked: true,
    deleted: deleteFileIfExists(absPath)
  };
}

function cleanupOrphanImageAsset(db, assetPath) {
  const parsed = parseCacheAsset(assetPath);
  if (!parsed || parsed.type !== 'img') return { checked: false, deleted: false };

  const protectedFileNames = getProtectedCatalogImageFileNames();
  if (protectedFileNames.has(parsed.fileName)) {
    return { checked: true, deleted: false, reason: 'protected-catalog' };
  }

  const refs = getImageRefFileNames(db);
  if (refs.has(parsed.fileName)) {
    return { checked: true, deleted: false, reason: 'still-referenced' };
  }

  const absPath = path.join(IMAGE_CACHE_DIR, parsed.fileName);
  if (!absPath.startsWith(IMAGE_CACHE_DIR)) {
    return { checked: true, deleted: false, reason: 'invalid-path' };
  }

  return {
    checked: true,
    deleted: deleteFileIfExists(absPath)
  };
}

function getOverlayImageAssetPaths(overlay) {
  const fileNames = new Set();

  if (!overlay || typeof overlay !== 'object') return [];

  collectImageFileNamesFromValue(overlay.elements || [], fileNames);
  collectImageFileNamesFromValue(overlay.groups || [], fileNames);
  collectImageFileNamesFromValue(overlay.preview || '', fileNames);

  return Array.from(fileNames).map((fileName) => `/cache/img/${fileName}`);
}

function cleanupRemovedOverlayAssets(db, previousOverlay, nextOverlay) {
  const previousAssets = new Set(getOverlayImageAssetPaths(previousOverlay));
  const nextAssets = new Set(getOverlayImageAssetPaths(nextOverlay));

  const removed = [];
  for (const assetPath of previousAssets) {
    if (!nextAssets.has(assetPath)) {
      removed.push(assetPath);
    }
  }

  for (const assetPath of removed) {
    cleanupOrphanImageAsset(db, assetPath);
  }
}

function normalizeGalleryAudioPayload(source = {}) {
  return {
    audioEnabled: !!source.audioEnabled,
    audioAsset: String(source.audioAsset || '').trim(),
    audioVolume: clampInt(source.audioVolume, 0, 100, 70),
    audioWaitForFinish: !!source.audioWaitForFinish,
    audioReplaceCurrent: !!source.audioReplaceCurrent,
    audioPlayOncePerCombo: source.audioPlayOncePerCombo === false ? false : true
  };
}

module.exports = {
  cleanupOrphanAudioAsset,
  cleanupOrphanImageAsset,
  cleanupRemovedOverlayAssets,
  getOverlayImageAssetPaths,
  normalizeGalleryAudioPayload,
  parseCacheAsset
};