// Pose animation, reusable parts, project checkpoints and layout tools.
import * as fabric from '../vendor/fabric.min.mjs';
import { $, el, uid, clamp, toast, fileToDataUrl, loadImage } from './util.js';
import { EXTRA_PROPS } from './studio.js';
import { getLibrary, putLibrary, deleteLibraryItem, getFontFiles } from './store.js';
import { addCustomFont, loadFont } from './fonts.js';

const field = (label, node) => el('label', { class: 'dialog-field', text: label }, [node]);
const button = (id, name, fn) => el('button', { ...(id ? { id } : {}), type: 'button', class: 'btn btn-quiet', text: name, onClick: fn });
const choose = (id, entries, value) => {
  const node = el('select', { id }, entries.map(([v, name]) => el('option', { value: v, text: name }))); node.value = value; return node;
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const poseKeys = ['left', 'top', 'scaleX', 'scaleY', 'angle', 'opacity'];
const styleKeys = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fill', 'stroke', 'strokeWidth', 'charSpacing', 'lineHeight', 'textAlign', 'mfUpper', 'shadow'];

export class Creative {
  constructor(studio, bench) {
    this.studio = studio; this.bench = bench;
    const tools = $('.advanced-tools');
    for (const [id, name, action] of [
      ['poses-open', 'Start / end poses', () => this.poseDialog()], ['loop-open', 'GIF loop', () => this.loopDialog()],
      ['mask-open', 'Brush mask', () => this.maskDialog()], ['canvas-format', 'Canvas ratio', () => this.canvasDialog()],
      ['parts-open', 'My parts', () => this.openParts()], ['versions-open', 'Versions', () => this.versionDialog()], ['arrange-open', 'Arrange / group', () => this.arrangeDialog()],
    ]) tools.append(button(id, name, () => bench.safe(action)));
    this.installGuides(); this.installParts();
  }

  requireAnimation() { this.bench.requireMedia(); if (!this.studio.isAnimated) throw new Error('Load a GIF first.'); }

  poseDialog() {
    this.requireAnimation(); const s = this.studio, obj = s.selected();
    if (!obj) throw new Error('Select a layer first.'); s.pause();
    const current = s.pose(obj), config = obj.mfAnimation?.kind === 'poses' ? obj.mfAnimation : {};
    const poses = { start: config.start || current, end: config.end || current };
    const columns = ['start', 'end'].map((role) => el('section', { class: 'pose-column' }, [
      el('h3', { text: role === 'start' ? 'Start pose' : 'End pose' }),
      ...poseKeys.map((key) => this.bench.number(key === 'scaleX' ? 'Width scale (%)' : key === 'scaleY' ? 'Height scale (%)' : key === 'opacity' ? 'Opacity (%)' : key === 'angle' ? 'Rotation (°)' : key === 'left' ? 'X' : 'Y', `pose-${role}-${key}`, ['scaleX', 'scaleY', 'opacity'].includes(key) ? poses[role][key] * 100 : poses[role][key], ['left', 'top', 'angle'].includes(key) ? -10000 : key === 'opacity' ? 0 : 1, key === 'opacity' ? 100 : 10000)),
      button(`pose-capture-${role}`, 'Record current canvas pose', () => { s.capturePose(role); this.bench.dialog.close(); toast(`${role === 'start' ? 'Start' : 'End'} pose saved. Move the layer, then record its other pose.`, 'good'); }),
    ]));
    const easing = choose('pose-easing', [['linear', 'Linear'], ['smooth', 'Smooth'], ['ease-in', 'Ease in'], ['ease-out', 'Ease out']], config.easing || 'smooth');
    this.bench.openDialog('Start and end poses', [
      el('p', { class: 'panel-hint', text: 'Record a pose from the canvas, reposition the layer, and record the other pose. Or enter both poses below. Zero duration spans the layer’s entire frame range, reaching the end pose on its final frame.' }),
      el('div', { class: 'pose-columns' }, columns), field('Easing', easing), this.bench.number('Duration (ms, 0 = layer range)', 'pose-duration', config.duration || 0, 0, 10000),
      button('pose-remove', 'Remove pose motion', () => { s.setAnimation({ kind: 'none' }); this.bench.dialog.close(); }),
    ], () => {
      const read = (role) => Object.fromEntries(poseKeys.map((key) => [key, +$(`#pose-${role}-${key}`).value / (['scaleX', 'scaleY', 'opacity'].includes(key) ? 100 : 1)]));
      s.setAnimation({ kind: 'poses', start: read('start'), end: read('end'), duration: +$('#pose-duration').value, easing: easing.value });
    });
    for (const input of $('#editor-dialog-body').querySelectorAll('input[type=number]')) input.step = '0.01';
  }

  loopDialog() {
    this.requireAnimation();
    this.bench.openDialog('GIF loop tools', [
      field('Forward then backward (no repeated endpoints)', el('input', { id: 'loop-pingpong', type: 'checkbox' })),
      this.bench.number('Hold at final frame (ms)', 'loop-hold', 0, 0, 5000), this.bench.number('Background crossfade frames (0 = off)', 'loop-transition', 0, 0, 60), this.bench.number('Crossfade frame delay (ms)', 'loop-delay', 40, 10, 1000),
      el('p', { class: 'panel-hint', text: 'Appends a return path, final-frame pause or a background crossfade toward the first frame. Layer bindings follow copied frames. Crossfade frames stay editable and travel in project backups. Use Undo to try another loop.' }),
    ], () => this.studio.loopFrames({ pingpong: $('#loop-pingpong').checked, hold: +$('#loop-hold').value, transition: +$('#loop-transition').value, delay: +$('#loop-delay').value }));
  }

  maskDialog() {
    this.bench.requireMedia();
    const selected = this.studio.selected(), target = selected?.mfMask ? selected : null;
    const config = target?.mfRegion || {};
    const action = choose('mask-action', target ? [['edit', 'Update selected mask'], ['paint', 'Paint a new mask']] : [['paint', 'Paint a new mask']], target ? 'edit' : 'paint');
    const kind = choose('mask-kind', [['blur', 'Blur'], ['pixelate', 'Pixelation'], ['filter', 'Color filter']], config.kind || 'blur');
    this.bench.openDialog('Brush selection mask', [field('Action', action), field('Effect', kind), this.bench.number('Brush width (px)', 'mask-width', target?.mfMaskWidth || 32, 1, 100), this.bench.number('Blur / pixelation strength', 'mask-strength', config.strength || 12, 1, 100), this.bench.number('Color saturation (%)', 'mask-saturate', config.saturate ?? 0, 0, 400), this.bench.number('Color contrast (%)', 'mask-contrast', config.contrast ?? 100, 0, 300), el('p', { class: 'panel-hint', text: 'Paint over the background to select an irregular area. Each stroke becomes a movable mask layer. In Frame mode it applies to the selected frames. Purple brush feedback is excluded from exports.' })], () => {
      const props = { kind: kind.value, strength: +$('#mask-strength').value, saturate: +$('#mask-saturate').value, contrast: +$('#mask-contrast').value }, width = +$('#mask-width').value;
      if (action.value === 'edit' && target) {
        this.studio.canvas.setActiveObject(target); this.studio.update({ mfRegion: props, mfMaskWidth: width, strokeWidth: width }); return;
      }
      this.studio.setMaskDrawing(props, width);
      $('#drawing-stop')?.remove(); $('.advanced-tools').append(button('drawing-stop', 'Finish mask', () => { this.studio.setDrawing('none'); $('#drawing-stop').remove(); }));
    });
  }

  canvasDialog() {
    this.bench.requireMedia(); const s = this.studio;
    const presets = { '1:1': [720, 720], '9:16': [540, 960], '16:9': [960, 540], '4:5': [640, 800] };
    const ratio = choose('canvas-ratio', [['custom', 'Custom'], ...Object.keys(presets).map((p) => [p, p])], 'custom');
    ratio.onchange = () => { if (presets[ratio.value]) { $('#canvas-width').value = presets[ratio.value][0]; $('#canvas-height').value = presets[ratio.value][1]; } };
    const mode = choose('canvas-mode', [['fit', 'Fit with background space'], ['cover', 'Crop to fill']], s.scene?.mode || 'fit');
    this.bench.openDialog('Canvas format', [field('Ratio preset', ratio), this.bench.number('Canvas width including padding (px)', 'canvas-width', s.canvas.width, 32, 1600), this.bench.number('Canvas height including padding (px)', 'canvas-height', s.canvas.height, 32, 1600), field('Picture placement', mode), field('Background color', el('input', { id: 'canvas-color', type: 'color', value: s.scene?.color || s.pad.color })), field('Keep relative layer positions and sizes', el('input', { id: 'canvas-rescale', type: 'checkbox', checked: true })), button('canvas-original', 'Restore original format', () => { s.setScene(null, $('#canvas-rescale').checked); this.bench.dialog.close(); })], () => {
      const p = s.paddingPixels, width = +$('#canvas-width').value - p.left - p.right, height = +$('#canvas-height').value - p.top - p.bottom;
      if (width < 32 || height < 32) throw new Error('Reduce padding or use a larger canvas.');
      s.setScene({ width, height, mode: mode.value, color: $('#canvas-color').value }, $('#canvas-rescale').checked);
    });
  }

  arrangeDialog() {
    this.bench.requireMedia(); const s = this.studio;
    const selected = new Set(s.canvas.getActiveObjects()); s.canvas.discardActiveObject();
    const objects = s.canvas.getObjects();
    const list = el('div', { class: 'arrange-list' }, objects.map((obj, i) => field(s.layers()[i].name, el('input', { type: 'checkbox', 'data-object': i, checked: selected.has(obj) }))));
    const action = choose('arrange-action', [['left', 'Align left edges'], ['right', 'Align right edges'], ['top', 'Align top edges'], ['bottom', 'Align bottom edges'], ['center-x', 'Align horizontal centers'], ['center-y', 'Align vertical centers'], ['canvas-x', 'Center on canvas horizontally'], ['canvas-y', 'Center on canvas vertically'], ['distribute-x', 'Equal horizontal gaps'], ['distribute-y', 'Equal vertical gaps'], ['group', 'Group layers'], ['ungroup', 'Ungroup selected group']], 'left');
    this.bench.openDialog('Arrange and group layers', [list, field('Action', action), el('p', { class: 'panel-hint', text: 'Choose layers here or Shift-click them on the canvas before opening this tool. Groups move and scale together. Ungrouping preserves animated poses as frame edits. Snap also follows other layer edges and centers.' })], () => {
      const picked = [...list.querySelectorAll('input:checked')].map((n) => objects[+n.dataset.object]);
      if (action.value === 'group') s.groupLayers(picked);
      else if (action.value === 'ungroup') { if (picked.length !== 1) throw new Error('Choose one group.'); s.ungroupLayer(picked[0]); }
      else s.arrange(picked, action.value);
    });
  }

  installGuides() {
    const s = this.studio;
    this.guides = el('canvas', { class: 'creative-guides', 'aria-hidden': 'true', hidden: true }); s.canvas.upperCanvasEl.parentElement.append(this.guides);
    s.addEventListener('guides', () => {
      this.guides.width = s.canvas.width; this.guides.height = s.canvas.height;
      this.guides.style.width = s.canvas.upperCanvasEl.style.width; this.guides.style.height = s.canvas.upperCanvasEl.style.height; this.guides.hidden = false;
      const ctx = this.guides.getContext('2d'), g = s.snapGuides || {}; ctx.strokeStyle = '#8b5cf6'; ctx.lineWidth = 1 / s.displayScale;
      if (g.x != null) { ctx.beginPath(); ctx.moveTo(g.x, 0); ctx.lineTo(g.x, this.guides.height); ctx.stroke(); }
      if (g.y != null) { ctx.beginPath(); ctx.moveTo(0, g.y); ctx.lineTo(this.guides.width, g.y); ctx.stroke(); }
    });
    s.canvas.on('mouse:up', () => { this.guides.hidden = true; });
    for (const name of ['media', 'frame', 'view']) s.addEventListener(name, () => { this.guides.hidden = true; });
  }

  installParts() {
    this.shelf = el('aside', { id: 'parts-shelf', class: 'creative-shelf', 'aria-label': 'Personal reusable parts', hidden: true }, [
      el('div', { class: 'shelf-head' }, [el('h2', { text: 'My parts' }), button('parts-close', 'Close', () => { this.shelf.hidden = true; })]),
      el('input', { id: 'part-name', type: 'text', placeholder: 'Part / style name', maxlength: 100, 'aria-label': 'Part name' }),
      el('div', { class: 'shelf-actions' }, [button('part-save', 'Save selected layers', () => this.bench.safe(() => this.savePart())), button('part-style-save', 'Save text style', () => this.bench.safe(() => this.savePart(true))), button('part-upload', 'Import image', () => $('#part-file').click())]),
      el('p', { class: 'panel-hint', text: 'Drag a part to the canvas, or click Add. Parts save the current appearance; new GIF frame bindings follow your editing mode.' }),
      el('div', { id: 'part-list', class: 'part-list' }),
    ]);
    document.body.append(this.shelf);
    const input = el('input', { id: 'part-file', type: 'file', accept: 'image/*', hidden: true });
    input.onchange = () => this.bench.safe(async () => {
      const file = input.files[0]; input.value = ''; if (!file) return;
      const { img } = await loadImage(await fileToDataUrl(file));
      const obj = new fabric.FabricImage(img, { mfKind: 'image', mfName: file.name, originX: 'center', originY: 'center' });
      const factor = Math.min(1, 600 / Math.max(obj.width, obj.height)); obj.scale(factor);
      await this.storePart([obj], $('#part-name').value.trim() || file.name.replace(/\.[^.]+$/, '')); await this.openParts();
    }); document.body.append(input);
    this.studio.stageEl.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/x-memeforge-part')) e.preventDefault(); });
    this.studio.stageEl.addEventListener('drop', (e) => {
      const id = e.dataTransfer.getData('text/x-memeforge-part'); if (!id) return;
      e.preventDefault(); e.stopPropagation();
      const b = this.studio.canvas.upperCanvasEl.getBoundingClientRect();
      this.bench.safe(() => this.addPart(id, { x: (e.clientX - b.left) * this.studio.canvas.width / b.width, y: (e.clientY - b.top) * this.studio.canvas.height / b.height }));
    });
  }

  async openParts() {
    this.shelf.hidden = false;
    const entries = await getLibrary('parts'), host = $('#part-list');
    host.replaceChildren(...entries.map((item) => {
      const card = el('article', { class: 'part-card', draggable: true, 'data-part': item.id }, [
        ...(item.thumb ? [el('img', { src: item.thumb, alt: item.name })] : []), el('strong', { text: item.name }), el('small', { text: item.kind === 'style' ? 'Text style' : 'Editable part' }),
        el('div', { class: 'shelf-actions' }, [button('', 'Add', () => this.bench.safe(() => this.addPart(item.id))), button('', 'Delete', () => this.bench.safe(async () => { await deleteLibraryItem('parts', item.id); await this.openParts(); }))]),
      ]);
      card.ondragstart = (e) => { e.dataTransfer.setData('text/x-memeforge-part', item.id); e.dataTransfer.effectAllowed = 'copy'; };
      return card;
    }));
    if (!entries.length) host.append(el('p', { class: 'empty-note', text: 'Save selected layers, a writing style or import an image.' }));
  }

  async partThumbnail(objects) {
    const copies = await fabric.util.enlivenObjects(objects.map((o) => o.toObject(EXTRA_PROPS)));
    const bounds = copies.map((o) => o.getBoundingRect());
    const left = Math.min(...bounds.map((b) => b.left)), top = Math.min(...bounds.map((b) => b.top));
    const width = Math.max(1, Math.max(...bounds.map((b) => b.left + b.width)) - left), height = Math.max(1, Math.max(...bounds.map((b) => b.top + b.height)) - top);
    const factor = Math.min(200 / width, 130 / height, 1);
    const canvas = new fabric.StaticCanvas(document.createElement('canvas'), { width: 220, height: 150, enableRetinaScaling: false, renderOnAddRemove: false });
    try {
      for (const obj of copies) { obj.set({ left: (obj.left - left) * factor + (220 - width * factor) / 2, top: (obj.top - top) * factor + (150 - height * factor) / 2, scaleX: obj.scaleX * factor, scaleY: obj.scaleY * factor }); canvas.add(obj); }
      canvas.renderAll(); return canvas.toDataURL({ format: 'png' });
    } finally { await canvas.dispose(); }
  }

  async storePart(objects, name) {
    const entries = objects.map((o) => o.toObject(EXTRA_PROPS));
    await putLibrary('parts', { id: uid(), name, kind: 'part', objects: entries, thumb: await this.partThumbnail(objects), fontFiles: await getFontFiles() });
  }

  async savePart(style = false) {
    this.bench.requireMedia(); const s = this.studio, picked = s.canvas.getActiveObjects().slice();
    if (!picked.length) throw new Error('Select a layer first.');
    s.pause(); s.canvas.discardActiveObject();
    const name = $('#part-name').value.trim() || (style ? 'My text style' : 'My part');
    if (style) {
      const obj = picked[0]; if (obj.text == null) throw new Error('Select a text layer to save its style.');
      const props = Object.fromEntries(styleKeys.filter((k) => obj[k] !== undefined).map((k) => [k, clone(obj[k])]));
      await putLibrary('parts', { id: uid(), name, kind: 'style', style: props, fontFiles: await getFontFiles() });
    } else await this.storePart(picked, name);
    if (picked.length === 1) s.canvas.setActiveObject(picked[0]); await this.openParts(); toast('Saved to My parts.', 'good');
  }

  async addPart(id, point) {
    this.bench.requireMedia(); const item = (await getLibrary('parts')).find((p) => p.id === id);
    if (!item) throw new Error('This part is no longer saved.');
    for (const entry of item.fontFiles || []) await addCustomFont(new File([entry.blob], entry.name));
    const s = this.studio, selected = s.selected(); s.pause(); s.canvas.discardActiveObject();
    if (item.kind === 'style') {
      const target = (selected?.text != null ? selected : null) || s.canvas.getObjects().find((obj) => obj.text != null) || s.addText('Your text');
      s.canvas.setActiveObject(target); await loadFont(item.style.fontFamily); s.update(item.style); return target;
    }
    const objects = await fabric.util.enlivenObjects(item.objects);
    const strip = (obj) => {
      for (const key of ['mfBase', 'mfOverrides', 'mfFrameIds', 'mfStart', 'mfEnd', 'mfAnimation', 'mfCell']) delete obj[key]; obj._motion = null;
      if (obj.type === 'group') { obj.set('objectCaching', false); obj.getObjects().forEach(strip); }
      obj.mfBase = s.objectProps(obj);
    };
    objects.forEach(strip);
    for (const family of new Set([...s.walkObjects(objects)].map((o) => o.fontFamily).filter(Boolean))) await loadFont(family);
    let root = objects[0];
    if (objects.length > 1) { root = new fabric.Group(objects, { objectCaching: false, mfKind: 'group', mfName: item.name, layoutManager: new fabric.LayoutManager(new fabric.FixedLayout()) }); for (const obj of objects) { obj.mfBase = s.objectProps(obj); } }
    const b = root.getBoundingRect(), target = point || { x: s.canvas.width / 2, y: s.canvas.height / 2 };
    root.set({ left: root.left + target.x - b.left - b.width / 2, top: root.top + target.y - b.top - b.height / 2 }); delete root.mfBase;
    s.canvas.add(root); s.canvas.setActiveObject(root); s.applyFrame(); s.paintMedia(); s.emit('layers'); s.emit('selection'); return root;
  }

  versionKind() { return `versions.${this.bench.hooks.getProjectId()}`; }

  async saveVersion(name) {
    this.bench.requireMedia(); this.studio.pause();
    const scale = Math.min(1, 480 / Math.max(this.studio.canvas.width, this.studio.canvas.height));
    const item = { id: uid(), name: name.trim() || 'Checkpoint', at: Date.now(), project: this.studio.toProject(this.bench.hooks.projectTitle.value), fontFiles: await getFontFiles(), thumb: await fileToDataUrl(await this.studio.toBlob({ type: 'image/png', scale })) };
    await putLibrary(this.versionKind(), item, 20); return item;
  }

  async restoreVersion(id) {
    const item = (await getLibrary(this.versionKind())).find((v) => v.id === id);
    if (!item) throw new Error('This checkpoint is unavailable.');
    const projectId = this.bench.hooks.getProjectId(); await this.saveVersion(`Before restoring ${item.name}`);
    const ok = await this.bench.hooks.openProject({ ...item.project, id: projectId, fontFiles: item.fontFiles });
    if (!ok) throw new Error('The checkpoint could not be restored.');
    this.bench.dialog.close(); return true;
  }

  async versionDialog() {
    this.bench.requireMedia(); const entries = await getLibrary(this.versionKind());
    const name = el('input', { id: 'version-name', type: 'text', placeholder: 'Checkpoint name', maxlength: 100, 'aria-label': 'Checkpoint name' });
    const left = choose('version-left', [['current', 'Current work'], ...entries.map((v) => [v.id, v.name])], 'current');
    const right = choose('version-right', entries.map((v) => [v.id, v.name]), entries[0]?.id || '');
    const compare = el('div', { id: 'version-compare', class: 'version-compare' });
    const list = el('div', { class: 'version-list' }, entries.map((item) => el('article', { class: 'version-card', 'data-version': item.id }, [
      el('strong', { text: item.name }), el('small', { text: new Date(item.at).toLocaleString() }),
      button('', 'Restore', () => this.bench.safe(() => this.restoreVersion(item.id))), button('', 'Delete', () => this.bench.safe(async () => { await deleteLibraryItem(this.versionKind(), item.id); await this.versionDialog(); })),
    ])));
    const preview = async (value) => {
      if (value === 'current') return { name: 'Current work', project: this.studio.toProject(this.bench.hooks.projectTitle.value), thumb: await fileToDataUrl(await this.studio.toBlob({ scale: Math.min(1, 480 / Math.max(this.studio.canvas.width, this.studio.canvas.height)) })) };
      return entries.find((v) => v.id === value);
    };
    this.bench.openDialog('Project checkpoints', [el('p', { class: 'panel-hint', text: 'Up to 20 named versions are stored on this device for this project. Compare saved frame previews; Restore reopens the complete project, including GIF timing and layers. Current work is checkpointed before restoring.' }), name, button('version-save', 'Save checkpoint', () => this.bench.safe(async () => { await this.saveVersion(name.value); await this.versionDialog(); })), list, field('Left version', left), field('Right version', right), button('versions-compare', 'Compare side by side', () => this.bench.safe(async () => {
      const items = await Promise.all([preview(left.value), preview(right.value)]);
      if (items.some((v) => !v)) throw new Error('Save a checkpoint first.');
      compare.replaceChildren(...items.map((v) => {
        const state = JSON.parse(v.project.state); return el('figure', {}, [el('figcaption', { text: v.name }), el('img', { src: v.thumb, alt: v.name }), el('small', { text: `${state.objects.length} layers · ${state.timeline?.length || 1} frames` })]);
      }));
    })), compare], () => {}, 'Done');
  }
}
