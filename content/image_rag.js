// Image-RAG: fetches visible pin images, sends to Claude vision for richer taste analysis,
// then attempts to find matching products via search URLs.
// Called from background/worker.js via PROCESS_PINS_VISUAL message.


(function () {
  'use strict';

  async function analyzeImagesRAG(pins, getIdeas) {
    const imagePins = pins.filter(p => p.imageUrl && !p.imageUrl.startsWith('data:')).slice(0, 8);
    if (imagePins.length === 0) return null;

    // Fetch images as base64
    const imageDataList = await Promise.all(
      imagePins.map(async (pin) => {
        try {
          const resp = await fetch(pin.imageUrl);
          if (!resp.ok) return null;
          const blob = await resp.blob();
          return await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve({
              pinId: pin.id,
              title: pin.title || pin.alt || '',
              base64: reader.result.split(',')[1],
              mediaType: blob.type || 'image/jpeg'
            });
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        } catch { return null; }
      })
    );

    const valid = imageDataList.filter(Boolean);
    if (valid.length === 0) return null;

    // Build multimodal Claude message
    const contentParts = [];
    for (const img of valid) {
      contentParts.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.base64 }
      });
      if (img.title) {
        contentParts.push({ type: 'text', text: `(Pin title: "${img.title}")` });
      }
    }
    contentParts.push({
      type: 'text',
      text: `
        Analyze these Pinterest pin images carefully. Extract rich visual taste signals:
        - Visual aesthetics (color palettes, textures, moods, design styles)
        - Product categories you can see (e.g. "ceramic vases", "linen throw", "vintage camera")
        - Lifestyle signals (e.g. "minimalist home", "outdoor adventure", "cozy reading nook")
        - Specific product ideas that would appeal to someone who saves these images

        Respond ONLY with valid JSON (no markdown):
        {
          "visualAesthetics": ["..."],
          "productCategories": ["..."],
          "lifestyleSignals": ["..."],
          "specificProductIdeas": [
            { "name": "...", "description": "...", "searchQuery": "...", "priceRange": "..." }
          ],
          "dominantColors": ["..."],
          "moodKeywords": ["..."]
        }
    `});

    try {
      const result = await getIdeas(
        [{ role: 'user', content: contentParts }],
        'You are a visual taste analyst helping curate personalized gift ideas from Pinterest imagery. Always respond with only valid JSON.',
        2500
      );
      const match = result.match(/\{[\s\S]*\}/);
      if (!match) return null;
      const parsed = JSON.parse(match[0]);

      // Enrich product ideas with shopping URLs
      if (parsed.specificProductIdeas) {
        parsed.specificProductIdeas = parsed.specificProductIdeas.map(idea => ({
          ...idea,
          amazonUrl: `https://www.amazon.com/s?k=${encodeURIComponent(idea.searchQuery || idea.name)}`,
          etsyUrl: `https://www.etsy.com/search?q=${encodeURIComponent(idea.searchQuery || idea.name)}`,
          googleUrl: `https://www.google.com/search?q=${encodeURIComponent(idea.name + ' buy online')}&tbm=shop`,
          source: 'image-rag'
        }));
      }

      return parsed;
    } catch (e) {
      console.error('[PinSieve] image-rag error:', e);
      return null;
    }
  }

  // Export for use in worker context via importScripts or module
  if (typeof module !== 'undefined') {
    module.exports = { analyzeImagesRAG };
  } else {
    self.analyzeImagesRAG = analyzeImagesRAG;
  }
})();
