// The right-hand column: whatever you have selected, styled here.

import { $, el } from './util.js';
import { TEXT_PRESETS } from './studio.js';
import { loadFont } from './fonts.js';

const SWATCHES = [
  '#ffffff', '#000000', '#ff2d2d', '#ff5a1f', '#ffc542', '#35d07f',
  '#4cc9f0', '#8a5cf6', '#ff2d95', '#7a7f8c',
];

function field(label, control, extra) {
  return el('div', { class: 'field' }, [
    el('label', {}, [label, extra || null]),
    el('div', { class: 'row' }, [].concat(control)),
  ]);
}

function range({ min, max, step = 1, value, format = (v) => v, onInput, onDone }) {
  const out = el('output', { class: 'mono', text: format(value) });
  const input = el('input', {
    type: 'range', min, max, step, value,
    onInput: (e) => {
      const v = parseFloat(e.target.value);
      out.textContent = format(v);
      onInput(v);
    },
    onChange: () => onDone?.(),
  });
  return [input, out];
}

function toggle(label, on, onClick) {
  return el('button', {
    class: `toggle${on ? ' is-on' : ''}`,
    type: 'button',
    text: label,
    onClick,
  });
}

export class Inspector {
  constructor(studio, { onPickFont } = {}) {
    this.studio = studio;
    this.onPickFont = onPickFont;
    this.host = $('#inspector-body');
    this.empty = $('#inspector-empty');
    this.current = null;
    this.frame = null;

    for (const evt of ['selection', 'layers', 'history']) {
      studio.addEventListener(evt, () => this.schedule());
    }
  }

  /** Renders are coalesced into a frame: rebuilding this panel from inside a
   *  blur handler (which is where "commit on change" fires) throws. */
  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  }

  render() {
    const obj = this.studio.selected();

    // Don't yank a control out from under someone mid-drag or mid-sentence.
    const active = document.activeElement;
    const busy = active && this.host.contains(active)
      && (active.tagName === 'TEXTAREA' || active.type === 'range' || active.type === 'color');
    if (busy && obj === this.current) return;
    this.current = obj;

    this.empty.hidden = !!obj;
    this.host.hidden = !obj;
    this.host.replaceChildren();
    if (!obj) return;

    const isText = obj.text != null && obj.mfKind !== 'sticker';
    const kind = obj.mfKind || (isText ? 'text' : 'layer');

    this.host.append(
      el('div', { class: 'insp-head' }, [
        el('span', { class: 'insp-kind', text: kind }),
        el('div', { class: 'layer-tools' }, [
          el('button', { title: 'Duplicate (Ctrl+D)', text: '⧉', onClick: () => this.studio.duplicateSelected() }),
          el('button', { title: 'Bring to front', text: '↑', onClick: () => { this.studio.canvas.bringObjectToFront(obj); this.studio.commit(); this.studio.emit('layers'); } }),
          el('button', { title: 'Send to back', text: '↓', onClick: () => { this.studio.canvas.sendObjectToBack(obj); this.studio.commit(); this.studio.emit('layers'); } }),
          el('button', { title: 'Delete', text: '🗑', onClick: () => this.studio.removeSelected() }),
        ]),
      ]),
    );

    if (isText) this.renderText(obj);
    else this.renderObject(obj);

    this.host.append(
      el('h3', { class: 'sub-title', text: 'Position' }),
      field('Opacity', range({
        min: 10, max: 100, value: Math.round((obj.opacity ?? 1) * 100),
        format: (v) => `${v}%`,
        onInput: (v) => this.studio.update({ opacity: v / 100 }, { commit: false }),
        onDone: () => this.studio.commit(),
      })),
      field('Rotation', range({
        min: -180, max: 180, value: Math.round(obj.angle || 0),
        format: (v) => `${v}°`,
        onInput: (v) => this.studio.update({ angle: v }, { commit: false }),
        onDone: () => this.studio.commit(),
      })),
      el('div', { class: 'toggle-row' }, [
        toggle('Flip ↔', !!obj.flipX, () => this.studio.update({ flipX: !obj.flipX })),
        toggle('Flip ↕', !!obj.flipY, () => this.studio.update({ flipY: !obj.flipY })),
        toggle(obj.lockMovementX ? 'Locked' : 'Unlocked', !!obj.lockMovementX, () => this.studio.update({
          lockMovementX: !obj.lockMovementX,
          lockMovementY: !obj.lockMovementY,
        })),
      ]),
    );
  }

  renderText(obj) {
    const studio = this.studio;

    const area = el('textarea', {
      rows: 2,
      onInput: (e) => {
        const value = obj.mfUpper ? e.target.value.toUpperCase() : e.target.value;
        studio.update({ text: value }, { commit: false });
      },
      onChange: () => studio.commit(),
    });
    area.value = obj.text || '';

    const fontBtn = el('button', {
      class: 'btn btn-block btn-quiet',
      type: 'button',
      onClick: () => this.onPickFont?.(obj.fontFamily),
    }, [el('span', { text: obj.fontFamily }), el('kbd', { text: 'browse' })]);

    this.host.append(
      el('div', { class: 'field' }, [el('label', { text: 'Words' }), area]),
      el('h3', { class: 'sub-title', text: 'Type' }),
      fontBtn,
      el('div', { class: 'preset-row' }, Object.keys(TEXT_PRESETS).map((name) => el('button', {
        class: 'preset',
        type: 'button',
        text: name === 'type' ? 'Typewriter' : name[0].toUpperCase() + name.slice(1),
        onClick: () => this.applyTextPreset(obj, name),
      }))),
      field('Size', range({
        min: 8, max: 260, value: Math.round(obj.fontSize),
        format: (v) => `${v}px`,
        onInput: (v) => studio.update({ fontSize: v }, { commit: false }),
        onDone: () => studio.commit(),
      })),
      field('Outline', range({
        min: 0, max: 40, step: 0.5, value: obj.strokeWidth || 0,
        format: (v) => `${v}px`,
        onInput: (v) => studio.update({ strokeWidth: v, stroke: obj.stroke || '#000000' }, { commit: false }),
        onDone: () => studio.commit(),
      })),
      field('Line height', range({
        min: 0.7, max: 2, step: 0.05, value: obj.lineHeight || 1.05,
        format: (v) => v.toFixed(2),
        onInput: (v) => studio.update({ lineHeight: v }, { commit: false }),
        onDone: () => studio.commit(),
      })),
      field('Letter spacing', range({
        min: -100, max: 800, step: 10, value: obj.charSpacing || 0,
        format: (v) => `${Math.round(v / 10)}`,
        onInput: (v) => studio.update({ charSpacing: v }, { commit: false }),
        onDone: () => studio.commit(),
      })),
      el('h3', { class: 'sub-title', text: 'Colour' }),
      field('Fill', [
        el('input', { type: 'color', value: normalise(obj.fill), onInput: (e) => studio.update({ fill: e.target.value }, { commit: false }), onChange: () => studio.commit() }),
        el('div', { class: 'swatches' }, SWATCHES.map((c) => el('button', {
          class: 'swatch', type: 'button', style: { background: c }, title: c,
          onClick: () => studio.update({ fill: c }),
        }))),
      ]),
      field('Outline colour', [
        el('input', { type: 'color', value: normalise(obj.stroke || '#000000'), onInput: (e) => studio.update({ stroke: e.target.value }, { commit: false }), onChange: () => studio.commit() }),
        el('div', { class: 'swatches' }, SWATCHES.slice(0, 6).map((c) => el('button', {
          class: 'swatch', type: 'button', style: { background: c }, title: c,
          onClick: () => studio.update({ stroke: c }),
        }))),
      ]),
      el('h3', { class: 'sub-title', text: 'Layout' }),
      el('div', { class: 'toggle-row' }, [
        toggle('Left', obj.textAlign === 'left', () => studio.update({ textAlign: 'left' })),
        toggle('Centre', obj.textAlign === 'center', () => studio.update({ textAlign: 'center' })),
        toggle('Right', obj.textAlign === 'right', () => studio.update({ textAlign: 'right' })),
      ]),
      el('div', { class: 'toggle-row' }, [
        toggle('CAPS', !!obj.mfUpper, () => studio.update({ mfUpper: !obj.mfUpper })),
        toggle('Bold', obj.fontWeight === 'bold', () => studio.update({ fontWeight: obj.fontWeight === 'bold' ? 'normal' : 'bold' })),
        toggle('Italic', obj.fontStyle === 'italic', () => studio.update({ fontStyle: obj.fontStyle === 'italic' ? 'normal' : 'italic' })),
        toggle('Glow', !!obj.shadow, () => studio.update({ shadow: obj.shadow ? null : 'rgba(0,0,0,0.6) 0px 4px 14px' })),
      ]),
    );
  }

  renderObject(obj) {
    const studio = this.studio;
    // Emoji carry their own colour and photos have none, so only shapes fill.
    const fillable = obj.mfKind === 'shape';

    if (obj.mfKind === 'sticker') {
      this.host.append(field('Size', range({
        min: 5, max: 200, value: Math.round((obj.scaleX || 1) * 100),
        format: (v) => `${v}%`,
        onInput: (v) => studio.update({ scaleX: v / 100, scaleY: v / 100 }, { commit: false }),
        onDone: () => studio.commit(),
      })));
    }

    if (fillable) {
      this.host.append(
        field('Fill', [
          el('input', {
            type: 'color', value: normalise(obj.fill || '#ff2d2d'),
            onInput: (e) => studio.update({ fill: e.target.value }, { commit: false }),
            onChange: () => studio.commit(),
          }),
          el('div', { class: 'swatches' }, SWATCHES.map((c) => el('button', {
            class: 'swatch', type: 'button', style: { background: c }, title: c,
            onClick: () => studio.update({ fill: c }),
          }))),
        ]),
        field('No fill', el('button', {
          class: 'btn btn-quiet', type: 'button', text: obj.fill ? 'Make it hollow' : 'Fill it in',
          onClick: () => studio.update({ fill: obj.fill ? '' : '#ff2d2d' }),
        })),
      );
    }

    if (obj.stroke !== undefined && obj.mfKind === 'shape') {
      this.host.append(
        field('Outline', range({
          min: 0, max: 40, step: 0.5, value: obj.strokeWidth || 0,
          format: (v) => `${v}px`,
          onInput: (v) => studio.update({ strokeWidth: v, stroke: obj.stroke || '#ffffff' }, { commit: false }),
          onDone: () => studio.commit(),
        })),
        field('Outline colour', el('input', {
          type: 'color', value: normalise(obj.stroke || '#ffffff'),
          onInput: (e) => studio.update({ stroke: e.target.value }, { commit: false }),
          onChange: () => studio.commit(),
        })),
      );
    }
  }

  async applyTextPreset(obj, name) {
    const preset = TEXT_PRESETS[name];
    if (!preset) return;
    const { strokeWidth, ...rest } = preset;
    this.studio.update({ ...rest, strokeWidth: Math.max(0, obj.fontSize * strokeWidth) });
    if (await loadFont(preset.fontFamily)) this.studio.canvas.requestRenderAll();
    this.render();
  }
}

function normalise(colour) {
  if (typeof colour !== 'string' || !colour.startsWith('#')) return '#ffffff';
  if (colour.length === 4) return `#${colour[1]}${colour[1]}${colour[2]}${colour[2]}${colour[3]}${colour[3]}`;
  return colour.slice(0, 7);
}
