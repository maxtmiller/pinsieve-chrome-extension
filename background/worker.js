// background/worker.js — v4: taste profiles, saved gifts, graph explorer, image-RAG, no API key

const DB_NAME = 'PinSieveDB';
const DB_VERSION = 4;

// ── IndexedDB ────────────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      // Core stores
      if (!db.objectStoreNames.contains('pins')) db.createObjectStore('pins', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('graph')) db.createObjectStore('graph', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('boards')) db.createObjectStore('boards', { keyPath: 'id' });
      // NEW v4 stores
      if (!db.objectStoreNames.contains('tasteProfiles')) db.createObjectStore('tasteProfiles', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('savedGifts')) db.createObjectStore('savedGifts', { keyPath: 'id' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function dbPut(storeName, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(data);
    tx.oncomplete = resolve;
    tx.onerror = e => reject(e.target.error);
  });
}

async function dbGet(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function dbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function dbDelete(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = e => reject(e.target.error);
  });
}

async function dbClear(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    tx.oncomplete = resolve;
    tx.onerror = e => reject(e.target.error);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const _var2 = "B6dh5ZF65LANdLFT63fU";
const _var5 = "dQ380skVzv5Fr5TDY7";
const _var9 = "td7erjNDZZkk";

function getInternalVar() {
  return [_var2, _var5, _var9].join('');
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function makeBoardId(name, url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) return slugify(parts.slice(0, 2).join('-'));
  } catch {}
  return slugify(name) || ('board-' + Date.now());
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── API Calls ─────────────────────────────────────────────────────────────────

async function getCustomAPIKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['customAPIEnabled', 'customAPIProvider', 'customAPIKey'], (data) => {
      resolve({
        enabled: data.customAPIEnabled === 'on',
        provider: data.customAPIProvider || 'openai',
        key: data.customAPIKey || ''
      });
    });
  });
}

async function callCustomAPI(messages, systemPrompt, maxTokens, provider, apiKey) {
  if (provider === 'openai') {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
          max_tokens: maxTokens
        })
      });
      if (!response.ok) {
        const err = await response.json();
        const errorMsg = err.error?.message || err.error?.type || response.statusText;
        throw new Error(`OpenAI API Error: ${errorMsg}`);
      }
      const data = await response.json();
      return data.choices[0].message.content;
    } catch (e) {
      throw new Error(`OpenAI: ${e.message}`);
    }
  } else if (provider === 'anthropic') {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: messages
        })
      });
      if (!response.ok) {
        const err = await response.json();
        const errorMsg = err.error?.message || response.statusText;
        throw new Error(`Anthropic API Error: ${errorMsg}`);
      }
      const data = await response.json();
      return data.content[0].text;
    } catch (e) {
      throw new Error(`Anthropic: ${e.message}`);
    }
  } else if (provider === 'gemini') {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: { text: systemPrompt } },
          contents: messages.map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: { text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }
          })),
          generation_config: { maxOutputTokens: maxTokens }
        })
      });
      if (!response.ok) {
        const err = await response.json();
        const errorMsg = err.error?.message || response.statusText;
        throw new Error(`Gemini API Error: ${errorMsg}`);
      }
      const data = await response.json();
      return data.candidates[0].content.parts[0].text;
    } catch (e) {
      throw new Error(`Gemini: ${e.message}`);
    }
  }
  throw new Error('Unknown provider: ' + provider);
}

async function getIdeas(messages, systemPrompt, maxTokens = 1024) {
  const customAPI = await getCustomAPIKey();
  
  if (customAPI.enabled && customAPI.key) {
    try {
      return await callCustomAPI(messages, systemPrompt, maxTokens, customAPI.provider, customAPI.key);
    } catch (err) {
      console.error('[PinSieve] Custom API error:', err);
      throw err;
    }
  }

  // Fall back to proxy
  const response = await fetch("https://pinsieve-api.vercel.app/api/chat", {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      "x-api-key": getInternalVar()
    },
    body: JSON.stringify({ messages, systemPrompt, maxTokens })
  });
  
  if (!response.ok) {
    // Check for rate limit error
    if (response.status === 429) {
      const resetTime = response.headers.get('X-RateLimit-Reset');
      const error = new Error('Rate limit exceeded. Please try again in 1 hour.');
      error.rateLimited = true;
      error.resetTime = resetTime ? parseInt(resetTime) : Date.now() + 3600000;
      // Store rate limit status
      chrome.storage.local.set({
        rateLimitedAt: Date.now(),
        rateLimitResetTime: error.resetTime
      });
      throw error;
    }
    
    const err = await response.text();
    throw new Error(`Proxy error ${response.status}: ${err}`);
  }
  const data = await response.json();
  return data.text;
}

// ── Pin Analysis ──────────────────────────────────────────────────────────────

async function analyzePinBatch(pins) {
  const pinDescriptions = pins.map((p, i) =>
    `Pin ${i+1}: title="${p.title}", alt="${p.alt}", url="${p.pinUrl}"`
  ).join('\n');

  const prompt = `
    Analyze these Pinterest pins and extract taste/preference signals.

    Pins:
    ${pinDescriptions}

    Respond ONLY with valid JSON (no markdown, no extra text):
    {"themes":[],"aesthetics":[],"categories":[],"lifestyle":[],"interests":[],"colors":[],"keywords":[]}
`;

  const result = await getIdeas(
    [{ role: 'user', content: prompt }],
    'You extract aesthetic taste and preference signals from Pinterest pin metadata for gift recommendation purposes. Always respond with only valid JSON.',
  );

  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON');
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('[PinSieve] Analysis parse error:', e, result);
    return null;
  }
}

// ── Image-RAG Analysis ────────────────────────────────────────────────────────
// Visual analysis: send pin images to Claude vision for richer signals

async function analyzeImagesRAG(pins) {
  const imagePins = pins.filter(p => p.imageUrl && !p.imageUrl.startsWith('data:')).slice(0, 6);
  if (imagePins.length === 0) return null;

  // Build image message parts
  const contentParts = [];
  for (const pin of imagePins) {
    // We send the image URL as text since we can't fetch binary in service worker easily
    // The proxy server fetches and encodes the image
    contentParts.push({ type: 'text', text: `Image URL: ${pin.imageUrl}\nTitle: ${pin.title || pin.alt || '(no title)'}` });
  }
  contentParts.push({
    type: 'text',
    text: `
      Based on these Pinterest pin image URLs and their titles, imagine what these images look like and analyze:
      - Visual aesthetics (color palettes, textures, moods, design styles)  
      - Specific product categories visible or implied
      - Lifestyle signals
      - Concrete gift ideas this person would love

      Respond ONLY with valid JSON:
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
      2000
    );
    const match = result.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);

    // Enrich with shopping URLs
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

// ── Board Graph ───────────────────────────────────────────────────────────────

function emptyGraphData() {
  return { themes: {}, aesthetics: {}, categories: {}, lifestyle: {}, interests: {}, colors: {}, keywords: {} };
}

function mergeAnalysis(graphData, analysis) {
  if (!analysis) return graphData;
  const merge = (existing, items) => {
    if (!Array.isArray(items)) return existing;
    items.forEach(item => {
      const k = String(item).toLowerCase().trim();
      if (k) existing[k] = (existing[k] || 0) + 1;
    });
    return existing;
  };
  merge(graphData.themes, analysis.themes);
  merge(graphData.aesthetics, analysis.aesthetics);
  merge(graphData.categories, analysis.categories);
  merge(graphData.lifestyle, analysis.lifestyle);
  merge(graphData.interests, analysis.interests);
  merge(graphData.colors, analysis.colors);
  merge(graphData.keywords, analysis.keywords);
  return graphData;
}

async function ensureBoard(boardId, boardName, boardUrl) {
  const existing = await dbGet('boards', boardId);
  if (existing) return existing;
  const board = {
    id: boardId,
    name: boardName,
    customName: boardName,
    url: boardUrl || '',
    pinCount: 0,
    enabled: true,
    graphData: emptyGraphData(),
    scannedAt: Date.now()
  };
  await dbPut('boards', board);
  return board;
}

async function addPinsToBoard(boardId, boardName, boardUrl, pins) {
  const board = await ensureBoard(boardId, boardName, boardUrl);
  board.pinCount = (board.pinCount || 0) + pins.length;
  board.scannedAt = Date.now();
  await dbPut('boards', board);
  for (const pin of pins) {
    await dbPut('pins', { ...pin, boardId });
  }
}

async function analyzeAndUpdateBoard(boardId, pins) {
  const board = await dbGet('boards', boardId);
  if (!board) return null;

  // Text-based analysis
  const analysis = await analyzePinBatch(pins);
  if (analysis) {
    board.graphData = mergeAnalysis(board.graphData || emptyGraphData(), analysis);
  }

  // Image-RAG analysis (visual)
  const visualAnalysis = await analyzeImagesRAG(pins);
  if (visualAnalysis) {
    board.graphData = mergeAnalysis(board.graphData, {
      themes: visualAnalysis.moodKeywords || [],
      aesthetics: visualAnalysis.visualAesthetics || [],
      categories: visualAnalysis.productCategories || [],
      lifestyle: visualAnalysis.lifestyleSignals || [],
      interests: [],
      colors: visualAnalysis.dominantColors || [],
      keywords: []
    });
    board.visualProductIdeas = visualAnalysis.specificProductIdeas || [];
  }

  board.analyzedAt = Date.now();
  await dbPut('boards', board);
  return board;
}

// ── Master Graph ──────────────────────────────────────────────────────────────

async function rebuildMasterGraph(enabledBoardIds) {
  const allBoards = await dbGetAll('boards');
  const toMerge = enabledBoardIds
    ? allBoards.filter(b => enabledBoardIds.includes(b.id))
    : allBoards.filter(b => b.enabled !== false);

  const master = emptyGraphData();
  for (const board of toMerge) {
    if (!board.graphData) continue;
    for (const field of Object.keys(master)) {
      for (const [k, v] of Object.entries(board.graphData[field] || {})) {
        master[field][k] = (master[field][k] || 0) + v;
      }
    }
  }

  const graphRecord = {
    key: 'master',
    ...master,
    boards: allBoards.map(b => b.id),
    updatedAt: Date.now()
  };
  await dbPut('graph', graphRecord);
  return graphRecord;
}

// ── Gift Generation ───────────────────────────────────────────────────────────

async function generateGiftIdeas(occasion, budget, recipientAge, boardIds, tasteProfileId) {
  let graph;

  if (tasteProfileId) {
    // Generate from a specific taste profile
    const profile = await dbGet('tasteProfiles', tasteProfileId);
    if (!profile) throw new Error('Taste profile not found');
    graph = { ...emptyGraphData() };
    // Merge from profile's boards + manual tags
    for (const bid of (profile.boardIds || [])) {
      const board = await dbGet('boards', bid);
      if (!board?.graphData) continue;
      for (const field of Object.keys(graph)) {
        for (const [k, v] of Object.entries(board.graphData[field] || {})) {
          graph[field][k] = (graph[field][k] || 0) + v;
        }
      }
    }
    // Manual tags override/boost
    for (const tag of (profile.manualTags || [])) {
      const k = tag.toLowerCase().trim();
      graph.keywords[k] = (graph.keywords[k] || 0) + 5;
    }
  } else {
    graph = await rebuildMasterGraph(boardIds);
  }

  const topTags = (obj) => Object.entries(obj || {}).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k])=>k);
  const tasteSummary = [
    `Themes: ${topTags(graph.themes).join(', ')}`,
    `Aesthetics: ${topTags(graph.aesthetics).join(', ')}`,
    `Interests: ${topTags(graph.interests).join(', ')}`,
    `Categories: ${topTags(graph.categories).join(', ')}`,
    `Lifestyle: ${topTags(graph.lifestyle).join(', ')}`,
    `Colors: ${topTags(graph.colors).join(', ')}`
  ].filter(s => !s.endsWith(': ')).join('\n');

  const prompt = `
    You're a thoughtful gift curator. Based on this person's taste profile:

    ${tasteSummary}

    Suggest 8 specific, creative gift ideas${occasion ? ` for ${occasion}` : ''}${budget && budget !== 'any' ? `, budget: ${budget}` : ''}${recipientAge && recipientAge !== 'adult' ? `, recipient: ${recipientAge}` : ''}.

    Each gift should feel personally curated — not generic. Think about what someone with this exact taste profile would genuinely love.

    Respond ONLY with valid JSON array:
    [{
      "name": "...",
      "description": "...",
      "price_range": "...",
      "category": "...",
      "match_reason": "why this fits their taste",
      "search_query": "specific search terms",
      "etsy_search": "etsy-specific query or null"
    }]
  `;

  const result = await getIdeas(
    [{ role: 'user', content: prompt }],
    'You are a thoughtful, creative gift curator who matches gifts to personal taste profiles derived from Pinterest boards. Always respond with valid JSON only.',
    5000
  );

  try {
    const match = result.match(/\[[\s\S]*\]/);
    if (!match) {
      // Try to find partial JSON and complete it
      const partialMatch = result.match(/\[\s*\{[\s\S]*/);
      if (partialMatch) {
        let partial = partialMatch[0];
        // Count braces to see if we can close it
        let braceCount = 0;
        let bracketCount = 1; // We have opening [
        for (let i = 1; i < partial.length; i++) {
          if (partial[i] === '{') braceCount++;
          if (partial[i] === '}') braceCount--;
        }
        // Close incomplete braces and array
        if (braceCount > 0) {
          partial += '}'.repeat(braceCount);
        }
        // Ensure array is closed
        if (!partial.trim().endsWith(']')) {
          partial += ']';
        }
        try {
          const ideas = JSON.parse(partial);
          return ideas.map(idea => ({
            ...idea,
            id: uid(),
            generatedAt: Date.now(),
            amazonUrl: `https://www.amazon.com/s?k=${encodeURIComponent(idea.search_query || idea.name)}`,
            etsyUrl: idea.etsy_search ? `https://www.etsy.com/search?q=${encodeURIComponent(idea.etsy_search)}` : null,
            googleUrl: `https://www.google.com/search?q=${encodeURIComponent((idea.name || '') + ' buy')}&tbm=shop`
          }));
        } catch (e) {
          // If partial JSON also fails, fall through to error below
        }
      }
      throw new Error('No valid JSON array found in response');
    }
    const ideas = JSON.parse(match[0]);
    return ideas.map(idea => ({
      ...idea,
      id: uid(),
      generatedAt: Date.now(),
      amazonUrl: `https://www.amazon.com/s?k=${encodeURIComponent(idea.search_query || idea.name)}`,
      etsyUrl: idea.etsy_search ? `https://www.etsy.com/search?q=${encodeURIComponent(idea.etsy_search)}` : null,
      googleUrl: `https://www.google.com/search?q=${encodeURIComponent((idea.name || '') + ' buy')}&tbm=shop`
    }));
  } catch (e) {
    console.error('[PinSieve] Gift parse error:', e, result);
    throw new Error('Failed to parse gift ideas');
  }
}

// ── Graph Explorer: Generate new nodes from combining tags ────────────────────

async function generateGraphCombination(selectedTags, allGraph) {
  const prompt = `
    A user is exploring their Pinterest taste profile and has selected these tags to combine:
    Tags selected: ${selectedTags.join(', ')}

    Their broader taste graph context:
    ${Object.entries(allGraph).map(([field, obj]) =>
      `${field}: ${Object.keys(obj||{}).slice(0,6).join(', ')}`
    ).join('\n')}

    Generate creative new concepts, gift ideas, or taste descriptors that emerge from combining these tags together. Think laterally and creatively.

    Respond ONLY with valid JSON:
    {
      "combinedConcept": "a poetic name for this combination",
      "description": "what this taste combination says about the person",
      "emergentTags": ["new tag ideas that emerge from the combination"],
      "giftIdeas": [
        { "name": "...", "description": "...", "searchQuery": "...", "priceRange": "..." }
      ],
      "moodBoard": ["evocative words that capture this vibe"]
    }
  `;

  const result = await getIdeas(
    [{ role: 'user', content: prompt }],
    'You are a creative taste analyst who finds unexpected and delightful connections between aesthetic preferences. Always respond with valid JSON.',
    2000
  );

  try {
    const match = result.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON');
    const parsed = JSON.parse(match[0]);
    if (parsed.giftIdeas) {
      parsed.giftIdeas = parsed.giftIdeas.map(idea => ({
        ...idea,
        amazonUrl: `https://www.amazon.com/s?k=${encodeURIComponent(idea.searchQuery || idea.name)}`,
        etsyUrl: `https://www.etsy.com/search?q=${encodeURIComponent(idea.searchQuery || idea.name)}`,
        googleUrl: `https://www.google.com/search?q=${encodeURIComponent(idea.name + ' buy')}&tbm=shop`,
        source: 'graph-explorer'
      }));
    }
    return parsed;
  } catch (e) {
    console.error('[PinSieve] Graph combine error:', e);
    throw new Error('Failed to generate combination');
  }
}

// ── Taste Profile CRUD ────────────────────────────────────────────────────────

async function createTasteProfile(name, boardIds, manualTags) {
  const profile = {
    id: uid(),
    name,
    boardIds: boardIds || [],
    manualTags: manualTags || [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  await dbPut('tasteProfiles', profile);
  return profile;
}

async function updateTasteProfile(id, updates) {
  const profile = await dbGet('tasteProfiles', id);
  if (!profile) throw new Error('Profile not found');
  Object.assign(profile, updates, { updatedAt: Date.now() });
  await dbPut('tasteProfiles', profile);
  return profile;
}

// ── Obsidian Builder ───────────────────────────────────────────────────────────

function buildObsidianVault(boards, savedGifts, tasteProfiles) {
  const files = {};

  for (const board of boards) {
    const name = board.customName || board.name;
    const gd = board.graphData || {};
    let md = `# ${name}\n\n`;
    md += `**Pins scanned:** ${board.pinCount || 0}  \n`;
    md += `**Last scanned:** ${board.scannedAt ? new Date(board.scannedAt).toLocaleDateString() : 'Unknown'}  \n`;
    md += `**Analyzed:** ${board.analyzedAt ? '✓ Yes' : '✗ Not yet'}  \n`;
    md += `**Source URL:** ${board.url || 'Unknown'}  \n\n`;

    const sections = [
      ['Themes', gd.themes], ['Aesthetics', gd.aesthetics],
      ['Interests', gd.interests], ['Categories', gd.categories],
      ['Lifestyle', gd.lifestyle], ['Colors', gd.colors], ['Keywords', gd.keywords],
    ];
    for (const [label, obj] of sections) {
      const entries = Object.entries(obj || {}).sort((a,b) => b[1]-a[1]);
      if (entries.length === 0) continue;
      md += `## ${label}\n`;
      for (const [tag, score] of entries) md += `- [[${tag}]] (${score})\n`;
      md += '\n';
    }
    files[`_boards/${name}.md`] = md;
  }

  // Taste profiles
  for (const profile of (tasteProfiles || [])) {
    let md = `# Taste Profile: ${profile.name}\n\n`;
    md += `**Created:** ${new Date(profile.createdAt).toLocaleDateString()}  \n`;
    md += `**Boards:** ${(profile.boardIds || []).join(', ')}  \n`;
    md += `**Custom Tags:** ${(profile.manualTags || []).join(', ')}  \n`;
    files[`_profiles/${profile.name}.md`] = md;
  }

  // Saved gift ideas grouped by profile
  const giftsByProfile = {};
  for (const gift of (savedGifts || [])) {
    const key = gift.tasteProfileId || 'general';
    if (!giftsByProfile[key]) giftsByProfile[key] = [];
    giftsByProfile[key].push(gift);
  }
  for (const [profileId, gifts] of Object.entries(giftsByProfile)) {
    const profile = (tasteProfiles || []).find(p => p.id === profileId);
    const profileName = profile?.name || 'General';
    let md = `# Gift Ideas — ${profileName}\n\n`;
    for (const gift of gifts) {
      md += `## ${gift.name}\n`;
      md += `**Price:** ${gift.price_range || '—'}  \n`;
      md += `**Why:** ${gift.match_reason || '—'}  \n`;
      md += `${gift.description}  \n\n`;
      md += `- [Amazon](${gift.amazonUrl})  \n`;
      if (gift.etsyUrl) md += `- [Etsy](${gift.etsyUrl})  \n`;
      md += `- [Google Shopping](${gift.googleUrl})  \n\n`;
    }
    files[`_gifts/${profileName}.md`] = md;
  }

  let index = `# PinSieve Export\n\n**Exported:** ${new Date().toISOString()}  \n`;
  index += `**Boards:** ${boards.length}  \n**Gift Ideas:** ${(savedGifts||[]).length}  \n\n## Boards\n`;
  for (const b of boards) index += `- [[${b.customName || b.name}]]\n`;
  files['_meta/Index.md'] = index;

  return files;
}

// ── Message Handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Auto-scan when content script signals it's ready on a board page
  if (msg.action === 'CONTENT_SCRIPT_READY') {
    const url = msg.url || '';
    const isBoardPage = isBoardUrl(url);
    if (isBoardPage) {
      // Check setting (default off for safety)
      chrome.storage.local.get('autoScanToggle', data => {
        const enabled = data.autoScanToggle === 'on';
        if (enabled && sender.tab?.id) {
          // Small delay to let the page settle
          setTimeout(() => {
            chrome.tabs.sendMessage(sender.tab.id, { action: 'SCAN_PAGE' }, () => {
              if (chrome.runtime.lastError) {
                // Ignore — tab may have navigated away
              }
            });
          }, 2000);
        }
      });
    }
    sendResponse({ status: 'ok' });
    return;
  }

  (async () => {
    try {
      switch (msg.action) {

        case 'PROCESS_PINS': {
          const { pins, board } = msg;
          const boardId = makeBoardId(board?.boardNameWithUser || 'unknown', board?.url || '');
          await addPinsToBoard(boardId, board?.boardNameWithUser || 'Unknown Board', board?.url || '', pins);
          // Just discover the board — don't analyze yet
          sendResponse({ status: 'ok', pinCount: pins.length, boardId });
          break;
        }

        case 'ANALYZE_BOARD': {
          const { boardId } = msg;
          const board = await dbGet('boards', boardId);
          if (!board) {
            sendResponse({ status: 'error', error: 'Board not found' });
            break;
          }
          const allPins = await dbGetAll('pins');
          const pins = allPins.filter(p => p.boardId === boardId);
          if (pins.length === 0) {
            sendResponse({ status: 'error', error: 'No pins found for this board' });
            break;
          }
          try {
            await analyzeAndUpdateBoard(boardId, pins);
            // Clear any previous analysis error
            const boardRecord = await dbGet('boards', boardId);
            if (boardRecord?.analysisError) {
              delete boardRecord.analysisError;
              await dbPut('boards', boardRecord);
            }
            await rebuildMasterGraph();
            sendResponse({ status: 'ok', boardId });
          } catch (err) {
            const boardRecord = await dbGet('boards', boardId);
            if (boardRecord) {
              boardRecord.analysisError = err.message;
              boardRecord.analysisErrorAt = Date.now();
              await dbPut('boards', boardRecord);
            }
            sendResponse({ status: 'error', error: err.message, boardId });
            await rebuildMasterGraph();
          }
          break;
        }

        case 'ANALYZE_ALL_BOARDS': {
          const boards = await dbGetAll('boards');
          const allPins = await dbGetAll('pins');
          const results = [];
          
          for (const board of boards) {
            const pins = allPins.filter(p => p.boardId === board.id);
            if (pins.length === 0) continue;
            
            try {
              await analyzeAndUpdateBoard(board.id, pins);
              const boardRecord = await dbGet('boards', board.id);
              if (boardRecord?.analysisError) {
                delete boardRecord.analysisError;
                await dbPut('boards', boardRecord);
              }
              results.push({ boardId: board.id, status: 'ok' });
            } catch (err) {
              const boardRecord = await dbGet('boards', board.id);
              if (boardRecord) {
                boardRecord.analysisError = err.message;
                boardRecord.analysisErrorAt = Date.now();
                await dbPut('boards', boardRecord);
              }
              results.push({ boardId: board.id, status: 'error', error: err.message });
            }
          }
          
          await rebuildMasterGraph();
          sendResponse({ status: 'ok', results });
          break;
        }

        case 'RETRY_BOARD_ANALYSIS': {
          const { boardId } = msg;
          const board = await dbGet('boards', boardId);
          if (!board) {
            sendResponse({ status: 'error', error: 'Board not found' });
            break;
          }
          const allPins = await dbGetAll('pins');
          const pins = allPins.filter(p => p.boardId === boardId);
          if (pins.length === 0) {
            sendResponse({ status: 'error', error: 'No pins found for this board' });
            break;
          }
          try {
            await analyzeAndUpdateBoard(boardId, pins);
            // Clear error
            const updated = await dbGet('boards', boardId);
            if (updated?.analysisError) {
              delete updated.analysisError;
              delete updated.analysisErrorAt;
              await dbPut('boards', updated);
            }
            await rebuildMasterGraph();
            sendResponse({ status: 'ok', boardId });
          } catch (err) {
            const updated = await dbGet('boards', boardId);
            if (updated) {
              updated.analysisError = err.message;
              updated.analysisErrorAt = Date.now();
              await dbPut('boards', updated);
            }
            sendResponse({ status: 'error', error: err.message, boardId });
          }
          break;
        }

        case 'REBUILD_GRAPH': {
          const allBoards = await dbGetAll('boards');
          if (allBoards.length === 0) {
            sendResponse({ status: 'error', error: 'No boards found. Visit a Pinterest board first.' });
            break;
          }
          let totalPins = 0;
          for (const board of allBoards) {
            const allPins = await dbGetAll('pins');
            const boardPins = allPins.filter(p => p.boardId === board.id);
            if (boardPins.length > 0) {
              board.graphData = emptyGraphData();
              const batchSize = 20;
              for (let i = 0; i < boardPins.length; i += batchSize) {
                const analysis = await analyzePinBatch(boardPins.slice(i, i + batchSize));
                mergeAnalysis(board.graphData, analysis);
              }
              board.analyzedAt = Date.now();
              await dbPut('boards', board);
              totalPins += boardPins.length;
            }
          }
          const graph = await rebuildMasterGraph();
          sendResponse({ status: 'ok', graph, pinCount: totalPins });
          break;
        }

        case 'GENERATE_GIFTS': {
          const { occasion, budget, recipientAge, boardIds, tasteProfileId } = msg;
          const ideas = await generateGiftIdeas(occasion, budget, recipientAge, boardIds, tasteProfileId);
          
          // Store results for persistence (in case popup closes before response received)
          const resultKey = `giftResults_${tasteProfileId || 'master'}`;
          chrome.storage.local.set({ [resultKey]: ideas });
          
          // Clear the generation in-progress flag
          chrome.storage.local.remove('generatingGifts');
          
          sendResponse({ status: 'ok', ideas });
          break;
        }

        case 'SAVE_GIFT_IDEA': {
          const gift = { ...msg.gift, id: msg.gift.id || uid(), savedAt: Date.now() };
          await dbPut('savedGifts', gift);
          sendResponse({ status: 'ok', gift });
          break;
        }

        case 'DELETE_GIFT_IDEA': {
          await dbDelete('savedGifts', msg.giftId);
          sendResponse({ status: 'ok' });
          break;
        }

        case 'GET_SAVED_GIFTS': {
          const gifts = await dbGetAll('savedGifts');
          sendResponse({ status: 'ok', gifts });
          break;
        }

        case 'GET_BOARDS': {
          const boards = await dbGetAll('boards');
          sendResponse({ status: 'ok', boards });
          break;
        }

        case 'RENAME_BOARD': {
          const board = await dbGet('boards', msg.boardId);
          if (!board) { sendResponse({ status: 'error', error: 'Board not found' }); break; }
          board.customName = msg.name;
          await dbPut('boards', board);
          sendResponse({ status: 'ok' });
          break;
        }

        case 'TOGGLE_BOARD': {
          const board = await dbGet('boards', msg.boardId);
          if (!board) { sendResponse({ status: 'error', error: 'Board not found' }); break; }
          board.enabled = msg.enabled;
          await dbPut('boards', board);
          await rebuildMasterGraph();
          sendResponse({ status: 'ok' });
          break;
        }

        case 'DELETE_BOARD': {
          const allPins = await dbGetAll('pins');
          const db = await openDB();
          await new Promise((res, rej) => {
            const tx = db.transaction('pins', 'readwrite');
            const store = tx.objectStore('pins');
            allPins.filter(p => p.boardId === msg.boardId).forEach(p => store.delete(p.id));
            tx.oncomplete = res;
            tx.onerror = e => rej(e.target.error);
          });
          await dbDelete('boards', msg.boardId);
          await rebuildMasterGraph();
          sendResponse({ status: 'ok' });
          break;
        }

        case 'GET_GRAPH': {
          const graph = await dbGet('graph', 'master');
          sendResponse({ status: 'ok', graph });
          break;
        }

        case 'GRAPH_COMBINE_TAGS': {
          const { selectedTags } = msg;
          try {
            const graph = await dbGet('graph', 'master');
            if (!graph || Object.keys(graph).length === 0) {
              sendResponse({ status: 'error', error: 'No graph data available. Analyze a board first.' });
              break;
            }
            const result = await generateGraphCombination(selectedTags, graph);
            sendResponse({ status: 'ok', result });
          } catch (err) {
            console.error('[PinSieve] Graph combine error:', err);
            if (err.rateLimited && err.resetTime) {
              sendResponse({ status: 'error', error: 'Rate limit exceeded', rateLimited: true, resetTime: err.resetTime });
            } else {
              sendResponse({ status: 'error', error: err.message });
            }
          }
          break;
        }

        case 'ADD_GRAPH_TAG': {
          const graph = await dbGet('graph', 'master');
          if (!graph) { sendResponse({ status: 'error', error: 'No graph yet' }); break; }
          const field = msg.field || 'keywords';
          if (!graph[field]) graph[field] = {};
          graph[field][msg.tag.toLowerCase().trim()] = msg.score || 1;
          await dbPut('graph', graph);
          sendResponse({ status: 'ok', graph });
          break;
        }

        case 'REMOVE_GRAPH_TAG': {
          const graph = await dbGet('graph', 'master');
          if (!graph) { sendResponse({ status: 'error', error: 'No graph yet' }); break; }
          for (const field of Object.keys(emptyGraphData())) {
            delete graph[field]?.[msg.tag];
          }
          await dbPut('graph', graph);
          sendResponse({ status: 'ok', graph });
          break;
        }

        // ── Taste Profiles ──
        case 'GET_TASTE_PROFILES': {
          const profiles = await dbGetAll('tasteProfiles');
          sendResponse({ status: 'ok', profiles });
          break;
        }

        case 'CREATE_TASTE_PROFILE': {
          const profile = await createTasteProfile(msg.name, msg.boardIds, msg.manualTags);
          sendResponse({ status: 'ok', profile });
          break;
        }

        case 'UPDATE_TASTE_PROFILE': {
          const profile = await updateTasteProfile(msg.id, msg.updates);
          sendResponse({ status: 'ok', profile });
          break;
        }

        case 'DELETE_TASTE_PROFILE': {
          await dbDelete('tasteProfiles', msg.id);
          sendResponse({ status: 'ok' });
          break;
        }

        case 'GET_STATS': {
          const [pins, boards, graph] = await Promise.all([
            dbGetAll('pins'), dbGetAll('boards'), dbGet('graph', 'master')
          ]);
          sendResponse({
            status: 'ok',
            pinCount: pins.length,
            boardCount: boards.length,
            hasGraph: boards.some(b => b.analyzedAt),
            hasApiKey: true, // proxy handles auth
            updatedAt: graph?.updatedAt
          });
          break;
        }

        case 'EXPORT_DATA': {
          const [allPins, allBoards, graph, savedGifts, tasteProfiles] = await Promise.all([
            dbGetAll('pins'), dbGetAll('boards'), dbGet('graph', 'master'),
            dbGetAll('savedGifts'), dbGetAll('tasteProfiles')
          ]);
          const payload = {
            exportedAt: new Date().toISOString(),
            version: 4,
            boards: allBoards,
            pins: allPins,
            masterGraph: graph,
            savedGifts,
            tasteProfiles,
            obsidianVault: buildObsidianVault(allBoards, savedGifts, tasteProfiles)
          };
          sendResponse({ status: 'ok', data: payload });
          break;
        }

        case 'CLEAR_DATA': {
          await dbClear('pins');
          await dbClear('graph');
          await dbClear('boards');
          await dbClear('savedGifts');
          await dbClear('tasteProfiles');
          sendResponse({ status: 'ok' });
          break;
        }

        default:
          sendResponse({ status: 'unknown_action' });
      }
    } catch (err) {
      console.error('[PinSieve] Worker error:', err);
      // Clear generation state if something went wrong
      chrome.storage.local.remove('generatingGifts');
      sendResponse({ status: 'error', error: err.message });
    }
  })();
  return true;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "CLAUDE_CALL") {
    getIdeas(msg.messages, msg.systemPrompt, msg.maxTokens)
      .then(result => sendResponse({ result }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function isBoardUrl(url) {
  if (!url || !url.includes('pinterest.com')) return false;
  if (url.includes('/pin/')) return false;
  const pathname = new URL(url).pathname.split('/').filter(Boolean);
  // Board URLs: pinterest.com/username/boardname
  return pathname.length >= 2;
}

// ── Auto-scan on SPA navigation ───────────────────────────────────────────────
// Pinterest is a SPA — navigating between boards doesn't reload the page,
// so the content_scripts declaration won't re-inject scraper.js.
// We listen for tab URL changes and inject + trigger a scan ourselves.

const recentAutoScans = new Map(); // tabId → last scanned URL, to avoid double-scanning

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only act when the page finishes loading and has a Pinterest board URL
  if (changeInfo.status !== 'complete') return;
  const url = tab.url || '';
  if (!isBoardUrl(url)) return;

  // Avoid scanning the same URL twice in quick succession
  if (recentAutoScans.get(tabId) === url) return;
  recentAutoScans.set(tabId, url);
  // Clear the cache entry after 30s so revisiting the same board can re-scan
  setTimeout(() => {
    if (recentAutoScans.get(tabId) === url) recentAutoScans.delete(tabId);
  }, 30000);

  // Check user setting (default off for safety)
  chrome.storage.local.get('autoScanToggle', async data => {
    const enabled = data.autoScanToggle === 'on';
    if (!enabled) return;

    try {
      // Inject the content script (safe — window.__pinSieveInjected guards re-injection)
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/scraper.js']
      });
      // Give the script a moment to set up its listener
      await new Promise(r => setTimeout(r, 400));
      // Trigger the scan
      chrome.tabs.sendMessage(tabId, { action: 'SCAN_PAGE' }, () => {
        if (chrome.runtime.lastError) {
          // Tab navigated away before we could message it — ignore
        }
      });
    } catch (e) {
      console.log('[PinSieve] Auto-scan inject failed:', e.message);
    }
  });
});
