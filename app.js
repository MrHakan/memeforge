class MemeForgeApp {
    constructor() {
        this.editor = null;
        this.currentTemplate = null;
        this.templates = [];

        this.init();
    }

    async init() {
        this.editor = new MemeEditor('meme-canvas', 'text-boxes-overlay');
        window.app = this;

        this.elements = {
            templateSearch: document.getElementById('template-search'),
            templateGrid: document.getElementById('template-grid'),
            noSelectionHint: document.getElementById('no-selection-hint'),
            selectedTextControls: document.getElementById('selected-text-controls'),
            selectedText: document.getElementById('selected-text'),
            selectedFillColor: document.getElementById('selected-fill-color'),
            selectedStrokeColor: document.getElementById('selected-stroke-color'),
            selectedFontSize: document.getElementById('selected-font-size'),
            selectedFontSizeValue: document.getElementById('selected-font-size-value'),
            selectedStrokeWidth: document.getElementById('selected-stroke-width'),
            selectedStrokeWidthValue: document.getElementById('selected-stroke-width-value'),
            selectedFontFamily: document.getElementById('selected-font-family'),
            deleteTextBtn: document.getElementById('delete-text-btn'),
            templateTabs: document.getElementById('template-tabs'),
            loadMoreBtn: document.getElementById('load-more-btn'),
            generateBtn: document.getElementById('generate-btn'),
            downloadBtn: document.getElementById('download-btn'),
            resetBtn: document.getElementById('reset-btn'),
            addTextBtn: document.getElementById('add-text-btn'),
            uploadArea: document.getElementById('upload-area'),
            uploadInput: document.getElementById('upload-input'),
            canvasContainer: document.getElementById('canvas-container')
        };

        this.bindEvents();

        if (this.elements.templateGrid) {
            this.elements.templateGrid.innerHTML = '<div class="loading-templates">Loading templates...</div>';
        }

        this.templates = await fetchTemplates();

        const popularTemplates = getTemplatesByCategory('popular');
        this.renderTemplateGrid(popularTemplates);

        const urlParams = new URLSearchParams(window.location.search);
        const templateId = urlParams.get('template');

        if (templateId) {
            const template = getTemplateById(parseInt(templateId));
            if (template) {
                this.loadTemplate(template);
                return;
            }
        }

        if (popularTemplates.length > 0) {
            this.loadTemplate(popularTemplates[0]);
        }
    }

    bindEvents() {
        this.elements.templateSearch?.addEventListener('input', (e) => {
            const results = searchTemplates(e.target.value);
            this.renderTemplateGrid(results);
        });

        this.elements.templateTabs?.addEventListener('click', (e) => {
            if (e.target.classList.contains('tab-btn')) {
                this.elements.templateTabs.querySelectorAll('.tab-btn').forEach(btn => {
                    btn.classList.remove('active');
                });
                e.target.classList.add('active');

                const category = e.target.dataset.category;
                setCategory(category);
                this.elements.templateSearch.value = '';
                this.renderTemplateGrid(getTemplatesByCategory(category));
            }
        });

        this.elements.loadMoreBtn?.addEventListener('click', () => {
            loadMore();
            const templates = this.elements.templateSearch.value
                ? searchTemplates(this.elements.templateSearch.value)
                : getTemplatesByCategory(getCurrentCategory());
            this.renderTemplateGrid(templates);
        });

        this.elements.selectedText?.addEventListener('input', (e) => {
            if (this.editor.selectedTextBox) {
                this.editor.updateTextBox(this.editor.selectedTextBox, { text: e.target.value });
            }
        });

        this.elements.selectedFillColor?.addEventListener('input', (e) => {
            if (this.editor.selectedTextBox) {
                this.editor.updateTextBox(this.editor.selectedTextBox, { fillColor: e.target.value });
            }
        });

        this.elements.selectedStrokeColor?.addEventListener('input', (e) => {
            if (this.editor.selectedTextBox) {
                this.editor.updateTextBox(this.editor.selectedTextBox, { strokeColor: e.target.value });
            }
        });

        this.elements.selectedFontSize?.addEventListener('input', (e) => {
            const size = parseInt(e.target.value);
            this.elements.selectedFontSizeValue.textContent = size + 'px';
            if (this.editor.selectedTextBox) {
                this.editor.updateTextBox(this.editor.selectedTextBox, { fontSize: size });
            }
        });

        this.elements.selectedStrokeWidth?.addEventListener('input', (e) => {
            const width = parseInt(e.target.value);
            this.elements.selectedStrokeWidthValue.textContent = width + 'px';
            if (this.editor.selectedTextBox) {
                this.editor.updateTextBox(this.editor.selectedTextBox, { strokeWidth: width });
            }
        });

        this.elements.selectedFontFamily?.addEventListener('change', (e) => {
            if (this.editor.selectedTextBox) {
                this.editor.updateTextBox(this.editor.selectedTextBox, { fontFamily: e.target.value });
            }
        });

        this.elements.deleteTextBtn?.addEventListener('click', () => {
            if (this.editor.selectedTextBox) {
                this.editor.removeTextBox(this.editor.selectedTextBox);
                this.updateTextControls(null);
            }
        });

        this.elements.addTextBtn?.addEventListener('click', () => {
            const textBox = this.editor.addTextBox();
            this.updateTextControls(textBox);
            this.showToast('Text box added!', 'success');
        });

        document.getElementById('play-pause-btn')?.addEventListener('click', () => {
            if (this.editor.isAnimated) {
                this.editor.toggleAnimation();
                this.updatePlayPauseButton();
            }
        });

        window.addEventListener('gifPlayStateChange', () => {
            this.updatePlayPauseButton();
        });

        this.elements.downloadBtn?.addEventListener('click', (e) => {
            if (!this.editor.imageLoaded) {
                this.showToast('Please select a template first', 'error');
                return;
            }
            const filename = this.currentTemplate?.name?.replace(/\s+/g, '_') || 'meme';
            this.editor.exportAsPNG(filename + '.png');
            this.showToast('Meme downloaded as PNG!', 'success');
        });

        document.getElementById('download-png-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!this.editor.imageLoaded) {
                this.showToast('Please select a template first', 'error');
                return;
            }
            const filename = this.currentTemplate?.name?.replace(/\s+/g, '_') || 'meme';
            this.editor.exportAsPNG(filename + '.png');
            this.showToast('Meme downloaded as PNG!', 'success');
        });

        document.getElementById('download-gif-btn')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!this.editor.imageLoaded) {
                this.showToast('Please select a template first', 'error');
                return;
            }
            const filename = this.currentTemplate?.name?.replace(/\s+/g, '_') || 'meme';

            if (this.editor.isAnimated && this.editor.gifFrames.length > 0) {
                this.showToast('Creating animated GIF... Please wait.', 'success');
                try {
                    await this.editor.exportAsAnimatedGIF(filename + '.gif', (progress) => {
                    });
                    this.showToast('Animated GIF downloaded!', 'success');
                } catch (err) {
                    this.showToast('Failed to create animated GIF', 'error');
                }
            } else {
                this.editor.exportAsGIF(filename + '.gif');
                this.showToast('Meme downloaded as GIF!', 'success');
            }
        });

        this.elements.generateBtn?.addEventListener('click', () => {
            if (!this.editor.imageLoaded) {
                this.showToast('Please select a template first', 'error');
                return;
            }
            this.editor.render();
            const filename = this.currentTemplate?.name?.replace(/\s+/g, '_') || 'meme';
            this.editor.exportAsPNG(filename + '.png');
            this.showToast('Meme generated and downloaded!', 'success');
        });

        this.elements.resetBtn?.addEventListener('click', () => {
            if (this.currentTemplate) {
                this.loadTemplate(this.currentTemplate);
                this.updateTextControls(null);
                this.showToast('Editor reset!', 'success');
            }
        });

        this.elements.uploadArea?.addEventListener('click', () => {
            this.elements.uploadInput?.click();
        });

        this.elements.uploadArea?.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.elements.uploadArea.style.borderColor = 'var(--accent-primary)';
        });

        this.elements.uploadArea?.addEventListener('dragleave', () => {
            this.elements.uploadArea.style.borderColor = '';
        });

        this.elements.uploadArea?.addEventListener('drop', (e) => {
            e.preventDefault();
            this.elements.uploadArea.style.borderColor = '';
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                this.loadCustomImage(file);
            }
        });

        this.elements.uploadInput?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.loadCustomImage(file);
            }
        });

        window.addEventListener('resize', () => {
            if (this.editor.imageLoaded) {
                this.editor.resizeCanvas();
                this.editor.render();
                this.editor.renderTextBoxOverlay();
            }
        });
    }

    renderTemplateGrid(templates) {
        if (!this.elements.templateGrid) return;

        const displayCount = typeof getDisplayCount === 'function' ? getDisplayCount() : 20;
        const displayedTemplates = templates.slice(0, displayCount);
        const hasMore = templates.length > displayCount;

        this.elements.templateGrid.innerHTML = displayedTemplates.map(template => `
            <div class="template-item ${this.currentTemplate?.id === template.id ? 'selected' : ''}" 
                 data-id="${template.id}" 
                 title="${template.name}">
                <img src="${template.url}" alt="${template.name}" loading="lazy">
            </div>
        `).join('');

        if (this.elements.loadMoreBtn) {
            this.elements.loadMoreBtn.style.display = hasMore ? 'block' : 'none';
            this.elements.loadMoreBtn.textContent = `Load More (${displayedTemplates.length}/${templates.length})`;
        }

        this.elements.templateGrid.querySelectorAll('.template-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = parseInt(item.dataset.id);
                const template = getTemplateById(id);
                if (template) {
                    this.loadTemplate(template);
                }
            });
        });
    }

    loadTemplate(template) {
        this.currentTemplate = template;
        this.elements.canvasContainer?.classList.add('has-image');

        const isGif = GifHandler.isGifUrl(template.url) || template.isAnimated;

        if (isGif) {
            this.editor.loadGifTemplate(template.url, () => {
                this.onTemplateLoaded(template);
                this.updatePlayPauseButton();
            });
        } else {
            this.editor.loadTemplate(template.url, () => {
                this.onTemplateLoaded(template);
            });
        }
    }

    onTemplateLoaded(template) {
        const currentCat = typeof getCurrentCategory === 'function' ? getCurrentCategory() : 'popular';
        const templates = typeof getTemplatesByCategory === 'function'
            ? getTemplatesByCategory(currentCat)
            : this.templates;
        this.renderTemplateGrid(templates);
        this.updateTextControls(null);
        this.showToast(`Loaded: ${template.name}${this.editor.isAnimated ? ' (GIF)' : ''}`, 'success');
    }

    updatePlayPauseButton() {
        const btn = document.getElementById('play-pause-btn');
        if (btn) {
            btn.style.display = this.editor.isAnimated ? 'inline-flex' : 'none';
            btn.innerHTML = this.editor.isPlaying
                ? '<span>⏸️</span> Pause'
                : '<span>▶️</span> Play';
        }
    }

    loadCustomImage(file) {
        this.currentTemplate = { name: file.name.replace(/\.[^/.]+$/, '') };
        this.elements.canvasContainer?.classList.add('has-image');

        const isGif = file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif');

        if (isGif) {
            const reader = new FileReader();
            reader.onload = (e) => {
                this.editor.loadGifTemplate(e.target.result, () => {
                    this.updateTextControls(null);
                    this.updatePlayPauseButton();
                    this.showToast('Animated GIF loaded! Use Play/Pause to control.', 'success');
                });
            };
            reader.readAsDataURL(file);
        } else {
            this.editor.loadCustomImage(file, () => {
                this.updateTextControls(null);
                this.showToast('Custom image loaded!', 'success');
            });
        }
    }

    updateTextControls(textBox) {
        if (textBox) {
            this.elements.noSelectionHint.style.display = 'none';
            this.elements.selectedTextControls.style.display = 'block';

            this.elements.selectedText.value = textBox.text || '';
            this.elements.selectedFillColor.value = textBox.fillColor || '#ffffff';
            this.elements.selectedStrokeColor.value = textBox.strokeColor || '#000000';
            this.elements.selectedFontSize.value = textBox.fontSize || 40;
            this.elements.selectedFontSizeValue.textContent = (textBox.fontSize || 40) + 'px';
            this.elements.selectedStrokeWidth.value = textBox.strokeWidth || 3;
            this.elements.selectedStrokeWidthValue.textContent = (textBox.strokeWidth || 3) + 'px';
            this.elements.selectedFontFamily.value = textBox.fontFamily || 'Impact';
        } else {
            this.elements.noSelectionHint.style.display = 'block';
            this.elements.selectedTextControls.style.display = 'none';
        }
    }

    showToast(message, type = 'success') {
        const container = document.querySelector('.toast-container') || this.createToastContainer();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <i>${type === 'success' ? '✓' : '✕'}</i>
            <span>${message}</span>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    createToastContainer() {
        const container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
        return container;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new MemeForgeApp();
});
