// Persistent state for the local demo API: products, categories, orders and settings.
// Saved to runtime/store.json after every change, so admin edits survive a restart. Delete that folder (or use
// "Reset demo data" in the admin Settings) to start again from catalogue.json. Not a database; one process, one file.
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { seedState } from './data.mjs';

// MOCK_RUNTIME_DIR lets the automated tests use a throw-away folder
const DIR = process.env.MOCK_RUNTIME_DIR ? pathToFileURL(`${process.env.MOCK_RUNTIME_DIR.replace(/\/$/, '')}/`) : new URL('./runtime/', import.meta.url);
const FILE = new URL('store.json', DIR);

const shapeOk = (s) => s && Array.isArray(s.products) && Array.isArray(s.categories) && Array.isArray(s.orders) && s.config?.hours && s.config?.bulk;

function load() {
  try {
    if (existsSync(FILE)) {
      const s = JSON.parse(readFileSync(FILE, 'utf8'));
      if (shapeOk(s)) return s;
      console.warn('runtime/store.json has an unexpected shape: starting from the seed data');
    }
  } catch (e) {
    console.warn('runtime/store.json could not be read: starting from the seed data', e.message);
  }
  return seedState();
}

export const state = load();

export function save() {
  mkdirSync(DIR, { recursive: true });
  const tmp = new URL('store.json.tmp', DIR);
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, FILE);
}

/** Back to the catalogue.json seed (orders, edits and settings are dropped). Uploaded photos are kept. */
export function resetState() {
  const fresh = seedState();
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, fresh);
  rmSync(FILE, { force: true });
}
