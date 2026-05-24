import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const OWN_DIR = path.join(DATA_DIR, 'own');
export const CACHE_DIR = path.join(DATA_DIR, 'cache');
export const DB_PATH = path.join(DATA_DIR, 'index.sqlite');
export const UI_DIST = path.join(ROOT, 'dist', 'ui');

export const PORT = Number(process.env.PORT ?? 3000);
export const HOST = process.env.HOST ?? '0.0.0.0';

export const DEFAULT_TTL_HOURS = 24;
