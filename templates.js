let memeTemplates = [];
let templatesLoaded = false;
let currentCategory = 'popular';
let displayCount = 20;

async function fetchTemplates() {
    try {
        const response = await fetch('https://api.imgflip.com/get_memes');
        const data = await response.json();

        if (data.success) {
            memeTemplates = data.data.memes.map((meme, index) => ({
                id: parseInt(meme.id),
                name: meme.name,
                url: meme.url,
                width: meme.width,
                height: meme.height,
                boxCount: meme.box_count,
                isPopular: index < 25,
                isClassic: index >= 25 && index < 60,
                isRecent: index >= 60,
                isGif: false
            }));

            const gifTemplates = [{
                id: 'gif-upload-hint',
                name: 'Upload your GIF',
                url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150" viewBox="0 0 200 150"><rect fill="#2a2a2a" width="200" height="150"/><text x="100" y="60" text-anchor="middle" fill="#888" font-size="12">External GIFs blocked</text><text x="100" y="80" text-anchor="middle" fill="#00d4ff" font-size="14">↑ Upload your GIF above</text><text x="100" y="100" text-anchor="middle" fill="#888" font-size="11">to edit animated memes</text></svg>'),
                isGif: true,
                isPlaceholder: true
            }];

            memeTemplates = [...memeTemplates, ...gifTemplates];
            templatesLoaded = true;
            console.log(`✓ Loaded ${memeTemplates.length} meme templates`);
            return memeTemplates;
        } else {
            throw new Error('API returned unsuccessful response');
        }
    } catch (error) {
        console.error('Failed to fetch templates from Imgflip API:', error);
        return [];
    }
}

function getTemplatesByCategory(category) {
    switch (category) {
        case 'popular': return memeTemplates.filter(t => t.isPopular);
        case 'classic': return memeTemplates.filter(t => t.isClassic);
        case 'recent': return memeTemplates.filter(t => t.isRecent);
        case 'gif': return memeTemplates.filter(t => t.isGif || t.isAnimated);
        default: return memeTemplates;
    }
}

function searchTemplates(query) {
    if (!query || query.trim() === '') return getTemplatesByCategory(currentCategory);
    const lowerQuery = query.toLowerCase();
    return memeTemplates.filter(t => t.name.toLowerCase().includes(lowerQuery));
}

function getTemplateById(id) { return memeTemplates.find(t => t.id === id); }
function setCategory(category) { currentCategory = category; displayCount = 20; }
function getCurrentCategory() { return currentCategory; }
function getDisplayCount() { return displayCount; }
function loadMore() { displayCount += 20; return displayCount; }
function areTemplatesLoaded() { return templatesLoaded; }

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { memeTemplates, fetchTemplates, searchTemplates, getTemplateById, areTemplatesLoaded, getTemplatesByCategory, setCategory, getCurrentCategory, getDisplayCount, loadMore };
}
