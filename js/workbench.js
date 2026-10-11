// Editing tools, portable projects and a frame/time view of the same GIF.
import { $, $$, el, toast, downloadBlob, slug, uid, clamp, fileToDataUrl, loadImage } from './util.js';
import { getFontFiles, addFontFile, putLibrary } from './store.js';
import { addCustomFont } from './fonts.js';

const time = (ms) => `${(ms / 1000).toFixed(2)}s`;

export class Workbench {
  constructor(studio, panels, hooks) {
    this.studio = studio;
    this.panels = panels;
    this.hooks = hooks;
    this.dialog = $('#editor-dialog');
    this.menu = $('#context-menu');
    this.pointers = new Map();
    this.studio.snapping = true;
    this.wireProjects();
    this.wireTools();
    this.wireTimeline();
    this.wireContext();
    $('#editor-cancel').onclick = () => this.dialog.close();
    $('#editor-form').onsubmit = (e) => {
      e.preventDefault();
      this.safe(async () => { await this.dialogApply?.(); this.dialog.close(); });
    };
    $('#inspector-close').onclick = () => $('#inspector').classList.remove('is-open');
    studio.addEventListener('selection', () => {
      if (!studio.selected()) $('#inspector').classList.remove('is-open');
      if (matchMedia('(max-width: 940px)').matches && studio.selected() && !studio.playing) {
        $('#drawer').classList.add('is-hidden');
        $('#inspector').classList.add('is-open');
      }
    });
    studio.addEventListener('view', () => { $('#zoom-value').textContent = `${Math.round(studio.displayScale * 100)}%`; });
    for (const name of ['timeline', 'media']) studio.addEventListener(name, () => this.renderTimeline());
    for (const name of ['frame', 'play']) studio.addEventListener(name, () => this.updateTime());
    this.renderTimeline();
  }

  async safe(action) {
    try { return await action(); } catch (error) { if (error.name !== 'AbortError') toast(error.message || 'That action failed.', 'bad'); }
  }

  openDialog(title, nodes, apply, label = 'Apply') {
    $('#editor-dialog-body').replaceChildren(el('h2', { text: title }), ...nodes);
    $('#editor-apply').textContent = label;
    $('#editor-apply').disabled = false;
    this.dialogApply = apply;
    this.dialog.showModal();
  }

  number(label, id, value, min = 0, max = 2000) {
    return el('label', { class: 'dialog-field', text: label }, [el('input', { id, type: 'number', value, min, max, required: true })]);
  }

  wireProjects() {
    const menu = $('#project-menu');
    $('#project-menu-btn').onclick = () => {
      menu.hidden = !menu.hidden;
      $('#project-menu-btn').setAttribute('aria-expanded', String(!menu.hidden));
    };
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#project-menu-btn') && !e.target.closest('#project-menu')) {
        menu.hidden = true;
        $('#project-menu-btn').setAttribute('aria-expanded', 'false');
      }
    });
    for (const button of $$('#project-menu button')) button.addEventListener('click', () => { menu.hidden = true; });
    $('#project-new').onclick = this.hooks.newProject;
    $('#project-rename').onclick = () => {
      const input = el('input', { id: 'rename-input', type: 'text', value: this.hooks.projectTitle.value, required: true, maxlength: 120, 'aria-label': 'Project name' });
      this.openDialog('Project name', [input], () => {
        this.hooks.projectTitle.value = input.value;
        this.hooks.projectTitle.dispatchEvent(new Event('input'));
      });
    };
    $('#project-download').onclick = () => this.safe(() => this.downloadProject());
    $('#project-open').onclick = () => $('#project-file').click();
    $('#project-file').onchange = (e) => this.safe(async () => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        if (file.size > 64 * 1024 * 1024) throw new Error('Project file exceeds 64 MB.');
        const project = JSON.parse(await file.text());
        this.validateProject(project);
        project.fontFiles = await Promise.all((project.fonts || []).map(async (font) => {
          if (typeof font.name !== 'string' || typeof font.data !== 'string' || !font.data.startsWith('data:')) throw new Error('Invalid project font.');
          const blob = await (await fetch(font.data)).blob();
          const fontFile = new File([blob], font.name);
          await addCustomFont(fontFile);
          await addFontFile(fontFile);
          return { name: font.name, blob };
        }));
        await this.hooks.openProject({ ...project, id: uid() });
      } finally { e.target.value = ''; }
    });
    $('#template-save').onclick = () => this.safe(async () => {
      this.requireMedia();
      const blob = await this.studio.toBlob();
      await putLibrary('personal', { id: uid(), name: this.hooks.projectTitle.value, url: await fileToDataUrl(blob), source: 'local', project: this.studio.toProject(this.hooks.projectTitle.value), fontFiles: await getFontFiles() });
      this.panels.show('templates');
      $('#template-chips [data-source="local"]').click();
      toast('Saved as a personal template.', 'good');
    });
    $('#url-import').onsubmit = (e) => {
      e.preventDefault();
      this.safe(async () => {
        const url = new URL($('#media-url').value.trim());
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS image link.');
        const button = $('#url-import-btn');
        button.disabled = true;
        button.textContent = 'Loading…';
        try {
          const name = decodeURIComponent(url.pathname.split('/').pop() || 'Linked image').replace(/\.[^.]+$/, '');
          if (await this.hooks.loadMedia({ src: url.href, name, source: 'link' })) $('#media-url').value = '';
        } finally { button.disabled = false; button.textContent = 'Import'; }
      });
    };
  }

  requireMedia() { if (!this.studio.hasMedia) throw new Error('Load an image or GIF first.'); }

  validateProject(project) {
    if (![2, 3].includes(project.version) || typeof project.state !== 'string' || typeof project.media?.src !== 'string') throw new Error('This is not a supported MemeForge project.');
    if (!/^(data:image\/|https?:\/\/)/i.test(project.media.src)) throw new Error('Invalid project image source.');
    const state = JSON.parse(project.state);
    if (!Array.isArray(state.objects) || state.objects.length > 1000) throw new Error('Invalid or oversized layer list.');
    if (state.timeline && (!Array.isArray(state.timeline) || !state.timeline.length || state.timeline.length > 1200 || state.timeline.some((f) => !Number.isInteger(f.sourceIndex) || f.sourceIndex < 0 || !Number.isFinite(f.delay) || f.delay < 10 || f.delay > 10000))) throw new Error('Invalid GIF timeline.');
    if (project.fonts && (!Array.isArray(project.fonts) || project.fonts.length > 12)) throw new Error('Invalid font list.');
  }

  async downloadProject() {
    this.requireMedia();
    if (this.studio.tainted) throw new Error('Upload this image as a file before creating a portable project.');
    const fonts = await Promise.all((await getFontFiles()).map(async (entry) => ({ name: entry.name, data: await fileToDataUrl(entry.blob) })));
    const project = { ...this.studio.toProject(this.hooks.projectTitle.value), fonts };
    downloadBlob(new Blob([JSON.stringify(project)], { type: 'application/json' }), `${slug(project.name)}.memeforge`);
  }

  wireTools() {
    const studio = this.studio;
    $('#canvas-fit').onclick = () => studio.fit();
    $('#zoom-out').onclick = () => studio.zoom(studio.displayScale / 1.25);
    $('#zoom-in').onclick = () => studio.zoom(studio.displayScale * 1.25);
    $('#snap-toggle').onchange = (e) => { studio.snapping = e.target.checked; };
    $('#pan-toggle').onclick = () => {
      this.panning = !this.panning;
      $('#pan-toggle').setAttribute('aria-pressed', String(this.panning));
      studio.stageEl.classList.toggle('is-panning', this.panning);
    };
    $('#crop-open').onclick = () => this.safe(() => this.cropDialog());
    $('#collage-open').onclick = () => this.collageDialog();
    $('#crop-draw').onclick = () => this.safe(() => { this.requireMedia(); this.drawingCrop = !this.drawingCrop; $('#crop-draw').setAttribute('aria-pressed', String(this.drawingCrop)); studio.stageEl.classList.toggle('is-cropping', this.drawingCrop); });
    $('#collage-panel-file').onchange = (e) => this.safe(async () => { const file = e.target.files[0]; try { if (file && this.replaceTarget) await this.replacePanel(this.replaceTarget, file); } finally { e.target.value = ''; } });
    studio.canvas.on('mouse:up', () => { delete studio.stageEl.dataset.guides; });
    const stage = studio.stageEl;
    stage.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); studio.zoom(studio.displayScale * Math.exp(-e.deltaY / 400)); }
    }, { passive: false });
    stage.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.drawingCrop && e.button === 0) {
        e.preventDefault(); e.stopPropagation(); stage.setPointerCapture(e.pointerId);
        this.cropStart = { x: e.clientX, y: e.clientY };
        this.cropGuide = el('div', { class: 'crop-guide' });
        $('#bench').append(this.cropGuide);
        return;
      }
      if (this.panning || e.button === 1 || this.pointers.size === 2) {
        e.preventDefault();
        e.stopPropagation();
        stage.setPointerCapture(e.pointerId);
        this.drag = { x: e.clientX, y: e.clientY, pan: studio.pan || { x: 0, y: 0 } };
        if (this.pointers.size === 2) this.pinch = this.pointerDistance();
      } else if (e.pointerType === 'touch') {
        this.longPress = setTimeout(() => {
          const target = studio.canvas.findTarget(e);
          this.showContext(e.clientX, e.clientY, target);
        }, 650);
      }
    }, { capture: true });
    stage.addEventListener('pointermove', (e) => {
      if (this.cropStart) {
        e.preventDefault(); e.stopPropagation();
        const bounds = $('#bench').getBoundingClientRect();
        Object.assign(this.cropGuide.style, { left: `${Math.min(e.clientX, this.cropStart.x) - bounds.left}px`, top: `${Math.min(e.clientY, this.cropStart.y) - bounds.top}px`, width: `${Math.abs(e.clientX - this.cropStart.x)}px`, height: `${Math.abs(e.clientY - this.cropStart.y)}px` });
        return;
      }
      const last = this.pointers.get(e.pointerId);
      if (last && Math.hypot(e.clientX - last.x, e.clientY - last.y) > 5) clearTimeout(this.longPress);
      if (last) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        e.preventDefault();
        e.stopPropagation();
        const distance = this.pointerDistance();
        if (this.pinch) studio.zoom(studio.displayScale * distance / this.pinch);
        this.pinch = distance;
      } else if (this.drag) {
        e.preventDefault();
        e.stopPropagation();
        studio.pan = { x: this.drag.pan.x + e.clientX - this.drag.x, y: this.drag.pan.y + e.clientY - this.drag.y };
        $('#bench').style.transform = `translate(${studio.pan.x}px, ${studio.pan.y}px)`;
      }
    }, { capture: true });
    for (const name of ['pointerup', 'pointercancel']) stage.addEventListener(name, (e) => {
      if (this.cropStart) {
        e.preventDefault(); e.stopPropagation();
        const bounds = studio.canvas.upperCanvasEl.getBoundingClientRect();
        const pad = studio.paddingPixels;
        const content = studio.contentRect;
        const scale = studio.displayScale;
        const place = studio.imagePlacement;
        const x1 = clamp((Math.min(e.clientX, this.cropStart.x) - bounds.left) / scale - pad.left, 0, studio.mediaCanvas.width);
        const y1 = clamp((Math.min(e.clientY, this.cropStart.y) - bounds.top) / scale - pad.top, 0, studio.mediaCanvas.height);
        const x2 = clamp((Math.max(e.clientX, this.cropStart.x) - bounds.left) / scale - pad.left, 0, studio.mediaCanvas.width);
        const y2 = clamp((Math.max(e.clientY, this.cropStart.y) - bounds.top) / scale - pad.top, 0, studio.mediaCanvas.height);
        const a = clamp((x1 - place.x) * content.width / place.width, 0, content.width), b = clamp((x2 - place.x) * content.width / place.width, 0, content.width);
        const c = clamp((y1 - place.y) * content.height / place.height, 0, content.height), d = clamp((y2 - place.y) * content.height / place.height, 0, content.height);
        if (e.type === 'pointerup' && b - a > 2 && d - c > 2) studio.setCrop({ x: content.x + a, y: content.y + c, width: b - a, height: d - c });
        this.cropGuide?.remove(); this.cropStart = null; this.drawingCrop = false;
        $('#crop-draw').setAttribute('aria-pressed', 'false'); stage.classList.remove('is-cropping');
      }
      this.pointers.delete(e.pointerId);
      this.drag = null;
      this.pinch = null;
      clearTimeout(this.longPress);
    }, { capture: true });
  }

  pointerDistance() { const [a, b] = [...this.pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }

  cropDialog() {
    this.requireMedia();
    const studio = this.studio;
    const rect = studio.contentRect;
    const reset = el('button', { class: 'btn btn-quiet', type: 'button', text: 'Reset crop', onClick: () => { studio.setCrop(null); this.dialog.close(); } });
    this.openDialog('Crop image / all GIF frames', [
      el('p', { class: 'panel-hint', text: 'The original stays in your project. Crop changes the background; layers keep their positions.' }),
      this.number('Left', 'crop-x', rect.x, 0, studio.media.width - 1), this.number('Top', 'crop-y', rect.y, 0, studio.media.height - 1),
      this.number('Width', 'crop-width', rect.width, 1, studio.media.width), this.number('Height', 'crop-height', rect.height, 1, studio.media.height), reset,
    ], () => studio.setCrop({ x: +$('#crop-x').value, y: +$('#crop-y').value, width: +$('#crop-width').value, height: +$('#crop-height').value }));
  }

  collageDialog() {
    const config = this.studio.collage || { layout: '2x1', width: 1000, height: 700, gap: 12, margin: 12, color: '#ffffff' };
    const select = el('select', { id: 'collage-layout', 'aria-label': 'Collage layout' }, [
      el('option', { value: '2x1', text: 'Side by side' }), el('option', { value: '1x2', text: 'Top / bottom' }), el('option', { value: '2x2', text: 'Four panels' }),
    ]);
    select.value = config.layout;
    this.openDialog('Collage / multi-panel meme', [
      el('p', { class: 'panel-hint', text: 'Choose pictures in panel order. Existing text and stickers stay editable. GIF files use their first frame in a collage.' }),
      select,
      this.number('Width', 'collage-width', config.width, 100, 1600), this.number('Height', 'collage-height', config.height, 100, 1600),
      this.number('Panel spacing (px)', 'collage-gap', config.gap, 0, 200), this.number('Outer padding (px)', 'collage-margin', config.margin, 0, 200),
      el('label', { class: 'dialog-field', text: 'Background' }, [el('input', { type: 'color', id: 'collage-color', value: config.color })]),
      el('label', { class: 'dialog-field', text: 'Pictures' }, [el('input', { type: 'file', id: 'collage-files', accept: 'image/*', multiple: true })]),
    ], () => this.createCollage({ layout: select.value, width: +$('#collage-width').value, height: +$('#collage-height').value, gap: +$('#collage-gap').value, margin: +$('#collage-margin').value, color: $('#collage-color').value }, [...$('#collage-files').files]));
  }

  async createCollage(config, files) {
    const studio = this.studio;
    const [cols, rows] = config.layout.split('x').map(Number);
    const count = cols * rows;
    const width = (config.width - 2 * config.margin - (cols - 1) * config.gap) / cols;
    const height = (config.height - 2 * config.margin - (rows - 1) * config.gap) / rows;
    if (width < 20 || height < 20) throw new Error('Reduce spacing or padding to leave room for the pictures.');
    const old = studio.canvas.getObjects().filter((obj) => obj.mfCell != null);
    let urls = await Promise.all(files.slice(0, count).map(fileToDataUrl));
    if (!urls.length && old.length) urls = old.map((obj) => obj.getSrc());
    if (!urls.length && studio.hasMedia) urls = [studio.media.src];
    if (!urls.length) throw new Error('Choose at least one picture.');
    const images = await Promise.all(urls.map(async (src) => (await loadImage(src)).img));
    const background = document.createElement('canvas');
    background.width = config.width;
    background.height = config.height;
    background.getContext('2d').fillStyle = config.color;
    background.getContext('2d').fillRect(0, 0, config.width, config.height);
    const preserved = studio.canvas.getObjects().filter((obj) => obj.mfCell == null);
    studio.restoring = true;
    try {
      studio.canvas.remove(...studio.canvas.getObjects());
      studio.pad = { top: 0, right: 0, bottom: 0, left: 0, color: config.color, unit: 'px' };
      await this.hooks.loadMedia({ src: background.toDataURL('image/png'), name: 'Collage', source: 'upload' });
      studio.collage = config;
      for (let index = 0; index < count; index++) {
        const image = images[index % images.length];
        const ratio = Math.max(width / image.naturalWidth, height / image.naturalHeight);
        const layer = await studio.addImageLayer(urls[index % urls.length], `Panel ${index + 1}`);
        layer.set({ left: config.margin + (index % cols) * (width + config.gap), top: config.margin + Math.floor(index / cols) * (height + config.gap), originX: 'left', originY: 'top', width: width / ratio, height: height / ratio, cropX: (image.naturalWidth - width / ratio) / 2, cropY: (image.naturalHeight - height / ratio) / 2, scaleX: ratio, scaleY: ratio, mfCell: index, lockMovementX: true, lockMovementY: true });
        layer.mfBase = studio.objectProps(layer);
        layer.setCoords();
      }
      preserved.forEach((obj) => studio.canvas.add(obj));
      studio.canvas.discardActiveObject();
    } finally { studio.restoring = false; }
    studio.past = [];
    studio.future = [];
    studio.commit();
    studio.emit('layers');
    studio.emit('selection');
    studio.fit();
  }

  async replacePanel(target, file) {
    const studio = this.studio;
    const index = studio.canvas.getObjects().indexOf(target);
    if (index < 0) return;
    const url = await fileToDataUrl(file);
    const { img } = await loadImage(url);
    const cellWidth = target.width * target.scaleX;
    const cellHeight = target.height * target.scaleY;
    const ratio = Math.max(cellWidth / img.naturalWidth, cellHeight / img.naturalHeight);
    studio.restoring = true;
    try {
      const layer = await studio.addImageLayer(url, target.mfName);
      layer.set({ left: target.left, top: target.top, originX: 'left', originY: 'top', width: cellWidth / ratio, height: cellHeight / ratio, cropX: (img.naturalWidth - cellWidth / ratio) / 2, cropY: (img.naturalHeight - cellHeight / ratio) / 2, scaleX: ratio, scaleY: ratio, mfCell: target.mfCell, lockMovementX: true, lockMovementY: true });
      layer.mfBase = studio.objectProps(layer);
      layer.setCoords();
      studio.canvas.remove(target);
      studio.canvas.moveObjectTo(layer, index);
    } finally { studio.restoring = false; }
    studio.commit(); studio.emit('layers'); studio.emit('selection');
  }

  wireTimeline() {
    const studio = this.studio;
    $('#mode-frame').onclick = () => studio.setMode('frame');
    $('#mode-video').onclick = () => studio.setMode('video');
    $('#frame-prev').onclick = () => studio.seek(studio.frameIndex - 1);
    $('#frame-next').onclick = () => studio.seek(studio.frameIndex + 1);
    $('#timeline-play').onclick = () => studio.toggle();
    $('#timeline-seek').oninput = (e) => studio.editMode === 'frame' ? studio.seek(+e.target.value) : studio.seekTime(+e.target.value);
    $('#frame-number').onchange = (e) => studio.seek(+e.target.value - 1);
    $('#frame-delay').onchange = (e) => studio.editMode === 'frame' ? studio.batchFrames('delay', +e.target.value) : studio.editFrames('delay', studio.frameIndex, studio.frameIndex, +e.target.value);
    $('#fps-apply').onclick = () => studio.editFrames('fps', 0, 0, +$('#gif-fps').value);
    $('#time-trim').onclick = () => { const start = studio.frameAtTime(+$('#time-start').value * 1000); const end = studio.frameAtTime(Math.max(0, +$('#time-end').value * 1000 - 0.001)); studio.editFrames('trim', start, end); };
    $('#frame-copy').onclick = () => this.safe(() => studio.editFrames('duplicate'));
    $('#frame-delete').onclick = () => studio.editFrames('delete');
    $('#frames-reverse').onclick = () => studio.editFrames('reverse');
    $('#frames-trim').onclick = () => studio.editFrames('trim', +$('#trim-start').value - 1, +$('#trim-end').value - 1);
    $('#frames-delay').onclick = () => studio.editFrames('delay', +$('#trim-start').value - 1, +$('#trim-end').value - 1, +$('#frame-delay').value);
    $('#frame-save').onclick = () => this.safe(async () => downloadBlob(await studio.toBlob(), `${slug(this.hooks.projectTitle.value)}-frame-${studio.frameIndex + 1}.png`));
  }

  renderTimeline() {
    const studio = this.studio;
    $('#timeline').hidden = !studio.isAnimated;
    if (!studio.isAnimated) return;
    const count = studio.media.frames.length;
    $('#frame-number').max = count;
    for (const id of ['trim-start', 'trim-end']) {
      const input = $('#' + id);
      input.max = count;
      input.value = id === 'trim-end' ? count : Math.min(+input.value || 1, count);
    }
    $('#time-start').max = studio.duration / 1000;
    $('#time-end').max = studio.duration / 1000;
    $('#time-end').value = (studio.duration / 1000).toFixed(3);
    const strip = $('#frame-strip');
    strip.replaceChildren(...studio.media.frames.map((frame, index) => {
      const thumbnail = document.createElement('canvas');
      thumbnail.width = 64;
      thumbnail.height = 42;
      thumbnail.getContext('2d').drawImage(frame.canvas, 0, 0, 64, 42);
      const button = el('button', { class: 'frame-thumb', type: 'button', 'data-frame': index, draggable: true, title: `Frame ${index + 1} · ${frame.delay.toFixed(1)} ms`, 'aria-label': `Frame ${index + 1}`, onClick: (e) => studio.selectFrames(index, e) }, [thumbnail, el('span', { text: index + 1 })]);
      button.ondragstart = (e) => { e.dataTransfer.setData('text/x-memeforge-frame', String(index)); };
      button.ondragover = (e) => { e.preventDefault(); };
      button.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); const from = e.dataTransfer.getData('text/x-memeforge-frame'); if (from !== '') studio.editFrames('move', Number(from), Number(from), index); };
      button.oncontextmenu = (e) => { e.preventDefault(); studio.seek(index); this.showFrameContext(e.clientX, e.clientY); };
      return button;
    }));
    this.updateTime();
  }

  updateTime() {
    const studio = this.studio;
    if (!studio.isAnimated) return;
    const count = studio.media.frames.length;
    const frameMode = studio.editMode === 'frame';
    $$('.video-time-range').forEach((node) => { node.hidden = frameMode; });
    $('#mode-frame').classList.toggle('is-on', frameMode);
    $('#mode-video').classList.toggle('is-on', !frameMode);
    $('#mode-frame').setAttribute('aria-pressed', String(frameMode));
    $('#mode-video').setAttribute('aria-pressed', String(!frameMode));
    $('#mode-hint').textContent = frameMode ? 'Frame edits affect selected frames. Shift selects a range; Ctrl / Cmd toggles individual frames.' : 'Changes apply across the GIF. Set a layer’s frame range in its controls to show it for part of the clip.';
    $('#timeline-play').textContent = studio.playing ? 'Pause' : 'Play';
    $('#frame-delete').disabled = count === 1;
    $('#timeline-time').textContent = `${time(studio.currentTime)} / ${time(studio.duration)}`;
    $('#timeline-info').textContent = `${count} frames · ${(count * 1000 / studio.duration).toFixed(2)} fps`;
    const seek = $('#timeline-seek');
    seek.max = frameMode ? count - 1 : Math.max(0, studio.duration - 1);
    seek.value = frameMode ? studio.frameIndex : studio.currentTime;
    if (document.activeElement !== $('#frame-number')) $('#frame-number').value = studio.frameIndex + 1;
    if (document.activeElement !== $('#frame-delay')) $('#frame-delay').value = Number((frameMode ? studio.media.frames.find((f) => studio.selectedFrameIds.has(f.id)) || studio.media.frames[studio.frameIndex] : studio.media.frames[studio.frameIndex]).delay.toFixed(2));
    if (document.activeElement !== $('#gif-fps')) $('#gif-fps').value = Number((count * 1000 / studio.duration).toFixed(2));
    for (const button of $$('#frame-strip .frame-thumb')) {
      const selected = studio.selectedFrameIds.has(studio.media.frames[+button.dataset.frame]?.id);
      button.classList.toggle('is-selected', selected); button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-current', String(+button.dataset.frame === studio.frameIndex));
    }
    const previous = $('#frame-strip .is-on');
    previous?.classList.remove('is-on');
    const current = $(`#frame-strip [data-frame="${studio.frameIndex}"]`);
    current?.classList.add('is-on');
    if (current && (studio.playing || frameMode)) {
      const strip = $('#frame-strip');
      if (current.offsetLeft < strip.scrollLeft || current.offsetLeft + current.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = current.offsetLeft - strip.clientWidth / 2;
    }
  }

  wireContext() {
    this.studio.canvas.on('mouse:down', (event) => {
      if (event.e.button === 2) this.showContext(event.e.clientX, event.e.clientY, event.target);
      else this.menu.hidden = true;
    });
    document.addEventListener('pointerdown', (e) => { if (!this.menu.contains(e.target)) this.menu.hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.menu.hidden = true; });
    this.menu.addEventListener('keydown', (e) => {
      const buttons = [...this.menu.querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); buttons[(index + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); }
    });
    this.studio.canvas.upperCanvasEl.addEventListener('keydown', (e) => {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const bounds = this.studio.canvas.upperCanvasEl.getBoundingClientRect(); this.showContext(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, this.studio.selected()); }
    });
    this.studio.canvas.upperCanvasEl.tabIndex = 0;
  }

  menuAt(x, y, actions) {
    this.menu.replaceChildren(...actions.map(([label, action]) => el('button', { type: 'button', role: 'menuitem', text: label, onClick: () => { this.menu.hidden = true; this.safe(action); } })));
    this.menu.hidden = false;
    this.menu.style.left = `${clamp(x, 4, innerWidth - this.menu.offsetWidth - 4)}px`;
    this.menu.style.top = `${clamp(y, 4, innerHeight - this.menu.offsetHeight - 4)}px`;
    this.menu.querySelector('button')?.focus();
  }

  showFrameContext(x, y) {
    this.menuAt(x, y, [['Duplicate frame', () => this.studio.editFrames('duplicate')], ['Delete frame', () => this.studio.editFrames('delete')], ['Save frame PNG', () => $('#frame-save').click()]]);
  }

  showContext(x, y, target) {
    const studio = this.studio;
    if (target) { studio.canvas.setActiveObject(target); studio.emit('selection'); }
    else { studio.canvas.discardActiveObject(); studio.emit('selection'); }
    const selected = studio.selected();
    const actions = [];
    if (selected) {
      actions.push(['Duplicate layer', () => studio.duplicateSelected()], ['Delete layer', () => studio.removeSelected()],
        ['Bring to front', () => { studio.canvas.bringObjectToFront(selected); studio.commit(); studio.emit('layers'); }],
        ['Send to back', () => { studio.canvas.sendObjectToBack(selected); studio.commit(); studio.emit('layers'); }],
        ['Center horizontally', () => studio.alignSelected('x')], ['Center vertically', () => studio.alignSelected('y')],
        [selected.visible ? 'Hide layer' : 'Show layer', () => studio.update({ visible: !selected.visible })],
        [selected.lockMovementX ? 'Unlock layer' : 'Lock layer', () => studio.update({ lockMovementX: !selected.lockMovementX, lockMovementY: !selected.lockMovementY })]);
      if (selected.mfCell != null) actions.push(['Replace panel picture', () => { this.replaceTarget = selected; $('#collage-panel-file').click(); }], ['Edit collage layout / pictures', () => this.collageDialog()]);
      if (selected.text != null) actions.push(['Fit text', () => studio.fitText()]);
      if (studio.isAnimated) actions.push(['Show on every frame', () => { delete selected.mfFrameIds; delete selected.mfOverrides; studio.applyFrame(); studio.commit(); }], ['Show on this frame only', () => studio.setLayerRange(studio.frameIndex, studio.frameIndex)]);
    }
    if (studio.hasMedia) actions.push(['Add text', () => studio.addText()], ['Add box', () => studio.addShape('rect')], ['Crop', () => this.cropDialog()], ['Fit canvas', () => studio.fit()], ['Copy image', () => this.hooks.runExport('clipboard')]);
    else actions.push(['Import image or GIF', () => $('#file-input').click()]);
    this.menuAt(x, y, actions);
  }
}
