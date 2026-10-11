// Small helpers shared by every module.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style') Object.assign(node.style, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

export function debounce(fn, ms = 200) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function toast(message, kind = '') {
  const host = $('#toasts');
  if (!host) return;
  const node = el('div', { class: `toast ${kind ? 'is-' + kind : ''}`, text: message });
  host.append(node);
  setTimeout(() => {
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 250);
  }, kind === 'bad' ? 5200 : 3200);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const slug = (s) =>
  (s || 'meme').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'meme';

export function timeAgo(ts) {
  const secs = Math.max(1, Math.round((Date.now() - ts) / 1000));
  const steps = [[60, 's'], [60, 'm'], [24, 'h'], [7, 'd'], [4.35, 'w'], [12, 'mo']];
  let value = secs;
  let unit = 's';
  for (const [size, next] of steps) {
    if (value < size) break;
    value = Math.round(value / size);
    unit = next;
  }
  return `${value}${unit} ago`;
}

/* ---- remote images -------------------------------------------------------
   Meme hosts vary in how friendly they are about CORS, and a canvas that gets
   tainted can never be exported. Try direct first, then image proxies, and
   only fall back to a tainted load if every route fails. */

const PROXIES = [
  (u) => `https://images.weserv.nl/?url=${encodeURIComponent(u.replace(/^https?:\/\//, ''))}&n=-1`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];

function tryImage(src, withCors) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => { img.src = ''; reject(new Error('Image request timed out.')); }, 12000);
    if (withCors) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error(`could not load ${src.slice(0, 80)}`)); };
    img.src = src;
  });
}

export async function loadImage(url) {
  const isLocal = url.startsWith('data:') || url.startsWith('blob:') || url.startsWith(location.origin);
  try {
    return { img: await tryImage(url, !isLocal), tainted: false };
  } catch { /* keep trying */ }

  if (!isLocal) {
    for (const proxy of PROXIES) {
      try {
        return { img: await tryImage(proxy(url), true), tainted: false };
      } catch { /* next proxy */ }
    }
    try {
      return { img: await tryImage(url, false), tainted: true };
    } catch { /* give up below */ }
  }
  throw new Error('That image would not load. Try another template or upload the file.');
}

export async function fetchBuffer(url) {
  const attempts = url.startsWith('data:') || url.startsWith('blob:') || url.startsWith(location.origin)
    ? [url]
    : [url, ...PROXIES.map((p) => p(url))];
  let lastError;
  for (const candidate of attempts) {
    try {
      const res = await fetch(candidate, { mode: 'cors', signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.arrayBuffer();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Download failed');
}

export async function fetchJson(url, { timeout = 12000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
