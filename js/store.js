// Everything persisted on the device: settings, API caches, saved memes,
// recent uploads and user font files. IndexedDB via idb-keyval, with
// localStorage for the tiny synchronous bits.

import { get, set, del, keys } from '../vendor/idb-keyval.mjs';

const SETTINGS_KEY = 'mf.settings.v1';
const CACHE_PREFIX = 'mf.cache.';
const PROJECT_PREFIX = 'mf.project.';
const RECENTS_KEY = 'mf.recents';
const FONTFILES_KEY = 'mf.fontfiles';
const AUTOSAVE_KEY = 'mf.autosave';

let settings = { theme: 'dark', scale: 1, panel: 'templates' };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
} catch { /* defaults are fine */ }

export const getSetting = (key) => settings[key];

export function setSetting(key, value) {
  settings[key] = value;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* private mode, ignore */ }
}

/* ---- cached API responses ---- */

export async function cacheGet(key, maxAge) {
  try {
    const hit = await get(CACHE_PREFIX + key);
    if (hit && Date.now() - hit.at < maxAge) return hit.data;
  } catch { /* no IndexedDB, fall through */ }
  return null;
}

export async function cacheSet(key, data) {
  try {
    await set(CACHE_PREFIX + key, { at: Date.now(), data });
  } catch { /* quota, ignore */ }
}

/* ---- saved memes ---- */

export async function listProjects() {
  try {
    const all = await keys();
    const ids = all.filter((k) => typeof k === 'string' && k.startsWith(PROJECT_PREFIX));
    const projects = await Promise.all(ids.map((k) => get(k)));
    return projects.filter(Boolean).sort((a, b) => b.updated - a.updated);
  } catch {
    return [];
  }
}

export const saveProject = (project) => set(PROJECT_PREFIX + project.id, project);
export const getProject = (id) => get(PROJECT_PREFIX + id);
export const deleteProject = (id) => del(PROJECT_PREFIX + id);

/* ---- work in progress ---- */

export const saveAutosave = (snapshot) => set(AUTOSAVE_KEY, snapshot);
export const getAutosave = () => get(AUTOSAVE_KEY).catch(() => null);
export const clearAutosave = () => del(AUTOSAVE_KEY).catch(() => {});

/* ---- recently used pictures ---- */

export async function addRecent(entry) {
  try {
    const list = (await get(RECENTS_KEY)) || [];
    // Uploads are stored as data URLs, so keep this list short.
    const next = [entry, ...list.filter((r) => r.url !== entry.url)].slice(0, 8);
    await set(RECENTS_KEY, next);
    return next;
  } catch {
    return [];
  }
}

export const getRecents = async () => (await get(RECENTS_KEY).catch(() => null)) || [];

/* ---- user font files ---- */

export async function addFontFile(file) {
  try {
    const list = (await get(FONTFILES_KEY)) || [];
    if (list.some((f) => f.name === file.name)) return;
    await set(FONTFILES_KEY, [...list, { name: file.name, blob: file }].slice(-12));
  } catch { /* quota, ignore */ }
}

export const getFontFiles = async () => (await get(FONTFILES_KEY).catch(() => null)) || [];

/* ---- personal library ---- */
export const getLibrary = async (kind) => (await get('mf.library.' + kind).catch(() => null)) || [];
export async function putLibrary(kind, item, limit = 200) {
  const list = await getLibrary(kind);
  await set('mf.library.' + kind, [item, ...list.filter((entry) => entry.id !== item.id)].slice(0, limit));
}
export async function toggleFavorite(item) {
  const list = await getLibrary('favorites');
  const exists = list.some((entry) => entry.id === item.id);
  await set('mf.library.favorites', exists ? list.filter((entry) => entry.id !== item.id) : [item, ...list]);
  return !exists;
}
