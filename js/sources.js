// Where the pictures come from.
//
// Templates are merged from Imgflip and Memegen; trending posts come from the
// Reddit meme feed. Each source is fetched independently and cached for a few
// hours, so one dead API never empties the library.

import Fuse from '../vendor/fuse.min.mjs';
import { fetchJson } from './util.js';
import { cacheGet, cacheSet, getRecents } from './store.js';

const TEMPLATE_TTL = 6 * 3600 * 1000;
const TRENDING_TTL = 15 * 60 * 1000;

let templates = [];
let fuse = null;
let notes = [];

export const sourceNotes = () => notes;

async function imgflip() {
  const data = await fetchJson('https://api.imgflip.com/get_memes');
  if (!data?.success) throw new Error('Imgflip said no');
  return data.data.memes.map((m) => ({
    id: `imgflip:${m.id}`,
    name: m.name,
    url: m.url,
    width: m.width,
    height: m.height,
    boxes: m.box_count,
    source: 'imgflip',
    keywords: m.name,
  }));
}

async function memegen() {
  const data = await fetchJson('https://api.memegen.link/templates');
  if (!Array.isArray(data)) throw new Error('Memegen said no');
  return data
    .filter((t) => t.blank)
    .map((t) => ({
      id: `memegen:${t.id}`,
      name: t.name,
      url: t.blank,
      boxes: t.lines || 2,
      source: 'memegen',
      keywords: [t.name, ...(t.keywords || [])].join(' '),
    }));
}

/** Load the template library. Resolves even when every network call fails. */
export async function loadTemplates({ force = false } = {}) {
  const cached = force ? null : await cacheGet('templates', TEMPLATE_TTL);
  if (cached?.length) {
    templates = cached;
    notes = [];
    index();
    return templates;
  }

  notes = [];
  const results = await Promise.allSettled([imgflip(), memegen()]);
  const merged = [];
  const names = ['Imgflip', 'Memegen'];

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') merged.push(...result.value);
    else notes.push(`${names[i]} is not answering right now.`);
  });

  const seen = new Set();
  templates = merged.filter((t) => {
    const key = t.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (templates.length) await cacheSet('templates', templates);
  index();
  return templates;
}

function index() {
  fuse = new Fuse(templates, {
    keys: [{ name: 'name', weight: 3 }, { name: 'keywords', weight: 1 }],
    threshold: 0.38,
    ignoreLocation: true,
  });
}

export function searchTemplates(query, source = 'all') {
  let list = templates;
  if (source !== 'all' && source !== 'local') list = list.filter((t) => t.source === source);
  if (!query?.trim()) return list;
  const aliases = { 'iki düğme': 'two buttons', 'dikkati dağılan': 'distracted boyfriend', 'erkek arkadaş': 'distracted boyfriend', 'drake': 'drake', 'kedi': 'cat', 'köpek': 'dog' };
  query = aliases[query.trim().toLocaleLowerCase('tr')] || query;
  const hits = fuse ? fuse.search(query.trim()).map((h) => h.item) : [];
  return source === 'all' ? hits : hits.filter((t) => t.source === source);
}

export const allTemplates = () => templates;
export const randomTemplate = () => templates[Math.floor(Math.random() * templates.length)] || null;

export async function localTemplates() {
  const recents = await getRecents();
  return recents.map((r) => ({
    id: `local:${r.url}`,
    name: r.name,
    url: r.url,
    source: 'local',
    keywords: r.name,
  }));
}

/* ---- trending ---- */

export async function loadTrending(sub = 'memes', { force = false } = {}) {
  const key = `trending:${sub}`;
  if (!force) {
    const cached = await cacheGet(key, TRENDING_TTL);
    if (cached?.length) return cached;
  }

  const data = await fetchJson(`https://meme-api.com/gimme/${encodeURIComponent(sub)}/40`);
  const posts = (data?.memes || [])
    .filter((m) => m.url && !m.nsfw && !m.spoiler)
    .map((m) => ({
      id: m.postLink,
      name: m.title,
      url: m.url,
      preview: m.preview?.at(-2) || m.preview?.at(-1) || m.url,
      author: m.author,
      ups: m.ups,
      sub: m.subreddit,
      link: m.postLink,
      source: 'reddit',
    }));

  if (!posts.length) throw new Error('The feed came back empty.');
  await cacheSet(key, posts);
  return posts;
}
