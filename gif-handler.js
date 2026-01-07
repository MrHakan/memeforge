class GifHandler {
    constructor() {
        this.frames = [];
        this.delays = [];
        this.width = 0;
        this.height = 0;
        this.isLoaded = false;
    }

    async parseGif(url) {
        const corsProxies = [
            '',
            'https://api.allorigins.win/raw?url=',
            'https://corsproxy.io/?'
        ];

        let lastError = null;

        for (const proxy of corsProxies) {
            try {
                const fetchUrl = proxy ? proxy + encodeURIComponent(url) : url;
                console.log(`Trying to fetch GIF via: ${proxy || 'direct'}`);

                const response = await fetch(fetchUrl);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const arrayBuffer = await response.arrayBuffer();
                return await this.processGifBuffer(arrayBuffer);
            } catch (error) {
                lastError = error;
                console.log(`Proxy ${proxy || 'direct'} failed:`, error.message);
                continue;
            }
        }

        throw lastError || new Error('All proxies failed');
    }

    async processGifBuffer(arrayBuffer) {
        const gif = parseGIF(arrayBuffer);
        const frames = decompressFrames(gif, true);

        if (frames.length === 0) {
            throw new Error('No frames found in GIF');
        }

        this.width = frames[0].dims.width;
        this.height = frames[0].dims.height;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.width;
        tempCanvas.height = this.height;
        const tempCtx = tempCanvas.getContext('2d');

        this.frames = [];
        this.delays = [];

        let previousImageData = null;

        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            const dims = frame.dims;

            if (i > 0) {
                const prevFrame = frames[i - 1];
                if (prevFrame.disposalType === 2) {
                    tempCtx.clearRect(0, 0, this.width, this.height);
                } else if (prevFrame.disposalType === 3 && previousImageData) {
                    tempCtx.putImageData(previousImageData, 0, 0);
                }
            }

            if (frame.disposalType === 3) {
                previousImageData = tempCtx.getImageData(0, 0, this.width, this.height);
            }

            const patchData = new ImageData(
                new Uint8ClampedArray(frame.patch),
                dims.width,
                dims.height
            );

            const patchCanvas = document.createElement('canvas');
            patchCanvas.width = dims.width;
            patchCanvas.height = dims.height;
            const patchCtx = patchCanvas.getContext('2d');
            patchCtx.putImageData(patchData, 0, 0);

            tempCtx.drawImage(patchCanvas, dims.left, dims.top);

            const fullFrameData = tempCtx.getImageData(0, 0, this.width, this.height);
            this.frames.push(fullFrameData);

            this.delays.push(frame.delay || 100);
        }

        this.isLoaded = true;

        console.log(`✓ Parsed GIF: ${this.frames.length} frames, ${this.width}x${this.height}`);

        return {
            frames: this.frames,
            delays: this.delays,
            width: this.width,
            height: this.height
        };
    }

    encodeGif(canvasFrames, delays, onProgress = null) {
        return new Promise((resolve, reject) => {
            if (!window.GIF) {
                reject(new Error('gif.js library not loaded'));
                return;
            }

            const gif = new GIF({
                workers: 2,
                quality: 10,
                width: canvasFrames[0].width,
                height: canvasFrames[0].height,
                workerScript: 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js'
            });

            canvasFrames.forEach((canvas, i) => {
                gif.addFrame(canvas, { delay: delays[i] || 100 });
            });

            gif.on('progress', (p) => {
                if (onProgress) onProgress(p);
            });

            gif.on('finished', (blob) => {
                resolve(blob);
            });

            gif.render();
        });
    }

    static isGifUrl(url) {
        return url && url.toLowerCase().includes('.gif');
    }

    get frameCount() {
        return this.frames.length;
    }

    get totalDuration() {
        return this.delays.reduce((sum, d) => sum + d, 0);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GifHandler;
}
