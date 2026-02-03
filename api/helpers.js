import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

export async function readToken(tokenPath) {
  const raw = await fs.readFile(tokenPath, 'utf8');
  const token = raw.trim();
  if (!token) {
    throw new Error(`Token file is empty (${tokenPath}). Run npm run auth first.`);
  }
  return token;
}

export async function hashFile(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

export async function readManifest(folder, manifestName) {
  if (!manifestName) {
    throw new Error('Missing manifestName for readManifest().');
  }
  const manifestPath = path.join(folder, manifestName);
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') {
      return { spaceId: '', docs: {} };
    }
    return {
      spaceId: data.spaceId || '',
      docs: data.docs && typeof data.docs === 'object' ? data.docs : {},
    };
  } catch (err) {
    return { spaceId: '', docs: {} };
  }
}

export async function writeManifest(folder, manifest, manifestName) {
  if (!manifestName) {
    throw new Error('Missing manifestName for writeManifest().');
  }
  const manifestPath = path.join(folder, manifestName);
  const output = {
    spaceId: manifest.spaceId || '',
    updatedAt: new Date().toISOString(),
    docs: manifest.docs || {},
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
}

export function sanitizeFilename(name) {
  return String(name || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[\s\p{Z}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
}

export function ensurePosixPath(value) {
  return value.split(path.sep).join('/');
}

export function expandHomeDir(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === '~') return os.homedir() || inputPath;
  if (inputPath.startsWith('~/')) {
    const home = os.homedir() || '';
    return path.join(home, inputPath.slice(2));
  }
  return inputPath;
}

export function resolveSyncFolder(folderInput) {
  return path.resolve(expandHomeDir(folderInput));
}

export function pickAppCredentials(config) {
  const auth = config.auth || {};
  const appId =
    process.env.FEISHU_APP_ID ||
    auth.clientId ||
    config.appId ||
    '';
  const appSecret =
    process.env.FEISHU_APP_SECRET ||
    auth.clientSecret ||
    config.appSecret ||
    '';
  if (!appId || !appSecret) {
    throw new Error(
      'Missing app credentials. Set auth.clientId/clientSecret (or FEISHU_APP_ID/FEISHU_APP_SECRET).'
    );
  }
  return { appId, appSecret };
}

export function normalizeLoggerLevel(level, loggerLevels) {
  const levels = loggerLevels || {};
  if (!level) {
    throw new Error('Missing realtime.loggerLevel in config.json.');
  }
  const key = String(level).toLowerCase();
  const map = {
    fatal: levels.fatal,
    debug: levels.debug,
    info: levels.info,
    warn: levels.warn,
    warning: levels.warn,
    error: levels.error,
    trace: levels.trace,
  };
  const resolved = map[key];
  if (!resolved) {
    throw new Error(
      `Unknown realtime.loggerLevel "${level}" in config.json. Expected one of: ${Object.keys(map).join(', ')}.`
    );
  }
  return resolved;
}

export function normalizeFileTypes(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('realtime.fileTypes must be a non-empty array in config.json.');
  }
  const normalized = new Set();
  for (const value of input) {
    if (!value) continue;
    normalized.add(String(value).toLowerCase());
  }
  if (!normalized.size) {
    throw new Error('realtime.fileTypes must include at least one non-empty value.');
  }
  return normalized;
}

export async function ensureUniqueFilePath(baseDir, fileName, usedPaths) {
  const base = fileName.replace(/\.md$/i, '');
  let candidate = `${base}.md`;
  let fullPath = path.join(baseDir, candidate);
  let counter = 1;
  while (usedPaths.has(ensurePosixPath(path.relative(baseDir, fullPath)))) {
    candidate = `${base}-${counter}.md`;
    fullPath = path.join(baseDir, candidate);
    counter += 1;
  }
  return ensurePosixPath(path.relative(baseDir, fullPath));
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (err) {
    return false;
  }
}

export async function deleteLocalFile(filePath) {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
}

export async function ensureUniqueFilePathWithFs(baseDir, fileName, usedPaths) {
  const base = fileName.replace(/\.md$/i, '');
  let candidate = `${base}.md`;
  let fullPath = path.join(baseDir, candidate);
  let counter = 1;
  while (
    usedPaths.has(ensurePosixPath(path.relative(baseDir, fullPath))) ||
    (await fileExists(fullPath))
  ) {
    candidate = `${base}-${counter}.md`;
    fullPath = path.join(baseDir, candidate);
    counter += 1;
  }
  return ensurePosixPath(path.relative(baseDir, fullPath));
}

export function shouldSyncLocalPath(relPath, manifestName) {
  if (!manifestName) {
    throw new Error('Missing manifestName for shouldSyncLocalPath().');
  }
  if (!relPath) return false;
  const normalized = relPath.replace(/\\\\/g, '/');
  const baseName = path.basename(normalized);
  if (!baseName) return false;
  if (baseName === manifestName) return false;
  if (baseName.startsWith('.')) return false;
  const lower = baseName.toLowerCase();
  if (!lower.endsWith('.md')) return false;
  if (lower.endsWith('.remote.md')) return false;
  return true;
}

export function startLocalWatcher(rootDir, options) {
  const {
    onChange,
    logEvents,
    localIgnoreWindowMs,
    getLastProcessCompletedAt,
    isProcessing,
    shouldIgnoreLocal,
    manifestName,
  } = options;
  if (!manifestName) {
    throw new Error('Missing manifestName for startLocalWatcher().');
  }

  let watcher;
  try {
    watcher = fsSync.watch(rootDir, { recursive: true }, async (_eventType, filename) => {
      if (shouldIgnoreLocal && shouldIgnoreLocal()) {
        if (logEvents) {
          console.log('[realtime-sync] ignored local change during poll');
        }
        return;
      }
      const relPath = filename ? String(filename) : '';
      if (relPath && !shouldSyncLocalPath(relPath, manifestName)) return;
      if (isProcessing()) return;

      const lastProcessCompletedAt = getLastProcessCompletedAt();
      if (relPath && lastProcessCompletedAt) {
        try {
          const fullPath = path.join(rootDir, relPath);
          const stat = await fs.stat(fullPath);
          if (stat.mtimeMs <= lastProcessCompletedAt + localIgnoreWindowMs) {
            if (logEvents) {
              console.log(`[realtime-sync] ignored local change from sync: ${relPath}`);
            }
            return;
          }
        } catch (err) {
          if (err && err.code === 'ENOENT') {
            if (Date.now() <= lastProcessCompletedAt + localIgnoreWindowMs) {
              if (logEvents) {
                console.log(`[realtime-sync] ignored local delete from sync: ${relPath}`);
              }
              return;
            }
          } else if (err) {
            console.warn(`[realtime-sync] local stat failed: ${err.message || err}`);
          }
        }
      }

      onChange(relPath || 'local');
    });
  } catch (err) {
    console.error(`[realtime-sync] failed to start local watcher: ${err.message || err}`);
    return null;
  }

  watcher.on('error', (err) => {
    console.error(`[realtime-sync] local watcher error: ${err.message || err}`);
  });

  console.log(`[realtime-sync] watching local folder ${rootDir}`);
  return watcher;
}

export function buildConflictPath(relPath) {
  if (relPath.toLowerCase().endsWith('.md')) {
    return relPath.replace(/\.md$/i, '.remote.md');
  }
  return `${relPath}.remote.md`;
}

export function resolveFileType(doc, existing) {
  return doc?.fileType || existing?.fileType || 'docx';
}

export function extractDocumentId(input) {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  const cleaned = trimmed.replace(/[?#].*$/, '').replace(/\/+$/, '');
  const parts = cleaned.split('/').filter(Boolean);
  return parts[parts.length - 1] || trimmed;
}
