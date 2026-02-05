import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const CONFIG_PATH = path.resolve(__dirname, 'config.json');

export async function readConfig() {
  let raw;
  try {
    raw = await fs.readFile(CONFIG_PATH, 'utf8');
  } catch (err) {
    throw new Error(
      `Missing config.json.\n\n` +
      `  Quick setup:\n` +
      `    1. cp config.example.json config.json\n` +
      `    2. Edit config.json — fill in your Feishu App ID and App Secret\n` +
      `    3. Run: npm run auth\n\n` +
      `  Need a Feishu app first? See README.md "飞书应用配置" section.\n` +
      `  Path: ${CONFIG_PATH}`
    );
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${CONFIG_PATH}: ${err.message}`);
  }

  if (!data || typeof data !== 'object') {
    throw new Error(`config.json must contain a JSON object.`);
  }

  return data;
}

function getConfigValue(config, keyPath) {
  return keyPath.split('.').reduce((acc, key) => {
    if (!acc || typeof acc !== 'object') return undefined;
    return acc[key];
  }, config);
}

const CONFIG_HINTS = {
  'auth.clientId': 'Get it from https://open.feishu.cn/app → your app → Credentials (App ID)',
  'auth.clientSecret': 'Get it from https://open.feishu.cn/app → your app → Credentials (App Secret)',
  'tokenPath': 'Add "tokenPath": "./user-token.txt" to config.json',
};

export function requireConfigValue(config, keyPath) {
  const value = getConfigValue(config, keyPath);
  if (value === undefined || value === null || value === '') {
    const hint = CONFIG_HINTS[keyPath];
    const msg = `Missing "${keyPath}" in config.json.`;
    throw new Error(hint ? `${msg}\n  Hint: ${hint}` : msg);
  }
  return value;
}

export function resolvePath(inputPath) {
  if (!inputPath) return inputPath;
  let resolved = inputPath;
  if (resolved === '~') {
    resolved = process.env.HOME || resolved;
  } else if (resolved.startsWith('~/')) {
    resolved = path.join(process.env.HOME || '', resolved.slice(2));
  }
  if (path.isAbsolute(resolved)) return resolved;
  return path.resolve(__dirname, resolved);
}
