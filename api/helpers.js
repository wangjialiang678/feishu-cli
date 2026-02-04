import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export async function readToken(tokenPath) {
  const raw = await fs.readFile(tokenPath, 'utf8');
  const token = raw.trim();
  if (!token) {
    throw new Error(`Token file is empty (${tokenPath}). Run npm run auth first.`);
  }
  return token;
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

export function expandHomeDir(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === '~') return os.homedir() || inputPath;
  if (inputPath.startsWith('~/')) {
    const home = os.homedir() || '';
    return path.join(home, inputPath.slice(2));
  }
  return inputPath;
}

export function extractDocumentId(input) {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  const cleaned = trimmed.replace(/[?#].*$/, '').replace(/\/+$/, '');
  const parts = cleaned.split('/').filter(Boolean);
  return parts[parts.length - 1] || trimmed;
}
