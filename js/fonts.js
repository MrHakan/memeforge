// Fonts: the whole Google Fonts library, loaded on demand, plus your own files.
//
// The catalogue comes from Fontsource's API (CORS-friendly), falls back to
// Google's own metadata endpoint, and finally to a bundled shortlist so the
// picker still works offline. Individual families load through the Google
// Fonts stylesheet, which needs no key and no CORS.

import { fetchJson } from './util.js';

const CACHE_KEY = 'mf.fontlist.v1';
const CACHE_TTL = 7 * 24 * 3600 * 1000;

export const CORE_FONTS = [
  { family: 'Impact', category: 'display', local: true },
  { family: 'Anton', category: 'display', local: true },
  { family: 'Archivo', category: 'sans-serif', local: true },
  { family: 'Plex Mono', category: 'monospace', local: true },
  { family: 'Arial Black', category: 'sans-serif', local: true },
  { family: 'Arial', category: 'sans-serif', local: true },
  { family: 'Comic Sans MS', category: 'handwriting', local: true },
  { family: 'Georgia', category: 'serif', local: true },
  { family: 'Times New Roman', category: 'serif', local: true },
  { family: 'Courier New', category: 'monospace', local: true },
  { family: 'Verdana', category: 'sans-serif', local: true },
  { family: 'Trebuchet MS', category: 'sans-serif', local: true },
];

// Enough to keep the picker useful when every network route is blocked.
const FALLBACK_FAMILIES = [
  ['Bebas Neue', 'display'], ['Oswald', 'sans-serif'], ['Montserrat', 'sans-serif'],
  ['Roboto', 'sans-serif'], ['Open Sans', 'sans-serif'], ['Lato', 'sans-serif'],
  ['Poppins', 'sans-serif'], ['Inter', 'sans-serif'], ['Raleway', 'sans-serif'],
  ['Nunito', 'sans-serif'], ['Rubik', 'sans-serif'], ['Work Sans', 'sans-serif'],
  ['Playfair Display', 'serif'], ['Merriweather', 'serif'], ['Lora', 'serif'],
  ['Bitter', 'serif'], ['Cormorant Garamond', 'serif'], ['Libre Baskerville', 'serif'],
  ['Fredoka', 'display'], ['Luckiest Guy', 'display'], ['Bangers', 'display'],
  ['Titan One', 'display'], ['Alfa Slab One', 'display'], ['Rammetto One', 'display'],
  ['Passion One', 'display'], ['Righteous', 'display'], ['Ultra', 'display'],
  ['Bungee', 'display'], ['Monoton', 'display'], ['Press Start 2P', 'display'],
  ['Creepster', 'display'], ['Nosifer', 'display'], ['Rubik Glitch', 'display'],
  ['Permanent Marker', 'handwriting'], ['Caveat', 'handwriting'], ['Shadows Into Light', 'handwriting'],
  ['Indie Flower', 'handwriting'], ['Patrick Hand', 'handwriting'], ['Gloria Hallelujah', 'handwriting'],
  ['Dancing Script', 'handwriting'], ['Pacifico', 'handwriting'], ['Satisfy', 'handwriting'],
  ['Space Mono', 'monospace'], ['JetBrains Mono', 'monospace'], ['Fira Code', 'monospace'],
  ['Roboto Mono', 'monospace'], ['Source Code Pro', 'monospace'], ['Inconsolata', 'monospace'],
  ['Archivo Black', 'sans-serif'], ['Anton SC', 'display'], ['Teko', 'sans-serif'],
];

let catalogue = [];
let catalogueSource = 'bundled';
const loaded = new Set(CORE_FONTS.map((f) => f.family));
const pending = new Map();

export const fontSource = () => catalogueSource;

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (raw && Date.now() - raw.at < CACHE_TTL && Array.isArray(raw.fonts) && raw.fonts.length) return raw;
  } catch { /* ignore a corrupt cache */ }
  return null;
}

function writeCache(fonts, source) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), source, fonts }));
  } catch { /* storage full or blocked, no harm */ }
}

async function fromFontsource() {
  const data = await fetchJson('https://api.fontsource.org/v1/fonts');
  if (!Array.isArray(data) || !data.length) throw new Error('empty');
  return data
    .filter((f) => f.subsets?.includes('latin') && f.type !== 'icons')
    .map((f) => [f.family, f.category || 'sans-serif']);
}

async function fromGoogleMetadata() {
  const res = await fetch('https://fonts.google.com/metadata/fonts');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = (await res.text()).replace(/^\)\]\}'/, '');
  const data = JSON.parse(text);
  const list = data.familyMetadataList || [];
  if (!list.length) throw new Error('empty');
  return list.map((f) => [f.family, f.category?.toLowerCase().replace(/\s/g, '-') || 'sans-serif']);
}

/** Build the family list. Never rejects — worst case you get the bundled set. */
export async function loadCatalogue() {
  const cached = readCache();
  if (cached) {
    catalogueSource = cached.source;
    catalogue = cached.fonts.map(([family, category]) => ({ family, category }));
    return getFonts();
  }

  for (const [source, fetcher] of [['fontsource', fromFontsource], ['google', fromGoogleMetadata]]) {
    try {
      const fonts = await fetcher();
      catalogueSource = source;
      catalogue = fonts.map(([family, category]) => ({ family, category }));
      writeCache(fonts, source);
      return getFonts();
    } catch { /* try the next source */ }
  }

  catalogueSource = 'bundled';
  catalogue = FALLBACK_FAMILIES.map(([family, category]) => ({ family, category }));
  return getFonts();
}

const custom = [];

export function getFonts() {
  const seen = new Set();
  return [...custom, ...CORE_FONTS, ...catalogue].filter((f) => {
    if (seen.has(f.family)) return false;
    seen.add(f.family);
    return true;
  });
}

export const isLoaded = (family) => loaded.has(family);

/** Pull one family off Google Fonts and wait until the browser can paint it. */
export function loadFont(family, weights = '400;700') {
  if (loaded.has(family)) return Promise.resolve(true);
  if (pending.has(family)) return pending.get(family);

  const job = (async () => {
    const id = `mf-font-${family.replace(/\W+/g, '-')}`;
    if (!document.getElementById(id)) {
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${weights}&display=swap`;
      document.head.append(link);
    }
    try {
      await Promise.race([
        Promise.all([
          document.fonts.load(`400 40px "${family}"`),
          document.fonts.load(`700 40px "${family}"`),
        ]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000)),
      ]);
      const ok = document.fonts.check(`400 40px "${family}"`);
      if (ok) loaded.add(family);
      return ok;
    } catch {
      return false;
    } finally {
      pending.delete(family);
    }
  })();

  pending.set(family, job);
  return job;
}

/** Register a font file the user picked from their machine. */
export async function addCustomFont(file) {
  const family = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Custom font';
  const face = new FontFace(family, await file.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  loaded.add(family);
  if (!custom.some((f) => f.family === family)) custom.unshift({ family, category: 'yours', custom: true });
  return family;
}
