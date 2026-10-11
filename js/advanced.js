// Timeline tracks, batch edits and optional output processing.
import { $, el, clamp, toast, downloadBlob, slug, fileToDataUrl } from './util.js';
import { decodeGif, encodeGif, openVideo, videoFrames, combineGifs, gifFootprint } from './media.js';

const field = (label, input) => el('label', { class: 'dialog-field', text: label }, [input]);
const select = (id, values, value) => {
  const node = el('select', { id }, values.map(([v, name]) => el('option', { value: v, text: name })));
  node.value = value; return node;
};
const button = (id, label, fn) => el('button', { ...(id ? { id } : {}), type: 'button', class: 'btn btn-quiet', text: label, onClick: fn });
const size = (bytes) => bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(2)} MB`;

export class Advanced {
  constructor(studio, bench) {
    this.studio = studio; this.bench = bench;
    this.installTools(); this.installBatch();
    studio.addTemplateText = (name) => this.captionLayout('auto', name);
    for (const name of ['layers', 'timeline', 'media']) studio.addEventListener(name, () => this.scheduleTracks());
    for (const name of ['frame', 'play', 'view', 'adjust', 'change']) studio.addEventListener(name, () => { this.updatePlayhead(); this.paintOnion(); });
    studio.canvas.on('selection:created', () => this.scheduleTracks());
    studio.canvas.on('selection:updated', () => this.scheduleTracks());
    studio.canvas.on('selection:cleared', () => this.scheduleTracks());
    studio.canvas.on('object:added', () => this.scheduleTracks());
    studio.canvas.on('object:removed', () => this.scheduleTracks());
    this.scheduleTracks();
  }

  installTools() {
    const tools = el('div', { class: 'advanced-tools', 'aria-label': 'Creative tools' }, [
      button('caption-layout', 'Smart captions', () => this.bench.safe(() => this.captionDialog())),
      button('motion-open', 'Motion', () => this.bench.safe(() => this.motionDialog())),
      button('drawing-open', 'Draw / effects', () => this.bench.safe(() => this.drawDialog())),
      button('video-open', 'Video to GIF', () => $('#video-file').click()),
      button('merge-gifs', 'Combine GIFs', () => this.combineDialog()),
      button('optimize-open', 'GIF output', () => this.bench.safe(() => this.optimizeDialog())),
    ]);
    $('#stage').before(tools);
    const file = el('input', { id: 'video-file', type: 'file', accept: 'video/mp4,video/webm,video/quicktime', hidden: true });
    file.onchange = () => { const picked = file.files[0]; file.value = ''; if (picked) this.videoDialog(picked); };
    document.body.append(file);
    this.onion = el('canvas', { class: 'onion-overlay', 'aria-hidden': 'true', hidden: true });
    studioContainer(this.studio).append(this.onion);
  }

  installBatch() {
    const s = this.studio;
    const row = el('div', { class: 'timeline-row batch-tools' }, [
      el('span', { id: 'selection-count', class: 'panel-hint', text: '1 frame selected' }),
      button('select-all-frames', 'Select all', () => { s.selectedFrameIds = new Set(s.media.frames.map((f) => f.id)); s.emit('frame'); }),
      button('select-current-frame', 'Current only', () => s.seek(s.frameIndex)),
      button('selected-delay', 'Set selected delay', () => s.batchFrames('delay', +$('#frame-delay').value)),
      button('copy-frame-edits', 'Copy current edits to selected', () => s.copyFrameEdits()),
      button('selected-delete', 'Delete selected', () => this.bench.safe(() => s.batchFrames('delete'))),
      field('Onion skin', el('input', { id: 'onion-toggle', type: 'checkbox', onChange: () => this.paintOnion() })),
      field('Ghost opacity', el('input', { id: 'onion-opacity', type: 'range', min: 5, max: 60, value: 20, onInput: () => this.paintOnion() })),
    ]);
    $('#timeline').append(row);
    this.trackBox = el('div', { id: 'layer-tracks', class: 'layer-tracks', 'aria-label': 'Layer timing tracks' });
    $('#frame-strip').before(this.trackBox);
  }

  scheduleTracks() {
    if (this.trackFrame || this.trackDrag) return;
    this.trackFrame = requestAnimationFrame(() => { this.trackFrame = null; this.renderTracks(); });
  }

  renderTracks() {
    if (this.trackFrame) { cancelAnimationFrame(this.trackFrame); this.trackFrame = null; }
    const s = this.studio;
    if (!s.canvas.isDrawingMode) $('#drawing-stop')?.remove();
    this.trackBox.replaceChildren();
    if (!s.isAnimated) { this.onion.hidden = true; return; }
    if (!s.canvas.getObjects().length) this.trackBox.append(el('p', { class: 'panel-hint', text: 'Add text or a sticker to see its timing track. Drag a strip to move it; drag its ends to trim.' }));
    const frames = s.media.frames; let at = 0;
    const starts = frames.map((f) => { const t = at; at += f.delay; return t; });
    s.layers().forEach(({ obj, name }) => {
      const row = el('div', { class: 'track-row' });
      const label = button('', name, () => { s.pause(); s.canvas.setActiveObject(obj); s.emit('selection'); this.scheduleTracks(); });
      label.classList.add('track-label'); label.title = name;
      label.setAttribute('aria-pressed', String(s.selected() === obj));
      const lane = el('div', { class: 'track-lane' });
      lane.onclick = (e) => { if (e.target === lane) s.seekTime(clamp((e.clientX - lane.getBoundingClientRect().left) / lane.clientWidth, 0, 1) * s.duration); };
      const runs = [];
      frames.forEach((f, i) => {
        const visible = obj.mfFrameIds ? obj.mfFrameIds.includes(f.id) : (obj.mfStart == null || i >= obj.mfStart) && (obj.mfEnd == null || i <= obj.mfEnd);
        if (!visible) return;
        if (runs.at(-1)?.[1] === i - 1) runs.at(-1)[1] = i; else runs.push([i, i]);
      });
      for (const [first, last] of runs) {
        const bar = el('div', { class: 'track-bar', tabindex: 0, role: 'group', 'aria-label': `${name}, frames ${first + 1} to ${last + 1}`, title: 'Drag to move. Arrow keys move; Shift+Arrow resizes the end.' }, [
          el('span', { class: 'track-handle start', role: 'slider', tabindex: 0, 'aria-label': 'Layer start frame', 'aria-valuemin': 1, 'aria-valuemax': frames.length, 'aria-valuenow': first + 1 }),
          el('span', { class: 'track-caption', text: obj.mfAnimation ? `${name} · ${obj.mfAnimation.kind}` : name }),
          el('span', { class: 'track-handle end', role: 'slider', tabindex: 0, 'aria-label': 'Layer end frame', 'aria-valuemin': 1, 'aria-valuemax': frames.length, 'aria-valuenow': last + 1 }),
        ]);
        const position = (a, b) => { bar.style.left = `${starts[a] / s.duration * 100}%`; bar.style.width = `${(starts[b] + frames[b].delay - starts[a]) / s.duration * 100}%`; };
        const apply = (a, b) => {
          const previous = obj.mfFrameIds || frames.slice(obj.mfStart ?? 0, (obj.mfEnd ?? frames.length - 1) + 1).map((f) => f.id);
          const old = new Set(frames.slice(first, last + 1).map((f) => f.id));
          obj.mfFrameIds = [...new Set(previous.filter((id) => !old.has(id)).concat(frames.slice(a, b + 1).map((f) => f.id)))];
          delete obj.mfStart; delete obj.mfEnd;
          s.applyFrame(); s.paintMedia(); s.commit(); s.emit('layers'); this.renderTracks();
        };
        position(first, last);
        bar.onpointerdown = (e) => {
          if (e.button !== 0) return;
          e.preventDefault(); e.stopPropagation(); s.pause();
          if (this.trackFrame) { cancelAnimationFrame(this.trackFrame); this.trackFrame = null; }
          this.trackDrag = true;
          s.canvas.setActiveObject(obj); s.emit('selection');
          const type = e.target.classList.contains('start') ? 'start' : e.target.classList.contains('end') ? 'end' : 'move';
          const x = e.clientX, initialTime = starts[first]; let a = first, b = last;
          this.trackDrag = true; bar.setPointerCapture(e.pointerId);
          const move = (event) => {
            const delta = (event.clientX - x) / lane.clientWidth * s.duration;
            if (type === 'start') a = clamp(s.frameAtTime(starts[first] + delta), 0, b);
            else if (type === 'end') b = clamp(s.frameAtTime(starts[last] + delta), a, frames.length - 1);
            else { a = clamp(s.frameAtTime(initialTime + delta), 0, frames.length - (last - first + 1)); b = a + last - first; }
            position(a, b);
          };
          const finish = (event) => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', finish); bar.removeEventListener('pointercancel', finish); this.trackDrag = false; if (event.type === 'pointerup') apply(a, b); else this.renderTracks(); };
          bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', finish); bar.addEventListener('pointercancel', finish);
        };
        bar.onkeydown = (e) => {
          if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
          e.preventDefault(); e.stopPropagation(); const d = e.key === 'ArrowLeft' ? -1 : 1;
          if (e.target.classList.contains('start')) apply(clamp(first + d, 0, last), last);
          else if (e.shiftKey || e.target.classList.contains('end')) apply(first, clamp(last + d, first, frames.length - 1));
          else { const a = clamp(first + d, 0, frames.length - (last - first + 1)); apply(a, a + last - first); }
          const updated = this.trackBox.children[s.canvas.getObjects().indexOf(obj)]?.querySelector('.track-bar');
          const focus = e.target.classList.contains('start') ? updated?.querySelector('.start') : e.target.classList.contains('end') ? updated?.querySelector('.end') : updated;
          focus?.focus();
        };
        lane.append(bar);
      }
      lane.append(el('i', { class: 'track-playhead', 'aria-hidden': 'true' }));
      row.append(label, lane); this.trackBox.append(row);
    });
    this.updatePlayhead(); this.paintOnion();
  }

  updatePlayhead() {
    const s = this.studio;
    if (!s.isAnimated) return;
    $('#selection-count').textContent = `${s.editingFrameIds().length} frames selected · Shift range / Ctrl toggle`;
    for (const node of this.trackBox.querySelectorAll('.track-playhead')) node.style.left = `${s.currentTime / s.duration * 100}%`;
  }

  paintOnion() {
    const s = this.studio;
    this.onion.hidden = !s.isAnimated || !$('#onion-toggle').checked || s.playing;
    if (this.onion.hidden) return;
    this.onion.width = s.canvas.width; this.onion.height = s.canvas.height;
    this.onion.style.width = s.canvas.upperCanvasEl.style.width; this.onion.style.height = s.canvas.upperCanvasEl.style.height;
    const ctx = this.onion.getContext('2d'), rect = s.contentRect, pad = s.paddingPixels, place = s.imagePlacement;
    ctx.beginPath(); ctx.rect(pad.left, pad.top, s.mediaCanvas.width, s.mediaCanvas.height); ctx.clip();
    ctx.globalAlpha = +$('#onion-opacity').value / 100;
    for (const i of [s.frameIndex - 1, s.frameIndex + 1]) {
      const f = s.media.frames[i]; if (!f) continue;
      const sx = f.canvas.width / s.media.width, sy = f.canvas.height / s.media.height;
      ctx.drawImage(f.canvas, rect.x * sx, rect.y * sy, rect.width * sx, rect.height * sy, pad.left + place.x, pad.top + place.y, place.width, place.height);
    }
  }

  motionDialog() {
    this.bench.requireMedia(); const s = this.studio;
    if (!s.isAnimated) throw new Error('Motion needs an animated GIF.');
    if (!s.selected()) throw new Error('Select a layer first.');
    const a = s.selected().mfAnimation || { kind: 'none', duration: 500, strength: 20 };
    const kind = select('motion-kind', [['none', 'None'], ['fade', 'Fade in'], ['slide', 'Slide in'], ['shake', 'Shake'], ['zoom', 'Zoom in']], a.kind);
    this.bench.openDialog('Layer motion', [field('Effect', kind), this.bench.number('Duration (ms)', 'motion-duration', a.duration, 10, 10000), this.bench.number('Strength (pixels / zoom %)', 'motion-strength', a.strength, 1, 100), el('p', { class: 'panel-hint', text: 'Motion starts at the beginning of this layer’s timing strip. Base position and frame edits stay editable.' })], () => s.setAnimation({ kind: kind.value, duration: +$('#motion-duration').value, strength: +$('#motion-strength').value }));
  }

  drawDialog() {
    this.bench.requireMedia();
    const kind = select('draw-kind', [['none', 'Selection tool'], ['pen', 'Pen'], ['highlight', 'Highlighter'], ['bubble', 'Speech bubble'], ['blur', 'Regional background blur'], ['pixelate', 'Regional background pixelation']], 'pen');
    this.bench.openDialog('Draw and regional effects', [field('Tool', kind), field('Color', el('input', { id: 'draw-color', type: 'color', value: '#ff2d2d' })), this.bench.number('Brush width / effect strength', 'draw-width', 12, 1, 100), el('p', { class: 'panel-hint', text: 'Drawing creates editable path layers. Regional effects process the background inside a movable box. In Frame mode they follow the selected frames.' })], () => {
      const k = kind.value; this.studio.setDrawing(['pen', 'highlight'].includes(k) ? k : 'none', $('#draw-color').value, +$('#draw-width').value);
      if (['blur', 'pixelate'].includes(k)) this.studio.addRegion(k, +$('#draw-width').value);
      if (k === 'bubble') this.studio.addShape('bubble');
      $('#drawing-stop')?.remove();
      if (['pen', 'highlight'].includes(k)) $('.advanced-tools').append(button('drawing-stop', 'Finish drawing', () => { this.studio.setDrawing('none'); $('#drawing-stop').remove(); }));
    });
  }

  captionDialog() {
    this.bench.requireMedia();
    const kind = select('caption-kind', [['auto', 'Recognize template'], ['classic', 'Inside: top / bottom'], ['outside', 'Outside: white caption band'], ['drake', 'Drake: two right panels'], ['buttons', 'Two Buttons'], ['distracted', 'Distracted Boyfriend'], ['brain', 'Expanding Brain: four rows']], 'auto');
    this.bench.openDialog('Caption placement', [field('Layout', kind), el('p', { class: 'panel-hint', text: 'Adds editable text boxes. Personal templates keep their text, styles, layers and GIF timing.' })], () => this.captionLayout(kind.value, this.studio.media.name));
  }

  captionLayout(kind, name = '') {
    const s = this.studio;
    if (!s.hasMedia) return;
    if (kind === 'auto') {
      const n = name.toLowerCase();
      kind = /drake/.test(n) ? 'drake' : /two buttons|iki düğme/.test(n) ? 'buttons' : /distracted boyfriend/.test(n) ? 'distracted' : /expanding brain/.test(n) ? 'brain' : null;
      if (!kind) return;
    }
    const before = s.restoring; s.restoring = true;
    try {
      if (kind === 'classic') { s.addClassicText(); return; }
      if (kind === 'outside') {
        s.setPad({ top: Math.max(s.paddingPixels.top, Math.round(s.media.height * 0.2)), color: '#ffffff', unit: 'px' });
        const obj = s.addText('Your caption', { top: s.paddingPixels.top / 2, fontFamily: 'Archivo', fill: '#111111', stroke: '', strokeWidth: 0, mfUpper: false, fontSize: Math.max(12, s.paddingPixels.top * 0.4) });
        s.rememberObject(obj); return;
      }
      const layouts = {
        drake: [[0.75, 0.25, 0.42], [0.75, 0.75, 0.42]],
        buttons: [[0.27, 0.24, 0.29], [0.68, 0.19, 0.29]],
        distracted: [[0.18, 0.72, 0.28], [0.54, 0.67, 0.28], [0.82, 0.64, 0.28]],
        brain: [0.125, 0.375, 0.625, 0.875].map((y) => [0.25, y, 0.44]),
      };
      const rect = s.contentRect, pad = s.paddingPixels;
      for (const [x, y, w] of layouts[kind] || []) {
        const obj = s.addText('Your text', { left: pad.left + rect.width * x, top: pad.top + rect.height * y, width: rect.width * w, fontSize: Math.max(10, rect.width * 0.045), mfUpper: false }); s.rememberObject(obj);
      }
    } finally { s.restoring = before; s.commit(); s.emit('layers'); }
  }

  optimizeDialog(scale = 1) {
    this.bench.requireMedia();
    if (!this.studio.isAnimated) throw new Error('Load a GIF first.');
    const width = this.bench.number('Output width (px)', 'output-width', Math.round(this.studio.canvas.width * scale), 16, 2880);
    const colors = select('output-colors', [[256, '256 · adaptive colors'], [128, '128'], [64, '64'], [32, '32']], 256);
    const quality = select('output-quality', [[1, 'High detail (slower)'], [8, 'Balanced'], [20, 'Fast']], 8);
    const note = el('p', { id: 'output-info', class: 'panel-hint', text: 'Generate a preview to see the actual file size. The editable project keeps every source frame.' });
    const image = el('img', { id: 'output-preview', class: 'output-preview', alt: 'Encoded GIF preview', hidden: true });
    let result = null, previewUrl = null, running = false;
    const abort = new AbortController();
    const progress = el('progress', { id: 'output-progress', max: 1, value: 0, hidden: true });
    const generate = button('output-generate', 'Generate preview', () => this.bench.safe(async () => {
      if (running) return;
      running = true; result = null; $('#editor-apply').disabled = true; generate.disabled = true; progress.hidden = false;
      const controls = [...$('#editor-dialog-body').querySelectorAll('input, select')]; controls.forEach((n) => { n.disabled = true; });
      try {
        const originalWidth = this.studio.canvas.width;
        let options = { scale: clamp(+$('#output-width').value / originalWidth, 16 / originalWidth, 2880 / originalWidth), colors: +colors.value, quality: +quality.value, drop: +$('#output-drop').value, merge: $('#output-merge').checked, dither: $('#output-dither').checked, repeat: +$('#output-loop').value };
        const target = Math.max(0, +$('#output-target').value) * 1048576;
        const minimumScale = Math.min(options.scale, 16 / originalWidth);
        for (let pass = 0; pass < (target ? 5 : 1); pass++) {
          note.textContent = `Encoding preview${target ? ` · attempt ${pass + 1}/5` : ''}…`;
          result = await this.studio.toGifBlob({ ...options, signal: abort.signal, onProgress: (p) => { progress.value = p; } });
          if (!target || result.size <= target) break;
          if (pass < 4) options = { ...options, scale: Math.max(minimumScale, options.scale * 0.78), colors: options.colors === 256 ? 128 : options.colors === 128 ? 64 : 32 };
        }
        if (!this.bench.dialog.open || !image.isConnected) { result = null; return; }
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(result); image.src = previewUrl; image.hidden = false;
        note.textContent = `${size(result.size)} · ${Math.round(originalWidth * options.scale)}×${Math.round(this.studio.canvas.height * options.scale)} · ${options.colors} colors${target && result.size > target ? ' · Target could not be reached in five attempts; lower width or increase frame skipping.' : target ? ' · Target reached' : ''}`;
        $('#editor-apply').disabled = false;
      } finally { running = false; generate.disabled = false; progress.hidden = true; controls.forEach((n) => { n.disabled = false; }); }
    }));
    this.bench.openDialog('GIF output and optimization', [width, field('Colors', colors), field('Quality', quality), field('Frame skipping', select('output-drop', [[1, 'Keep every frame'], [2, 'Keep every second frame'], [3, 'Keep every third frame'], [4, 'Keep every fourth frame']], 1)),
      field('Merge identical rendered frames', el('input', { id: 'output-merge', type: 'checkbox', checked: true })), field('Dither reduced colors', el('input', { id: 'output-dither', type: 'checkbox' })),
      field('Loop', select('output-loop', [[0, 'Forever'], [-1, 'Play once'], [1, 'Repeat once'], [2, 'Repeat twice']], 0)), this.bench.number('Optional target size (MB, 0 = off)', 'output-target', 0, 0, 100), generate, progress, note, image,
    ], () => { if (!result) throw new Error('Generate a preview first.'); downloadBlob(result, `${slug(this.bench.hooks.projectTitle.value)}.gif`); }, 'Download GIF');
    $('#output-target').step = '0.1'; $('#editor-apply').disabled = true;
    const invalidate = () => { result = null; $('#editor-apply').disabled = true; image.hidden = true; note.textContent = 'Settings changed. Generate a new preview.'; };
    $('#editor-dialog-body').addEventListener('input', invalidate);
    this.bench.dialog.addEventListener('close', () => { abort.abort(); if (previewUrl) URL.revokeObjectURL(previewUrl); $('#editor-dialog-body').removeEventListener('input', invalidate); $('#editor-apply').disabled = false; }, { once: true });
  }

  videoDialog(file) {
    return this.bench.safe(async () => {
      const source = await openVideo(file), video = source.video;
      const abort = new AbortController();
      const progress = el('progress', { max: 1, value: 0 });
      video.controls = true; video.className = 'video-preview';
      this.bench.openDialog(`Video to GIF · ${file.name}`, [video,
        this.bench.number('Start (s)', 'video-start', 0, 0, video.duration), this.bench.number('End (s)', 'video-end', Math.min(5, video.duration), 0.01, video.duration), this.bench.number('FPS', 'video-fps', 24, 1, 60), this.bench.number('Width (px)', 'video-width', Math.min(480, video.videoWidth), 32, 720),
        el('p', { class: 'panel-hint', text: 'Audio is omitted. The selected section becomes an editable GIF with frame-level controls. Your browser must support the video codec.' }), progress,
      ], async () => {
        $('#editor-apply').disabled = true; video.pause();
        try {
          const clip = await videoFrames(video, { start: +$('#video-start').value, end: +$('#video-end').value, fps: +$('#video-fps').value, width: +$('#video-width').value, signal: abort.signal, onProgress: (p) => { progress.value = p * 0.6; } });
          const blob = await encodeGif({ width: clip.width, height: clip.height, count: clip.frames.length, frameAt: (i) => clip.frames[i], signal: abort.signal, onProgress: (p) => { progress.value = 0.6 + p * 0.4; } });
          if (abort.signal.aborted) return;
          if (!await this.bench.hooks.loadMedia({ src: await fileToDataUrl(blob), kind: 'gif', name: file.name.replace(/\.[^.]+$/, ''), source: 'upload' })) throw new Error('The converted GIF could not be opened.');
          this.studio.pause(); this.studio.setMode('video');
        } finally { if (video.isConnected) $('#editor-apply').disabled = false; }
      }, 'Import GIF');
      for (const id of ['video-start', 'video-end']) $('#' + id).step = '0.001';
      this.bench.dialog.addEventListener('close', () => { abort.abort(); source.close(); $('#editor-apply').disabled = false; }, { once: true });
    });
  }

  combineDialog() {
    const files = el('input', { id: 'combine-files', type: 'file', accept: 'image/gif', multiple: true, required: true });
    const mode = select('combine-mode', [['sequence', 'One after another'], ['parallel', 'Side by side']], 'sequence');
    const progress = el('progress', { max: 1, value: 0 }); let cancelled = false; const abort = new AbortController();
    this.bench.openDialog('Combine GIFs', [field('GIF files (in order)', files), field('Mode', mode), this.bench.number('Output width (px)', 'combine-width', 480, 32, 720), el('p', { class: 'panel-hint', text: 'Each clip keeps its timing. Side-by-side clips start together; a shorter clip holds its last frame. The result opens as a new editable GIF background; existing overlays stay.' }), progress], async () => {
      $('#editor-apply').disabled = true;
      try {
        const picked = [...files.files]; if (picked.length < 2 || picked.length > 6) throw new Error('Choose 2–6 GIFs.');
        const clips = [];
        let decodedBytes = 0;
        for (const f of picked) {
          const buffer = await f.arrayBuffer(); decodedBytes += gifFootprint(buffer);
          if (decodedBytes > 192 * 1024 * 1024) throw new Error('These GIFs use too much memory together. Choose smaller clips.');
          clips.push(decodeGif(buffer));
        }
        const clip = combineGifs(clips, mode.value, +$('#combine-width').value);
        const blob = await encodeGif({ width: clip.width, height: clip.height, count: clip.frames.length, frameAt: (i) => clip.frames[i], signal: abort.signal, onProgress: (p) => { progress.value = p; } });
        if (cancelled) return;
        await this.bench.hooks.loadMedia({ src: await fileToDataUrl(blob), kind: 'gif', name: 'Combined GIF', source: 'upload' }); this.studio.pause();
      } finally { if (files.isConnected) $('#editor-apply').disabled = false; }
    }, 'Combine and open');
    this.bench.dialog.addEventListener('close', () => { cancelled = true; abort.abort(); $('#editor-apply').disabled = false; }, { once: true });
  }
}

function studioContainer(studio) { return studio.canvas.upperCanvasEl.parentElement; }
