// Boot the studio and wire the shell around it.

import { $, $$, el, toast, downloadBlob, slug, debounce, fileToDataUrl, uid } from './util.js';
import { Studio } from './studio.js';
import { Panels } from './panels.js';
import { Inspector } from './inspector.js';
import { loadFont, addCustomFont } from './fonts.js';
import { Advanced } from './advanced.js';
import { Workbench } from './workbench.js';
import { flashbang } from './flashbang.js';
import {
  getSetting, setSetting, addRecent, saveProject, saveAutosave, getAutosave, getFontFiles, clearAutosave,
} from './store.js';

const studio = new Studio($('#c'), $('#stage'));
let projectId = uid();
let exportScale = Number(getSetting('scale')) || 1;

/* ---------------- theme ---------------- */

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'dark' ? '#0E0F12' : '#E6E8EE');
  setSetting('theme', theme);
}
setTheme(getSetting('theme') || 'dark');
$('#theme-btn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  setTheme(next);
  // Light mode is blinding the first time. Once per device, and never if the
  // visitor has asked for reduced motion.
  if (next === 'light' && !getSetting('flashbanged') && flashbang()) {
    setSetting('flashbanged', true);
  }
});

/* ---------------- media ---------------- */

const projectTitle = $('#project-title');

async function loadMedia({ src, name = 'Untitled', source = 'upload', kind, keepTitle = false }) {
  const bench = $('#bench');
  bench.dataset.busy = '1';
  try {
    await studio.setMedia({ src, name, source, kind });
    if (!keepTitle) projectTitle.value = name;
    $('#empty-state').hidden = true;
    bench.classList.remove('is-empty');
    $('#canvas-hold').classList.remove('is-empty');
    studio.commit();
    updateReadout();
    if (studio.tainted) {
      toast('That host blocks downloads of its pictures. Editing works, saving may not.', 'bad');
    }
    // "Yours" only means pictures you brought, not library templates.
    if (!['imgflip', 'memegen'].includes(source)) addRecent({ url: studio.media.src, name, at: Date.now() });
    return true;
  } catch (err) {
    toast(err.message || 'That picture would not load.', 'bad');
    return false;
  } finally {
    delete bench.dataset.busy;
  }
}

async function loadFile(file) {
  if (file.type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(file.name)) return advanced.videoDialog(file);
  if (!file.type.startsWith('image/')) {
    toast('Pick an image or a GIF.', 'bad');
    return;
  }
  const src = await fileToDataUrl(file);
  await loadMedia({
    src,
    name: file.name.replace(/\.[^.]+$/, ''),
    source: 'upload',
    kind: file.type === 'image/gif' ? 'gif' : 'image',
  });
}

/* ---------------- panels and inspector ---------------- */

const panels = new Panels(studio, {
  onUseMedia: (item) => loadMedia(item),
  onFile: (file) => loadFile(file),
  onPanel: (name) => setSetting('panel', name),
  onAddText: () => requireMedia(() => studio.addText()),
  onAddClassic: () => requireMedia(() => studio.addClassicText()),
  onSticker: (char) => requireMedia(() => studio.addSticker(char)),
  onShape: (kind) => requireMedia(() => studio.addShape(kind)),
  onImageLayer: (file) => requireMedia(async () => {
    try {
      await studio.addImageLayer(await fileToDataUrl(file), file.name.replace(/\.[^.]+$/, ''));
    } catch {
      toast('That picture could not be added as a layer.', 'bad');
    }
  }),
  onTextPreset: (preset) => requireMedia(() => {
    if (!studio.selected()) studio.addText();
    inspector.applyTextPreset(studio.selected(), preset);
  }),
  onFont: (family) => requireMedia(async () => {
    const target = studio.selected() || studio.addText();
    studio.canvas.setActiveObject(target);
    const ok = await loadFont(family);
    studio.update({ fontFamily: family });
    if (!ok) toast(`${family} could not be fetched — showing a stand-in.`, 'bad');
    panels.renderFonts();
  }),
  onNewProject: () => newProject(),
  onOpenProject: (project) => openProject(project),
});

const inspector = new Inspector(studio, { onPickFont: (family) => panels.focusFonts(family) });

function requireMedia(action) {
  if (!studio.hasMedia) {
    toast('Load a picture first — templates are in the left panel.', 'bad');
    panels.show('templates');
    return;
  }
  action();
}

$('#add-text-2').addEventListener('click', () => requireMedia(() => studio.addText()));
$('#fit-btn').addEventListener('click', () => studio.fit());
$('#clear-btn').addEventListener('click', () => studio.clearLayers());
$('#play-btn').addEventListener('click', () => studio.toggle());

/* ---------------- readout ---------------- */

function updateReadout() {
  const media = studio.media;
  $('#ro-size').textContent = media ? `${studio.canvas.width}×${studio.canvas.height}` : '—';
  $('#ro-zoom').textContent = media ? `${Math.round(studio.displayScale * 100)}%` : '—';
  $('#ro-layers').textContent = studio.canvas.getObjects().length;
  $('#ro-source').textContent = media ? `${media.name} · ${media.source}` : 'no media';

  const animated = studio.isAnimated;
  $('#ro-gif').hidden = !animated;
  $('#ro-gif-sep').hidden = !animated;
  if (animated) {
    $('#ro-frames').textContent = media.frames.length;
    $('#play-btn').textContent = studio.playing ? '❚❚' : '▶';
  }

  $('#export-gif-item').disabled = !animated;
  $('#export-gif-item').querySelector('em').textContent = animated ? `${media.frames.length} frames` : 'load a GIF first';
  $('#empty-state').hidden = !!media;
  $('#bench').classList.toggle('is-empty', !media);
  $('#canvas-hold').classList.toggle('is-empty', !media);
}

for (const evt of ['view', 'media', 'layers', 'play', 'change']) {
  studio.addEventListener(evt, updateReadout);
}

studio.addEventListener('history', () => {
  $('#undo-btn').disabled = !studio.canUndo;
  $('#redo-btn').disabled = !studio.canRedo;
});

$('#undo-btn').addEventListener('click', () => studio.undo());
$('#redo-btn').addEventListener('click', () => studio.redo());

/* ---------------- export ---------------- */

const exportMenu = $('#export-menu');

function closeMenu() {
  exportMenu.hidden = true;
  $('#export-btn').setAttribute('aria-expanded', 'false');
}

$('#export-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  exportMenu.hidden = !exportMenu.hidden;
  $('#export-btn').setAttribute('aria-expanded', String(!exportMenu.hidden));
});

document.addEventListener('click', (e) => {
  if (!exportMenu.hidden && !exportMenu.contains(e.target)) closeMenu();
});

$$('#scale-seg .seg-btn').forEach((btn) => btn.addEventListener('click', () => {
  exportScale = Number(btn.dataset.scale);
  setSetting('scale', exportScale);
  $$('#scale-seg .seg-btn').forEach((b) => {
    b.classList.toggle('is-on', b === btn);
    b.setAttribute('aria-checked', String(b === btn));
  });
}));

$$('#scale-seg .seg-btn').forEach((b) => {
  const on = Number(b.dataset.scale) === exportScale;
  b.classList.toggle('is-on', on);
  b.setAttribute('aria-checked', String(on));
});

if (!navigator.canShare) $('#share-item').hidden = true;

$$('#export-menu [data-export]').forEach((btn) => {
  btn.addEventListener('click', () => {
    closeMenu();
    runExport(btn.dataset.export);
  });
});

const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

function filename(ext) {
  return `${slug(projectTitle.value || studio.media?.name)}.${ext}`;
}

async function currentBlob(type = 'image/png') {
  return studio.toBlob({ type, scale: exportScale, quality: type === 'image/jpeg' ? 0.92 : 0.95 });
}

async function runExport(kind) {
  if (!studio.hasMedia) {
    toast('Nothing on the bench yet.', 'bad');
    return;
  }
  try {
    if (kind === 'gif') return advanced.optimizeDialog(exportScale);

    if (kind === 'clipboard') {
      const blob = await currentBlob('image/png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Copied. Paste it anywhere.', 'good');
      return;
    }

    if (kind === 'share') {
      const blob = await currentBlob('image/png');
      const file = new File([blob], filename('png'), { type: 'image/png' });
      if (!navigator.canShare?.({ files: [file] })) {
        toast('This browser will not share files. Download it instead.', 'bad');
        return;
      }
      await navigator.share({ files: [file], title: projectTitle.value });
      return;
    }

    const blob = await currentBlob(MIME[kind] || 'image/png');
    downloadBlob(blob, filename(kind === 'jpeg' ? 'jpg' : kind));
    toast(`Saved ${filename(kind === 'jpeg' ? 'jpg' : kind)}`, 'good');
  } catch (err) {
    if (err?.name === 'SecurityError') {
      toast('That picture is locked by its host. Upload the file and it will export fine.', 'bad');
    } else if (err?.name !== 'AbortError') {
      toast(err.message || 'Export failed.', 'bad');
    }
  }
}

/* ---------------- projects ---------------- */

async function thumbnail() {
  try {
    const source = studio.render(1);
    const scale = 220 / Math.max(source.width, source.height);
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(source.width * scale));
    small.height = Math.max(1, Math.round(source.height * scale));
    small.getContext('2d').drawImage(source, 0, 0, small.width, small.height);
    return small.toDataURL('image/jpeg', 0.72);
  } catch {
    return '';
  }
}

async function save() {
  if (!studio.hasMedia) {
    toast('Nothing to save yet.', 'bad');
    return;
  }
  const project = {
    id: projectId,
    name: projectTitle.value || 'Untitled meme',
    updated: Date.now(),
    thumb: await thumbnail(),
    ...studio.toProject(projectTitle.value),
    fontFiles: await getFontFiles(),
  };
  try {
    await saveProject(project);
    $('#save-state').textContent = 'Saved to gallery';
    toast('Saved to your gallery.', 'good');
  } catch {
    $('#save-state').textContent = 'Save failed';
    toast('Storage is full or unavailable. Download a project backup.', 'bad');
    return;
  }
  if (panels.current === 'gallery') panels.renderGallery();
}

$('#save-btn').addEventListener('click', save);

async function openProject(project) {
  const previous = studio.hasMedia ? studio.toProject(projectTitle.value) : null;
  const previousId = projectId;
  const previousTitle = projectTitle.value;
  autosave.cancel();
  try {
    for (const entry of project.fontFiles || []) await addCustomFont(new File([entry.blob], entry.name));
    await studio.fromProject(project);
    projectId = project.id || uid();
    projectTitle.value = project.name || 'Untitled meme';
    await ensureFonts();
    updateReadout();
    autosave();
    toast(`Opened “${projectTitle.value}”.`, 'good');
    return true;
  } catch (error) {
    autosave.cancel();
    try { if (previous) await studio.fromProject(previous); else studio.reset(); } catch { studio.reset(); }
    projectId = previousId;
    projectTitle.value = previousTitle;
    updateReadout();
    toast(error.message || 'That saved meme could not be reopened.', 'bad');
    return false;
  }
}

function newProject() {
  projectId = uid();
  projectTitle.value = 'Untitled meme';
  autosave.cancel();
  studio.reset();
  clearAutosave();
  $('#save-state').textContent = 'Ready';
  panels.show('templates');
  toast('Fresh bench. Pick a template.', '');
}

/** Text restored from storage may use fonts this session has not fetched yet. */
async function ensureFonts() {
  const families = [...new Set(studio.canvas.getObjects().map((o) => o.fontFamily).filter(Boolean))];
  await Promise.all(families.map((f) => loadFont(f)));
  studio.canvas.requestRenderAll();
}

/* ---------------- autosave ---------------- */

const autosave = debounce(async () => {
  if (!studio.hasMedia) return;
  const id = projectId;
  $('#save-state').textContent = 'Saving…';
  try {
    await saveAutosave({ id, name: projectTitle.value, at: Date.now(), project: studio.toProject(projectTitle.value) });
    if (id === projectId) $('#save-state').textContent = 'Saved on device';
  } catch {
    if (id === projectId) $('#save-state').textContent = 'Save failed — download a backup';
  }
}, 1200);

studio.addEventListener('change', autosave);
projectTitle.addEventListener('input', autosave);

/* ---------------- keyboard ---------------- */

const typing = (e) => {
  const tag = e.target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable || studio.canvas.getActiveObject()?.isEditing;
};

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;

  if (mod && e.key.toLowerCase() === 'z') {
    if (typing(e) && !studio.canvas.getActiveObject()?.isEditing) return;
    e.preventDefault();
    e.shiftKey ? studio.redo() : studio.undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); runExport('png'); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); runExport('clipboard'); return; }
  if (mod && e.key.toLowerCase() === 'd') {
    if (!studio.selected()) return;
    e.preventDefault();
    studio.duplicateSelected();
    return;
  }

  if (typing(e)) return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!studio.selected()) return;
    e.preventDefault();
    studio.removeSelected();
    return;
  }
  if (e.key === 'Escape') {
    studio.canvas.discardActiveObject();
    studio.canvas.requestRenderAll();
    studio.emit('selection');
    return;
  }
  if (e.key.toLowerCase() === 't' && !mod) {
    e.preventDefault();
    requireMedia(() => studio.addText());
    return;
  }

  const nudges = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  if (nudges[e.key]) {
    const obj = studio.selected();
    if (!obj) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    obj.set({ left: obj.left + nudges[e.key][0] * step, top: obj.top + nudges[e.key][1] * step });
    studio.rememberObject(obj);
    obj.setCoords();
    studio.canvas.requestRenderAll();
    debounceCommit();
  }
});

const debounceCommit = debounce(() => studio.commit(), 400);

/* ---------------- paste and drop ---------------- */

document.addEventListener('paste', async (e) => {
  if (typing(e)) return;
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) {
    e.preventDefault();
    await loadFile(item.getAsFile());
    return;
  }
  const text = e.clipboardData?.getData('text');
  if (text && /^https?:\/\/\S+$/i.test(text.trim())) {
    e.preventDefault();
    loadMedia({ src: text.trim(), name: 'Pasted link', source: 'link' });
  }
});

for (const evt of ['dragover', 'drop']) {
  document.addEventListener(evt, (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    if (evt === 'drop' && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });
}

/* ---------------- dialogs ---------------- */

const dialog = $('#shortcuts-dialog');
$('#shortcuts-btn').addEventListener('click', () => dialog.showModal());
$('#shortcuts-close').addEventListener('click', () => dialog.close());

/* ---------------- start ---------------- */

async function restoreFonts() {
  for (const entry of await getFontFiles()) {
    try {
      await addCustomFont(new File([entry.blob], entry.name));
    } catch { /* skip a font that will not parse */ }
  }
}

async function boot() {
  panels.show(getSetting('panel') || 'templates');
  $('#bench').classList.add('is-empty');
  $('#canvas-hold').classList.add('is-empty');
  await restoreFonts();

  const saved = await getAutosave();
  if (saved?.project?.media?.src) {
    projectId = saved.id || projectId;
    projectTitle.value = saved.name || 'Untitled meme';
    try {
      await studio.fromProject(saved.project);
      $('#empty-state').hidden = true;
      $('#bench').classList.remove('is-empty');
      $('#canvas-hold').classList.remove('is-empty');
      await ensureFonts();
      updateReadout();
      toast('Picked up where you left off.', '');
    } catch { /* start clean instead */ }
  }

  panels.renderFonts();
  updateReadout();
}

boot();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {});
  });
}

const workbench = new Workbench(studio, panels, { loadMedia, openProject, newProject, projectTitle, runExport });
const advanced = new Advanced(studio, workbench);

// Handy for poking at the studio from the console.
Object.assign(window, { studio, panels, inspector, workbench, advanced, loadMedia, el });
