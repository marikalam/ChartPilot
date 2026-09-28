import type { Library, Site, Doc } from './types';

// The rulebook and style library live in this browser's IndexedDB - they can
// be several MB, too big for localStorage. Nothing about patients is stored.
const DB_NAME = 'chartpilot';
const STORE = 'kv';
const KEY = 'library';

export function uid() {
  return crypto.randomUUID();
}

export function emptyLibrary(): Library {
  return {
    version: 1,
    rulebook: [],
    personalStyle: '',
    sites: [],
    settings: { evidenceProvider: 'claude', webSearch: true, defaultSiteId: null, defaultNoteType: 'H&P' },
  };
}

export function newSite(name = 'New hospital'): Site {
  return { id: uid(), name, styleGuide: '', template: '', examples: [] };
}

export function newDoc(name: string, text: string): Doc {
  return { id: uid(), name, text, addedAt: new Date().toISOString() };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadLibrary(): Promise<Library> {
  try {
    const db = await openDb();
    const value = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return value ? normalize(value) : emptyLibrary();
  } catch {
    return emptyLibrary();
  }
}

export async function saveLibrary(lib: Library): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(lib, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Accepts an exported library file (or a stored value from an older version)
// and fills in anything missing.
export function normalize(value: unknown): Library {
  const base = emptyLibrary();
  if (!value || typeof value !== 'object') return base;
  const v = value as Partial<Library>;
  return {
    version: 1,
    rulebook: Array.isArray(v.rulebook) ? v.rulebook.filter(isDoc) : [],
    personalStyle: typeof v.personalStyle === 'string' ? v.personalStyle : '',
    sites: Array.isArray(v.sites)
      ? v.sites.map((s) => ({
          ...newSite(),
          ...s,
          examples: Array.isArray(s.examples) ? s.examples.filter(isDoc) : [],
        }))
      : [],
    settings: { ...base.settings, ...(v.settings ?? {}) },
  };
}

function isDoc(d: unknown): d is Doc {
  return !!d && typeof (d as Doc).name === 'string' && typeof (d as Doc).text === 'string';
}
