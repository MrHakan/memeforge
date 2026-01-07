class MemeEditor {
    constructor(canvasId, overlayId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.overlay = document.getElementById(overlayId);

        this.image = null;
        this.imageLoaded = false;
        this.textBoxes = [];
        this.selectedTextBox = null;
        this.isDragging = false;
        this.isResizing = false;
        this.resizeHandle = null;
        this.dragOffset = { x: 0, y: 0 };

        this.scaleX = 1;
        this.scaleY = 1;
        this.displayWidth = 0;
        this.displayHeight = 0;

        this.isAnimated = false;
        this.gifHandler = null;
        this.gifFrames = [];
        this.gifDelays = [];
        this.currentFrameIndex = 0;
        this.animationTimer = null;
        this.isPlaying = false;

        this.defaultTextSettings = {
            fontFamily: 'Impact',
            fontSize: 40,
            fillColor: '#ffffff',
            strokeColor: '#000000',
            strokeWidth: 3,
            textAlign: 'center',
            allCaps: true
        };

        this.initEventListeners();
    }

    initEventListeners() {
        this.overlay.addEventListener('mousedown', this.handleMouseDown.bind(this));
        document.addEventListener('mousemove', this.handleMouseMove.bind(this));
        document.addEventListener('mouseup', this.handleMouseUp.bind(this));

        this.overlay.addEventListener('touchstart', this.handleTouchStart.bind(this));
        document.addEventListener('touchmove', this.handleTouchMove.bind(this));
        document.addEventListener('touchend', this.handleTouchEnd.bind(this));

        document.addEventListener('click', (e) => {
            const isInOverlay = this.overlay.contains(e.target);
            const isInControls = e.target.closest('.controls-panel') || e.target.closest('.text-input-group') || e.target.closest('.style-option');
            if (!isInOverlay && !isInControls) {
                this.deselectAll();
            }
        });
    }

    loadTemplate(url, callback) {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            this.image = img;
            this.imageLoaded = true;
            this.resizeCanvas();
            this.render();

            this.textBoxes = [
                this.createTextBox('', 0.5, 0.08, 0.9, 0.15),
                this.createTextBox('', 0.5, 0.92, 0.9, 0.15)
            ];
            this.renderTextBoxOverlay();

            if (callback) callback();
        };

        img.onerror = () => {
            if (!url.includes('corsproxy')) {
                const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(url);
                this.loadTemplate(proxyUrl, callback);
                return;
            }
            console.error('Failed to load template:', url);
            this.showPlaceholder('Failed to load image');
        };

        img.src = url;
    }

    loadCustomImage(file, callback) {
        const reader = new FileReader();
        reader.onload = (e) => {
            this.loadTemplate(e.target.result, callback);
        };
        reader.readAsDataURL(file);
    }

    async loadGifTemplate(url, callback) {
        try {
            this.stopAnimation();

            this.gifHandler = new GifHandler();

            let gifUrl = url;
            if (!url.startsWith('data:') && !url.includes('localhost')) {
                gifUrl = 'https://corsproxy.io/?' + encodeURIComponent(url);
            }

            const gifData = await this.gifHandler.parseGif(gifUrl);

            this.gifFrames = gifData.frames;
            this.gifDelays = gifData.delays;
            this.isAnimated = true;
            this.currentFrameIndex = 0;

            this.canvas.width = gifData.width;
            this.canvas.height = gifData.height;

            const container = this.canvas.parentElement.parentElement;
            const maxWidth = container.clientWidth - 40;
            const maxHeight = 600;

            let width = gifData.width;
            let height = gifData.height;
            const imgRatio = width / height;

            if (width > maxWidth) {
                width = maxWidth;
                height = width / imgRatio;
            }
            if (height > maxHeight) {
                height = maxHeight;
                width = height * imgRatio;
            }

            this.displayWidth = width;
            this.displayHeight = height;
            this.scaleX = gifData.width / width;
            this.scaleY = gifData.height / height;

            this.canvas.style.width = width + 'px';
            this.canvas.style.height = height + 'px';
            this.overlay.style.width = width + 'px';
            this.overlay.style.height = height + 'px';

            this.textBoxes = [
                this.createTextBox('', 0.5, 0.08, 0.9, 0.15),
                this.createTextBox('', 0.5, 0.92, 0.9, 0.15)
            ];

            this.imageLoaded = true;

            this.renderGifFrame(0);
            this.renderTextBoxOverlay();

            this.playAnimation();

            if (callback) callback();

        } catch (error) {
            console.error('Failed to load GIF template:', error);
            this.loadTemplate(url, callback);
        }
    }

    renderGifFrame(frameIndex) {
        if (!this.isAnimated || !this.gifFrames.length) return;

        const frame = this.gifFrames[frameIndex];
        if (!frame) return;

        this.ctx.putImageData(frame, 0, 0);

        this.textBoxes.forEach(textBox => {
            this.renderText(textBox);
        });
    }

    playAnimation() {
        if (!this.isAnimated || this.isPlaying) return;

        this.isPlaying = true;
        this.animateNextFrame();

        window.dispatchEvent(new CustomEvent('gifPlayStateChange', { detail: { isPlaying: true } }));
    }

    animateNextFrame() {
        if (!this.isPlaying || !this.isAnimated) return;

        this.renderGifFrame(this.currentFrameIndex);

        const delay = this.gifDelays[this.currentFrameIndex] || 100;

        this.animationTimer = setTimeout(() => {
            this.currentFrameIndex = (this.currentFrameIndex + 1) % this.gifFrames.length;
            this.animateNextFrame();
        }, delay);
    }

    pauseAnimation() {
        if (!this.isAnimated) return;

        this.isPlaying = false;
        if (this.animationTimer) {
            clearTimeout(this.animationTimer);
            this.animationTimer = null;
        }

        window.dispatchEvent(new CustomEvent('gifPlayStateChange', { detail: { isPlaying: false } }));
    }

    stopAnimation() {
        this.pauseAnimation();
        this.currentFrameIndex = 0;
        this.gifFrames = [];
        this.gifDelays = [];
        this.isAnimated = false;
    }

    toggleAnimation() {
        if (this.isPlaying) {
            this.pauseAnimation();
        } else {
            this.playAnimation();
        }
    }

    async exportAsAnimatedGIF(filename = 'meme.gif', onProgress = null) {
        if (!this.isAnimated || !this.gifFrames.length) {
            this.exportAsPNG(filename.replace('.gif', '.png'));
            return;
        }

        const wasPlaying = this.isPlaying;
        this.pauseAnimation();

        try {
            const canvasFrames = [];

            for (let i = 0; i < this.gifFrames.length; i++) {
                const frameCanvas = document.createElement('canvas');
                frameCanvas.width = this.canvas.width;
                frameCanvas.height = this.canvas.height;
                const frameCtx = frameCanvas.getContext('2d');

                frameCtx.putImageData(this.gifFrames[i], 0, 0);

                this.textBoxes.forEach(textBox => {
                    this.renderTextToContext(frameCtx, textBox);
                });

                canvasFrames.push(frameCanvas);
            }

            const blob = await this.gifHandler.encodeGif(canvasFrames, this.gifDelays, onProgress);

            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 100);

        } catch (error) {
            console.error('Failed to export animated GIF:', error);
            throw error;
        } finally {
            if (wasPlaying) {
                this.playAnimation();
            }
        }
    }

    renderTextToContext(ctx, textBox) {
        if (!textBox.text.trim()) return;

        const centerX = textBox.x * this.canvas.width;
        const centerY = textBox.y * this.canvas.height;

        const fontSize = textBox.fontSize * (this.canvas.width / 500);

        ctx.save();

        ctx.font = `bold ${fontSize}px ${textBox.fontFamily}`;
        ctx.textAlign = textBox.textAlign;
        ctx.textBaseline = 'middle';

        const text = textBox.allCaps ? textBox.text.toUpperCase() : textBox.text;

        const maxWidth = textBox.width * this.canvas.width * 0.95;
        const lines = this.wrapText(text, maxWidth, ctx);
        const lineHeight = fontSize * 1.1;
        const totalHeight = lines.length * lineHeight;
        const startY = centerY - totalHeight / 2 + lineHeight / 2;

        lines.forEach((line, i) => {
            const y = startY + i * lineHeight;

            if (textBox.strokeWidth > 0) {
                ctx.strokeStyle = textBox.strokeColor;
                ctx.lineWidth = textBox.strokeWidth * (this.canvas.width / 500);
                ctx.lineJoin = 'round';
                ctx.miterLimit = 2;
                ctx.strokeText(line, centerX, y);
            }

            ctx.fillStyle = textBox.fillColor;
            ctx.fillText(line, centerX, y);
        });

        ctx.restore();
    }

    resizeCanvas() {
        if (!this.image) return;

        const wrapper = this.canvas.parentElement;
        const container = wrapper.parentElement;
        const maxWidth = container.clientWidth - 40;
        const maxHeight = 600;

        const imgRatio = this.image.width / this.image.height;
        let width = this.image.width;
        let height = this.image.height;

        if (width > maxWidth) {
            width = maxWidth;
            height = width / imgRatio;
        }

        if (height > maxHeight) {
            height = maxHeight;
            width = height * imgRatio;
        }

        this.displayWidth = width;
        this.displayHeight = height;
        this.scaleX = this.image.width / width;
        this.scaleY = this.image.height / height;

        this.canvas.width = this.image.width;
        this.canvas.height = this.image.height;
        this.canvas.style.width = width + 'px';
        this.canvas.style.height = height + 'px';

        this.overlay.style.width = width + 'px';
        this.overlay.style.height = height + 'px';
    }

    createTextBox(text, centerX, centerY, widthPercent, heightPercent) {
        return {
            id: Date.now() + Math.random(),
            text: text,
            x: centerX,
            y: centerY,
            width: widthPercent,
            height: heightPercent,
            ...JSON.parse(JSON.stringify(this.defaultTextSettings))
        };
    }

    addTextBox() {
        const textBox = this.createTextBox('New Text', 0.5, 0.5, 0.8, 0.12);
        this.textBoxes.push(textBox);
        this.selectTextBox(textBox);
        this.renderTextBoxOverlay();
        this.render();
        return textBox;
    }

    removeTextBox(textBox) {
        const index = this.textBoxes.indexOf(textBox);
        if (index > -1) {
            this.textBoxes.splice(index, 1);
            if (this.selectedTextBox === textBox) {
                this.selectedTextBox = null;
            }
            this.renderTextBoxOverlay();
            this.render();
        }
    }

    selectTextBox(textBox) {
        this.selectedTextBox = textBox;
        this.renderTextBoxOverlay();
        if (window.app) {
            window.app.updateTextControls(textBox);
        }
    }

    deselectAll() {
        this.selectedTextBox = null;
        this.renderTextBoxOverlay();
        if (window.app) {
            window.app.updateTextControls(null);
        }
    }

    updateTextBox(textBox, properties) {
        Object.assign(textBox, properties);
        this.render();
        this.renderTextBoxOverlay();
    }

    render() {
        if (!this.imageLoaded) return;

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(this.image, 0, 0, this.canvas.width, this.canvas.height);

        this.textBoxes.forEach(textBox => {
            this.renderText(textBox);
        });
    }

    renderText(textBox) {
        if (!textBox.text.trim()) return;

        const ctx = this.ctx;
        const centerX = textBox.x * this.canvas.width;
        const centerY = textBox.y * this.canvas.height;

        const fontSize = textBox.fontSize * (this.canvas.width / 500);

        ctx.save();

        ctx.font = `bold ${fontSize}px ${textBox.fontFamily}`;
        ctx.textAlign = textBox.textAlign;
        ctx.textBaseline = 'middle';

        const text = textBox.allCaps ? textBox.text.toUpperCase() : textBox.text;

        const maxWidth = textBox.width * this.canvas.width * 0.95;
        const lines = this.wrapText(text, maxWidth, ctx);
        const lineHeight = fontSize * 1.1;
        const totalHeight = lines.length * lineHeight;
        const startY = centerY - totalHeight / 2 + lineHeight / 2;

        lines.forEach((line, i) => {
            const y = startY + i * lineHeight;

            if (textBox.strokeWidth > 0) {
                ctx.strokeStyle = textBox.strokeColor;
                ctx.lineWidth = textBox.strokeWidth * (this.canvas.width / 500);
                ctx.lineJoin = 'round';
                ctx.miterLimit = 2;
                ctx.strokeText(line, centerX, y);
            }

            ctx.fillStyle = textBox.fillColor;
            ctx.fillText(line, centerX, y);
        });

        ctx.restore();
    }

    wrapText(text, maxWidth, ctx) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';

        words.forEach(word => {
            const testLine = currentLine ? currentLine + ' ' + word : word;
            const metrics = ctx.measureText(testLine);

            if (metrics.width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        });

        if (currentLine) {
            lines.push(currentLine);
        }

        return lines.length ? lines : [''];
    }

    renderTextBoxOverlay() {
        this.overlay.innerHTML = '';

        this.textBoxes.forEach(textBox => {
            const box = document.createElement('div');
            box.className = 'text-box' + (textBox === this.selectedTextBox ? ' selected' : '');
            box.dataset.id = textBox.id;

            const left = (textBox.x - textBox.width / 2) * 100;
            const top = (textBox.y - textBox.height / 2) * 100;
            const width = textBox.width * 100;
            const height = textBox.height * 100;

            box.style.left = left + '%';
            box.style.top = top + '%';
            box.style.width = width + '%';
            box.style.height = height + '%';

            if (textBox === this.selectedTextBox) {
                ['top-left', 'top-right', 'bottom-left', 'bottom-right'].forEach(pos => {
                    const handle = document.createElement('div');
                    handle.className = 'resize-handle ' + pos;
                    handle.dataset.handle = pos;
                    box.appendChild(handle);
                });
            }

            if (!textBox.text) {
                const preview = document.createElement('span');
                preview.style.cssText = `
                    font-family: ${textBox.fontFamily};
                    color: rgba(255,255,255,0.5);
                    font-size: 14px;
                    pointer-events: none;
                `;
                preview.textContent = 'Click to edit';
                box.appendChild(preview);
            }

            this.overlay.appendChild(box);
        });
    }

    handleMouseDown(e) {
        const rect = this.overlay.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        if (e.target.classList.contains('resize-handle')) {
            this.isResizing = true;
            this.resizeHandle = e.target.dataset.handle;
            if (this.selectedTextBox) {
                this.resizeStart = {
                    x: x,
                    y: y,
                    width: this.selectedTextBox.width,
                    height: this.selectedTextBox.height,
                    boxX: this.selectedTextBox.x,
                    boxY: this.selectedTextBox.y
                };
            }
            e.preventDefault();
            return;
        }

        const textBoxId = e.target.closest('.text-box')?.dataset.id;
        if (textBoxId) {
            const textBox = this.textBoxes.find(tb => tb.id == textBoxId);
            if (textBox) {
                this.selectTextBox(textBox);
                this.isDragging = true;
                this.dragOffset = {
                    x: x - textBox.x,
                    y: y - textBox.y
                };
                e.preventDefault();
            }
        }
    }

    handleMouseMove(e) {
        if (!this.isDragging && !this.isResizing) return;

        const rect = this.overlay.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

        if (this.isDragging && this.selectedTextBox) {
            this.selectedTextBox.x = x - this.dragOffset.x;
            this.selectedTextBox.y = y - this.dragOffset.y;

            const halfW = this.selectedTextBox.width / 2;
            const halfH = this.selectedTextBox.height / 2;
            this.selectedTextBox.x = Math.max(halfW, Math.min(1 - halfW, this.selectedTextBox.x));
            this.selectedTextBox.y = Math.max(halfH, Math.min(1 - halfH, this.selectedTextBox.y));

            this.render();
            this.renderTextBoxOverlay();
        }

        if (this.isResizing && this.selectedTextBox && this.resizeStart) {
            const tb = this.selectedTextBox;
            const start = this.resizeStart;
            const minSize = 0.05;
            const maxSize = 1.0;

            const deltaX = x - start.x;
            const deltaY = y - start.y;

            switch (this.resizeHandle) {
                case 'bottom-right':
                    tb.width = Math.min(maxSize, Math.max(minSize, start.width + deltaX * 2));
                    tb.height = Math.min(maxSize, Math.max(minSize, start.height + deltaY * 2));
                    break;
                case 'bottom-left':
                    tb.width = Math.min(maxSize, Math.max(minSize, start.width - deltaX * 2));
                    tb.height = Math.min(maxSize, Math.max(minSize, start.height + deltaY * 2));
                    break;
                case 'top-right':
                    tb.width = Math.min(maxSize, Math.max(minSize, start.width + deltaX * 2));
                    tb.height = Math.min(maxSize, Math.max(minSize, start.height - deltaY * 2));
                    break;
                case 'top-left':
                    tb.width = Math.min(maxSize, Math.max(minSize, start.width - deltaX * 2));
                    tb.height = Math.min(maxSize, Math.max(minSize, start.height - deltaY * 2));
                    break;
            }

            this.render();
            this.renderTextBoxOverlay();
        }
    }

    handleMouseUp() {
        this.isDragging = false;
        this.isResizing = false;
        this.resizeHandle = null;
        this.resizeStart = null;
    }

    handleTouchStart(e) {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            this.handleMouseDown({
                clientX: touch.clientX,
                clientY: touch.clientY,
                target: e.target,
                preventDefault: () => e.preventDefault()
            });
        }
    }

    handleTouchMove(e) {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            this.handleMouseMove({
                clientX: touch.clientX,
                clientY: touch.clientY
            });
        }
    }

    handleTouchEnd() {
        this.handleMouseUp();
    }

    exportAsPNG(filename = 'meme.png') {
        this.render();

        this.canvas.toBlob((blob) => {
            if (blob) {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                setTimeout(() => URL.revokeObjectURL(url), 100);
            }
        }, 'image/png');
    }

    getDataURL() {
        this.render();
        return this.canvas.toDataURL('image/png');
    }

    exportAsGIF(filename = 'meme.gif') {
        this.render();

        this.canvas.toBlob((blob) => {
            if (blob) {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                setTimeout(() => URL.revokeObjectURL(url), 100);
            }
        }, 'image/png');
    }

    reset() {
        this.image = null;
        this.imageLoaded = false;
        this.textBoxes = [];
        this.selectedTextBox = null;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.overlay.innerHTML = '';
        this.canvas.style.width = '';
        this.canvas.style.height = '';
    }

    showPlaceholder(message) {
        this.overlay.innerHTML = `
            <div class="canvas-placeholder">
                <i>🖼️</i>
                <p>${message}</p>
            </div>
        `;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MemeEditor;
}
