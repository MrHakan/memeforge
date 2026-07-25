// The left drawer: templates, trending, text, stickers, adjust, layers, gallery.

import Sortable from '../vendor/sortable.esm.js';
import { $, $$, el, debounce, toast, timeAgo, fileToDataUrl } from './util.js';
import { loadTemplates, searchTemplates, randomTemplate, localTemplates, loadTrending, sourceNotes } from './sources.js';
import { loadCatalogue, getFonts, loadFont, isLoaded, addCustomFont, fontSource } from './fonts.js';
import { DEFAULT_ADJUST } from './studio.js';
import { addFontFile, listProjects, deleteProject } from './store.js';

const STICKERS = [
  ['😂', 'joy laugh cry'], ['💀', 'skull dead'], ['🔥', 'fire lit hot'], ['💯', 'hundred perfect'],
  ['🤡', 'clown'], ['👀', 'eyes look'], ['🧠', 'brain big'], ['🗿', 'moai stone stoic'],
  ['😭', 'sob crying'], ['🥲', 'happy tear'], ['😎', 'cool sunglasses'], ['🤔', 'think hmm'],
  ['😳', 'flushed shock'], ['😱', 'scream shock'], ['🙃', 'upside down'], ['😤', 'triumph steam'],
  ['🤯', 'mind blown'], ['🥴', 'woozy'], ['🫠', 'melting'], ['😴', 'sleep bored'],
  ['👍', 'thumbs up'], ['👎', 'thumbs down'], ['👉', 'point right'], ['👈', 'point left'],
  ['🫵', 'point you'], ['🙏', 'pray thanks'], ['🤝', 'handshake deal'], ['✌️', 'peace'],
  ['💪', 'muscle strong'], ['🫡', 'salute'], ['🤌', 'pinched italian'], ['👏', 'clap'],
  ['❤️', 'heart love'], ['💔', 'broken heart'], ['✨', 'sparkles'], ['⭐', 'star'],
  ['⚡', 'lightning zap'], ['💥', 'boom explosion'], ['💸', 'money flying'], ['💰', 'money bag'],
  ['🏆', 'trophy win'], ['🎯', 'target bullseye'], ['🚀', 'rocket moon'], ['📈', 'chart up stonks'],
  ['📉', 'chart down'], ['🛠️', 'tools fix'], ['🔧', 'wrench'], ['⚙️', 'gear settings'],
  ['🐶', 'dog doge'], ['🐱', 'cat'], ['🐸', 'frog pepe'], ['🐐', 'goat'],
  ['🦆', 'duck'], ['🐍', 'snake python'], ['🦀', 'crab'], ['🐛', 'bug'],
  ['🍕', 'pizza'], ['🍔', 'burger'], ['☕', 'coffee'], ['🍺', 'beer'],
  ['🎉', 'party tada'], ['🎈', 'balloon'], ['🕶️', 'sunglasses deal'], ['👑', 'crown king'],
  ['💊', 'pill'], ['🧨', 'dynamite'], ['🔫', 'water gun'], ['🚨', 'siren alert'],
  ['⛔', 'no stop'], ['✅', 'check yes'], ['❌', 'cross no'], ['❓', 'question'],
  ['❗', 'exclamation'], ['💤', 'zzz sleep'], ['🌚', 'new moon face'], ['🌍', 'earth'],
  ['🕰️', 'clock time'], ['📎', 'clip'], ['📌', 'pin'], ['🖍️', 'crayon'],
];

export class Panels {
  constructor(studio, hooks = {}) {
    this.studio = studio;
    this.hooks = hooks;
    this.current = 'templates';
    this.templateSource = 'all';
    this.fontCategory = 'all';
    this.fontQuery = '';

    this.wireRail();
    this.wireTemplates();
    this.wireTrending();
    this.wireText();
    this.wireStickers();
    this.wireAdjust();
    this.wireLayers();
    this.wireGallery();

    studio.addEventListener('layers', () => {
      // Same reason as the inspector: never rebuild a list from a blur handler.
      if (this.layerFrame) return;
      this.layerFrame = requestAnimationFrame(() => {
        this.layerFrame = null;
        this.renderLayers();
      });
    });
    studio.addEventListener('adjust', () => this.syncAdjust());
    studio.addEventListener('media', () => this.syncAdjust());
  }

  show(name) {
    this.current = name;
    $$('.rail-btn').forEach((b) => b.classList.toggle('is-on', b.dataset.panel === name));
    $$('.panel').forEach((p) => p.classList.toggle('is-on', p.dataset.panel === name));
    $('#drawer').classList.remove('is-hidden');
    if (name === 'trending' && !this.trendingLoaded) this.loadTrending();
    if (name === 'gallery') this.renderGallery();
    if (name === 'layers') this.renderLayers();
    this.hooks.onPanel?.(name);
  }

  wireRail() {
    $$('.rail-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.panel;
        if (window.matchMedia('(max-width: 940px)').matches && this.current === name) {
          $('#drawer').classList.toggle('is-hidden');
          return;
        }
        this.show(name);
      });
    });
  }

  /* ---------------- templates ---------------- */

  async wireTemplates() {
    const grid = $('#template-grid');
    const note = $('#template-note');
    const search = $('#template-search');

    grid.replaceChildren(el('p', { class: 'empty-note', text: 'Fetching templates…' }));

    $$('#template-chips .chip').forEach((chip) => chip.addEventListener('click', () => {
      $$('#template-chips .chip').forEach((c) => c.classList.toggle('is-on', c === chip));
      this.templateSource = chip.dataset.source;
      this.renderTemplates();
    }));

    search.addEventListener('input', debounce(() => this.renderTemplates(), 160));

    $('#random-template').addEventListener('click', () => {
      const pick = randomTemplate();
      if (pick) this.use(pick);
      else toast('No templates loaded yet.', 'bad');
    });

    // uploads
    const zone = $('#drop-zone');
    const input = $('#file-input');
    zone.addEventListener('click', (e) => { if (e.target.tagName !== 'BUTTON') input.click(); });
    $('#browse-btn').addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      if (input.files[0]) this.hooks.onFile?.(input.files[0]);
      input.value = '';
    });
    for (const evt of ['dragenter', 'dragover']) {
      zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.add('is-hot'); });
    }
    for (const evt of ['dragleave', 'drop']) {
      zone.addEventListener(evt, () => zone.classList.remove('is-hot'));
    }

    await loadTemplates();
    const problems = sourceNotes();
    note.textContent = problems.join(' ');
    note.classList.toggle('is-warn', problems.length > 0);
    this.renderTemplates();
  }

  async renderTemplates() {
    const grid = $('#template-grid');
    const query = $('#template-search').value;
    let items = this.templateSource === 'local'
      ? await localTemplates()
      : searchTemplates(query, this.templateSource);

    if (this.templateSource === 'local' && query.trim()) {
      const needle = query.trim().toLowerCase();
      items = items.filter((t) => t.name.toLowerCase().includes(needle));
    }

    if (!items.length) {
      grid.replaceChildren(el('p', {
        class: 'empty-note',
        text: this.templateSource === 'local'
          ? 'Pictures you upload or paste show up here.'
          : 'Nothing matched. Try a shorter word, or upload your own picture.',
      }));
      return;
    }

    grid.replaceChildren(...items.slice(0, 240).map((item) => {
      const tile = el('button', { class: 'tile', role: 'listitem', title: item.name, type: 'button' }, [
        el('img', { src: item.url, alt: item.name, loading: 'lazy' }),
        el('figcaption', { text: item.name }),
      ]);
      if (item.source === 'local') tile.append(el('span', { class: 'badge', text: 'yours' }));
      tile.addEventListener('click', () => this.use(item));
      return tile;
    }));
  }

  use(item) {
    this.hooks.onUseMedia?.({ src: item.url, name: item.name, source: item.source });
  }

  /* ---------------- trending ---------------- */

  wireTrending() {
    $$('#trending-chips .chip').forEach((chip) => chip.addEventListener('click', () => {
      $$('#trending-chips .chip').forEach((c) => c.classList.toggle('is-on', c === chip));
      this.loadTrending(chip.dataset.sub);
    }));
    $('#trending-refresh').addEventListener('click', () => this.loadTrending(undefined, true));
  }

  async loadTrending(sub = $('#trending-chips .chip.is-on')?.dataset.sub || 'memes', force = false) {
    this.trendingLoaded = true;
    const feed = $('#trending-feed');
    const note = $('#trending-note');
    note.textContent = '';
    note.classList.remove('is-warn');
    feed.replaceChildren(el('p', { class: 'empty-note', text: `Loading r/${sub}…` }));

    try {
      const posts = await loadTrending(sub, { force });
      feed.replaceChildren(...posts.map((post) => {
        const card = el('button', { class: 'post', type: 'button' }, [
          el('img', { src: post.preview, alt: '', loading: 'lazy' }),
          el('div', { class: 'post-body' }, [
            el('span', { class: 'post-title', text: post.name }),
            el('span', { class: 'post-meta', text: `r/${post.sub} · ${post.ups ?? 0} points` }),
          ]),
        ]);
        card.addEventListener('click', () => this.hooks.onUseMedia?.({
          src: post.url, name: post.name, source: `r/${post.sub}`,
        }));
        return card;
      }));
    } catch {
      feed.replaceChildren();
      note.textContent = 'The Reddit feed is not reachable right now. Templates and uploads still work.';
      note.classList.add('is-warn');
    }
  }

  /* ---------------- text and fonts ---------------- */

  async wireText() {
    $('#add-classic').addEventListener('click', () => this.hooks.onAddClassic?.());
    $('#add-text').addEventListener('click', () => this.hooks.onAddText?.());

    $$('#text-presets .preset').forEach((btn) => btn.addEventListener('click', () => {
      this.hooks.onTextPreset?.(btn.dataset.preset);
    }));

    $('#font-search').addEventListener('input', debounce((e) => {
      this.fontQuery = e.target.value;
      this.renderFonts();
    }, 140));

    $$('#font-chips .chip').forEach((chip) => chip.addEventListener('click', () => {
      $$('#font-chips .chip').forEach((c) => c.classList.toggle('is-on', c === chip));
      this.fontCategory = chip.dataset.cat;
      this.renderFonts();
    }));

    $('#font-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const family = await addCustomFont(file);
        await addFontFile(file);
        this.renderFonts();
        this.hooks.onFont?.(family);
        toast(`${family} is ready to use.`, 'good');
      } catch {
        toast('That font file could not be read.', 'bad');
      }
      e.target.value = '';
    });

    this.fontObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const family = entry.target.dataset.family;
        this.fontObserver.unobserve(entry.target);
        loadFont(family).then((ok) => {
          if (ok) entry.target.querySelector('span').style.fontFamily = `"${family}"`;
        });
      }
    }, { root: $('#font-list'), rootMargin: '160px' });

    await loadCatalogue();
    const total = getFonts().length;
    $('#font-count').textContent = fontSource() === 'bundled' ? `${total} offline` : `${total}`;
    this.renderFonts();
  }

  renderFonts() {
    const list = $('#font-list');
    const query = this.fontQuery.trim().toLowerCase();
    let fonts = getFonts();
    if (this.fontCategory !== 'all') {
      fonts = fonts.filter((f) => (this.fontCategory === 'serif'
        ? f.category === 'serif'
        : f.category === this.fontCategory));
    }
    if (query) fonts = fonts.filter((f) => f.family.toLowerCase().includes(query));

    const selected = this.studio.selected()?.fontFamily;
    const rows = fonts.slice(0, 120).map((font) => {
      const row = el('button', {
        class: `font-row${font.family === selected ? ' is-on' : ''}`,
        type: 'button',
        'data-family': font.family,
      }, [
        el('span', { text: font.family, style: { fontFamily: isLoaded(font.family) ? `"${font.family}"` : 'inherit' } }),
        el('em', { text: font.custom ? 'yours' : (font.category || '').replace('sans-serif', 'sans') }),
      ]);
      row.addEventListener('click', () => this.hooks.onFont?.(font.family));
      if (!isLoaded(font.family)) this.fontObserver.observe(row);
      return row;
    });

    list.replaceChildren(...(rows.length ? rows : [el('p', { class: 'empty-note', text: 'No font by that name.' })]));
  }

  focusFonts(family) {
    this.show('text');
    const search = $('#font-search');
    search.value = family || '';
    this.fontQuery = search.value;
    this.renderFonts();
    search.focus();
    search.select();
  }

  /* ---------------- stickers ---------------- */

  wireStickers() {
    const grid = $('#sticker-grid');
    const render = (query = '') => {
      const needle = query.trim().toLowerCase();
      const items = STICKERS.filter(([char, words]) => !needle || words.includes(needle) || char === needle);
      grid.replaceChildren(...items.map(([char, words]) => el('button', {
        class: 'sticker', type: 'button', title: words, text: char,
        onClick: () => this.hooks.onSticker?.(char),
      })));
    };
    render();
    $('#sticker-search').addEventListener('input', debounce((e) => render(e.target.value), 120));
    $$('#shape-row .btn').forEach((btn) => btn.addEventListener('click', () => this.hooks.onShape?.(btn.dataset.shape)));

    $('#layer-image-input').addEventListener('change', (e) => {
      if (e.target.files[0]) this.hooks.onImageLayer?.(e.target.files[0]);
      e.target.value = '';
    });
  }

  /* ---------------- adjust ---------------- */

  wireAdjust() {
    const specs = [
      ['brightness', 'Brightness', 20, 200, 1, '%'],
      ['contrast', 'Contrast', 0, 300, 1, '%'],
      ['saturate', 'Saturation', 0, 400, 1, '%'],
      ['hue', 'Hue shift', 0, 360, 1, '°'],
      ['blur', 'Blur', 0, 8, 0.1, 'px'],
      ['crunch', 'JPEG crunch', 0, 100, 1, ''],
    ];
    const host = $('#adjust-sliders');
    this.adjustInputs = {};

    host.replaceChildren(...specs.map(([key, label, min, max, step, unit]) => {
      const out = el('output', { class: 'mono', text: `${DEFAULT_ADJUST[key]}${unit}` });
      const input = el('input', {
        type: 'range', min, max, step, value: DEFAULT_ADJUST[key],
        onInput: (e) => {
          const value = parseFloat(e.target.value);
          out.textContent = `${value}${unit}`;
          if (key === 'crunch') return; // crunch re-encodes, so wait for release
          this.studio.adjust[key] = value;
          this.studio.paintMedia();
        },
        onChange: (e) => this.studio.setAdjust({ [key]: parseFloat(e.target.value) }),
      });
      this.adjustInputs[key] = { input, out, unit };
      return el('div', { class: 'field' }, [
        el('label', { text: label }),
        el('div', { class: 'row' }, [input, out]),
      ]);
    }));

    $$('#filter-presets .preset').forEach((btn) => btn.addEventListener('click', () => {
      $$('#filter-presets .preset').forEach((b) => b.classList.toggle('is-on', b === btn));
      this.studio.applyPreset(btn.dataset.filter);
    }));

    $('#adjust-reset').addEventListener('click', () => {
      $$('#filter-presets .preset').forEach((b) => b.classList.toggle('is-on', b.dataset.filter === 'none'));
      this.studio.applyPreset('none');
      this.studio.setPad({ top: 0 });
      $('#pad-top').value = 0;
      $('#pad-top-out').textContent = '0%';
    });

    const padTop = $('#pad-top');
    padTop.addEventListener('input', (e) => { $('#pad-top-out').textContent = `${e.target.value}%`; });
    padTop.addEventListener('change', (e) => this.studio.setPad({ top: parseInt(e.target.value, 10) }));
    $('#pad-color').addEventListener('change', (e) => this.studio.setPad({ color: e.target.value }));
  }

  syncAdjust() {
    if (!this.adjustInputs) return;
    for (const [key, { input, out, unit }] of Object.entries(this.adjustInputs)) {
      const value = this.studio.adjust[key];
      input.value = value;
      out.textContent = `${value}${unit}`;
      if (key === 'crunch') {
        const off = this.studio.isAnimated;
        input.disabled = off;
        input.title = off ? 'Crunch only works on still pictures.' : '';
      }
    }
    $$('#filter-presets .preset').forEach((b) => b.classList.toggle('is-on', b.dataset.filter === this.studio.filterPreset));
  }

  /* ---------------- layers ---------------- */

  wireLayers() {
    this.layerHost = $('#layer-list');
    this.sortable = Sortable.create(this.layerHost, {
      animation: 130,
      handle: '.layer-grip',
      ghostClass: 'sortable-ghost',
      onEnd: (e) => {
        const count = this.studio.canvas.getObjects().length;
        // The list shows the top layer first, so flip the indexes back over.
        this.studio.reorder(count - 1 - e.oldIndex, count - 1 - e.newIndex);
      },
    });
    this.renderLayers();
  }

  renderLayers() {
    if (!this.layerHost) return;
    const layers = this.studio.layers().slice().reverse();
    $('#layer-count').textContent = layers.length;
    $('#ro-layers').textContent = layers.length;

    if (!layers.length) {
      this.layerHost.replaceChildren(el('p', { class: 'empty-note', text: 'Text, stickers and shapes stack up here.' }));
      return;
    }

    const active = this.studio.selected();
    this.layerHost.replaceChildren(...layers.map(({ obj, kind, name }) => {
      const row = el('div', { class: `layer${obj === active ? ' is-on' : ''}` }, [
        el('span', { class: 'layer-grip', text: '⠿', title: 'Drag to restack' }),
        el('div', {}, [
          el('div', { class: 'layer-name', text: name || kind }),
          el('div', { class: 'layer-kind', text: kind }),
        ]),
        el('div', { class: 'layer-tools' }, [
          el('button', {
            title: obj.visible === false ? 'Show' : 'Hide',
            text: obj.visible === false ? '🚫' : '👁',
            onClick: (e) => {
              e.stopPropagation();
              obj.set('visible', obj.visible === false);
              this.studio.canvas.requestRenderAll();
              this.studio.commit();
              this.renderLayers();
            },
          }),
          el('button', {
            title: 'Delete',
            text: '🗑',
            onClick: (e) => {
              e.stopPropagation();
              this.studio.canvas.remove(obj);
              this.studio.emit('layers');
            },
          }),
        ]),
      ]);
      row.addEventListener('click', () => {
        this.studio.canvas.setActiveObject(obj);
        this.studio.canvas.requestRenderAll();
        this.studio.emit('selection');
        this.renderLayers();
      });
      return row;
    }));
  }

  /* ---------------- gallery ---------------- */

  wireGallery() {
    $('#gallery-new').addEventListener('click', () => this.hooks.onNewProject?.());
  }

  async renderGallery() {
    const host = $('#gallery-list');
    const projects = await listProjects();
    if (!projects.length) {
      host.replaceChildren(el('p', { class: 'empty-note', text: 'Nothing saved yet. Hit Save and your meme lands here.' }));
      return;
    }
    host.replaceChildren(...projects.map((project) => el('div', { class: 'gallery-card' }, [
      el('img', {
        src: project.thumb, alt: project.name, title: 'Open',
        onClick: () => this.hooks.onOpenProject?.(project),
      }),
      el('div', { class: 'gallery-meta' }, [
        el('b', { text: project.name }),
        el('span', { text: timeAgo(project.updated) }),
      ]),
      el('div', { class: 'layer-tools' }, [
        el('button', { title: 'Open', text: '↗', onClick: () => this.hooks.onOpenProject?.(project) }),
        el('button', {
          title: 'Delete',
          text: '🗑',
          onClick: async () => {
            await deleteProject(project.id);
            this.renderGallery();
            toast('Deleted.', '');
          },
        }),
      ]),
    ])));
  }
}

export { fileToDataUrl };
