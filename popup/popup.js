// popup/popup.js — v4: graph explorer, taste profiles, saved gifts, image-RAG, no API key

const $ = (id) => document.getElementById(id);

let currentTab = null;
let allBoards = [];
let allProfiles = [];
let selectedBoardIds = null;
let graphSelectedTags = new Set();
let savedGiftIds = new Set();
let isGenerating = false;
let resultsMode = false; // true when ideas are showing, filters hidden

// ── Theme ─────────────────────────────────────────────────────────────────────

(function initTheme() {
  const saved = localStorage.getItem("theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  $("themeToggle").querySelector(".theme-icon").textContent =
    saved === "light" ? "☀️" : "🌙";
})();

$("themeToggle").addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
  $("themeToggle").querySelector(".theme-icon").textContent =
    next === "light" ? "☀️" : "🌙";
});

// ── Navigation ────────────────────────────────────────────────────────────────

const PANELS = {
  home: "homePanel",
  boards: "boardsPanel",
  graph: "graphPanel",
  profiles: "profilesPanel",
  gifts: "giftsPanel",
  settings: "settingsPanel",
};

const NAV_BTNS = {
  home: "homeToggle",
  boards: "boardsToggle",
  graph: "graphToggle",
  profiles: "profilesToggle",
  gifts: "giftsToggle",
  settings: "settingsToggle",
};

let activePanel = "home";

function showPanel(name) {
  activePanel = name;
  Object.entries(PANELS).forEach(([key, id]) => {
    $(id).classList.toggle("active", key === name);
  });
  Object.entries(NAV_BTNS).forEach(([key, id]) => {
    $(id).classList.toggle("active", key === name);
  });

  if (name === "boards") renderBoardsList();
  if (name === "graph") renderGraphExplorer();
  if (name === "profiles") renderProfilesPanel();
  if (name === "gifts") renderSavedGifts();
}

function setupNavigation() {
  Object.entries(NAV_BTNS).forEach(([key, id]) => {
    $(id).addEventListener("click", () => showPanel(key));
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  setupNavigation();
  setupSettingsToggles();
  await checkCurrentTab();
  // Load boards and profiles first so refreshStats can use them
  await loadBoards();
  await loadProfiles();
  populateProfileSelectors();
  // Now update stats with correct counts
  const stats = await refreshStats();

  if (stats?.pinCount > 0 && !stats?.hasGraph) {
    showEmptyState(stats);
  }

  // Event delegation
  document.addEventListener("click", handleDelegatedClicks);
  $("generateBtn").addEventListener("click", generateGifts);
  $("scanBtn").addEventListener("click", triggerScan);
  $("exportBtn").addEventListener("click", exportData);
  $("clearData").addEventListener("click", async () => {
    if (!confirm("Clear ALL data? This cannot be undone.")) return;
    await sendMessage({ action: "CLEAR_DATA" });
    allBoards = [];
    allProfiles = [];
    selectedBoardIds = null;
    $("pinCountVal").textContent = 0;
    $("boardCountVal").textContent = 0;
    $("profileCountVal").textContent = 0;
    populateProfileSelectors();
    renderBoardChips(null);
    // Clear graph tags on home page
    $("graphTags").innerHTML = "";
    $("graphSection").style.display = "none";
    showToast("All data cleared");
  });

  // Graph Explorer
  $("combineBtn").addEventListener("click", combineTags);
  $("addTagBtn").addEventListener("click", addCustomTag);
  $("addTagInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addCustomTag();
  });

  // Taste Profiles
  $("createProfileBtn").addEventListener("click", createProfile);
  $("newProfileName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") createProfile();
  });

  // Profile selector: update boards + tags on change
  $("profileSelector").addEventListener("change", async () => {
    const profileId = $("profileSelector").value || null;
    renderBoardChips(profileId);
    if (profileId) {
      await loadGraphTags(profileId);
    } else {
      await loadGraphTags(null);
    }
  });

  // Clear results button
  $("clearResultsBtn").addEventListener("click", clearResults);

  // Restore persisted ideas if any
  await restorePersistedIdeas();

  // Check if generation was in progress
  await restoreGenerationState();

  // Check if API rate limit is still active
  await checkForExistingRateLimit();

  // Saved Gifts export
  $("exportGiftsBtn").addEventListener("click", exportGifts);
  $("giftsProfileFilter").addEventListener("change", renderSavedGifts);
}

// ── Settings Toggles ──────────────────────────────────────────────────────────

function setupSettingsToggles() {
  const keys = ["autoScanToggle", "imageRagToggle", "etsyToggle"];
  // Read from chrome.storage.local (falls back to localStorage for backward compat)
  chrome.storage.local.get(keys, (data) => {
    keys.forEach((id) => {
      const btn = $(id);
      const saved =
        data && data[id] !== undefined
          ? data[id]
          : localStorage.getItem(id) || "off";
      if (saved === "off") btn.classList.remove("on");
      else btn.classList.add("on");
      btn.addEventListener("click", () => {
        btn.classList.toggle("on");
        const val = btn.classList.contains("on") ? "on" : "off";
        localStorage.setItem(id, val);
        const storageObj = {};
        storageObj[id] = val;
        chrome.storage.local.set(storageObj);
      });
    });
  });

  // Custom API Settings
  const customAPIToggle = $("customAPIToggle");
  const customAPIProvider = $("customAPIProvider");
  const customAPIKey = $("customAPIKey");
  const saveAPIKeyBtn = $("saveAPIKeyBtn");
  const clearAPIKeyBtn = $("clearAPIKeyBtn");
  const customAPIContainer = $("customAPIContainer");

  if (customAPIToggle && customAPIProvider && customAPIKey) {
    chrome.storage.local.get(
      ["customAPIEnabled", "customAPIProvider", "customAPIKey"],
      (data) => {
        if (data.customAPIEnabled === "on") {
          customAPIToggle.classList.add("on");
          customAPIContainer.style.display = "block";
        }
        if (data.customAPIProvider) {
          customAPIProvider.value = data.customAPIProvider;
        }
        // Don't display the key for security, but show a placeholder if saved
        if (data.customAPIKey) {
          customAPIKey.placeholder = "✓ API key saved (masked)";
          customAPIKey.value = "";
        }
      },
    );

    customAPIToggle.addEventListener("click", () => {
      customAPIToggle.classList.toggle("on");
      const val = customAPIToggle.classList.contains("on") ? "on" : "off";
      customAPIContainer.style.display = val === "on" ? "block" : "none";
      chrome.storage.local.set({ customAPIEnabled: val });
    });

    customAPIProvider.addEventListener("change", () => {
      chrome.storage.local.set({ customAPIProvider: customAPIProvider.value });
    });

    if (saveAPIKeyBtn) {
      saveAPIKeyBtn.addEventListener("click", () => {
        const key = customAPIKey.value.trim();
        if (!key) {
          showToast("Please enter an API key", "error");
          return;
        }
        chrome.storage.local.set({ customAPIKey: key }, () => {
          showToast("API key saved successfully", "success");
          customAPIKey.placeholder = "✓ API key saved (masked)";
          customAPIKey.value = "";
        });
      });
    }

    if (clearAPIKeyBtn) {
      clearAPIKeyBtn.addEventListener("click", () => {
        if (confirm("Remove saved API key?")) {
          chrome.storage.local.remove(["customAPIKey"], () => {
            showToast("API key removed", "success");
            customAPIKey.placeholder = "Enter your API key";
            customAPIKey.value = "";
          });
        }
      });
    }
  }
}

// ── Tab Detection ─────────────────────────────────────────────────────────────

async function checkCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    currentTab = tab;
    const isPinterest = tab?.url?.includes("pinterest.com") || false;
    if (isPinterest) {
      $("scanBanner").classList.add("active-pinterest");
      $("scanIcon").textContent = "📍";
      $("scanTitle").textContent = "Pinterest detected!";
      $("scanDesc").textContent = "Click to scan this board for preferences";
      $("scanBtn").style.display = "block";
    } else {
      $("scanTitle").textContent = "Not on Pinterest";
      $("scanDesc").textContent = "Navigate to a Pinterest board to scan pins";
    }
  } catch (e) {
    console.error("Tab check:", e);
  }
}

async function triggerScan() {
  if (!currentTab?.id) return;
  $("scanBtn").disabled = true;
  $("scanBtn").textContent = "Scanning…";
  $("scanDesc").textContent = "Injecting scanner…";
  try {
    // Always inject the content script first — safe even if already injected
    // (Chrome deduplicates; using world: MAIN ensures we don't double-listen)
    await ensureContentScript(currentTab.id);

    $("scanDesc").textContent = "Extracting pins…";
    // Give the injected script a moment to register its listener
    await new Promise((r) => setTimeout(r, 300));

    await chrome.tabs.sendMessage(currentTab.id, { action: "SCAN_PAGE" });

    $("scanDesc").textContent = "Analyzing taste signals…";
    await new Promise((r) => setTimeout(r, 5000));
    await loadBoards();
    await loadProfiles();
    const currentProfileId = $("profileSelector").value || null;
    await loadGraphTags(currentProfileId);
    const stats = await sendMessage({ action: "GET_STATS" });
    if (stats?.updatedAt)
      $("lastUpdateVal").textContent = timeAgo(stats.updatedAt);
    $("scanDesc").textContent = "Board scanned and analyzed!";
    setTimeout(() => {
      $("scanDesc").textContent = "Click to scan this board for preferences";
    }, 3000);
    showToast("Scan complete!", "success");
  } catch (e) {
    showToast("Scan failed: " + e.message, "error");
    $("scanDesc").textContent = "Click to scan this board for preferences";
  } finally {
    $("scanBtn").disabled = false;
    $("scanBtn").textContent = "Scan Now";
  }
}

// Inject content script into a tab if not already present.
// Uses a ping → inject pattern to avoid double-injection errors.
async function ensureContentScript(tabId) {
  try {
    // Ping to see if script is already alive
    await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { action: "PING" }, (resp) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(resp);
      });
    });
    // Ping succeeded — script already present
  } catch (_) {
    // Script not present — inject it now
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/scraper.js"],
    });
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────

async function refreshStats() {
  const resp = await sendMessage({ action: "GET_STATS" });
  if (!resp || resp.status !== "ok") return null;
  // Use board-summed pin count (avoids duplicates in raw pins store)
  const boardPinSum = allBoards.reduce((s, b) => s + (b.pinCount || 0), 0);
  $("pinCountVal").textContent = boardPinSum || resp.pinCount || 0;
  $("boardCountVal").textContent = resp.boardCount || 0;
  $("profileCountVal").textContent = allProfiles.length;
  $("lastUpdateVal").textContent = resp.updatedAt
    ? timeAgo(resp.updatedAt)
    : "—";
  if (resp.hasGraph) await loadGraphTags();
  return resp;
}

async function loadGraphTags(profileId) {
  let graph;
  let boardsForTrend = [];

  if (profileId) {
    const profile = allProfiles.find((p) => p.id === profileId);
    if (!profile) return;
    const merged = {
      themes: {},
      aesthetics: {},
      categories: {},
      lifestyle: {},
      interests: {},
      colors: {},
      keywords: {},
    };
    for (const bid of profile.boardIds || []) {
      const board = allBoards.find((b) => b.id === bid);
      if (!board?.graphData) continue;
      boardsForTrend.push(board);
      for (const field of Object.keys(merged)) {
        for (const [k, v] of Object.entries(board.graphData[field] || {})) {
          merged[field][k] = (merged[field][k] || 0) + v;
        }
      }
    }
    for (const tag of profile.manualTags || []) {
      const k = tag.toLowerCase().trim();
      merged.keywords[k] = (merged.keywords[k] || 0) + 3;
    }
    graph = merged;
  } else {
    const resp = await sendMessage({ action: "GET_GRAPH" });
    if (!resp?.graph) return;
    graph = resp.graph;
    boardsForTrend = allBoards;
  }

  // Build tag freshness map: tag -> most recent board scannedAt that includes it
  const tagFreshness = {};
  const now = Date.now();
  for (const board of boardsForTrend) {
    if (!board.graphData || !board.scannedAt) continue;
    for (const field of Object.keys(board.graphData)) {
      for (const tag of Object.keys(board.graphData[field] || {})) {
        if (!tagFreshness[tag] || board.scannedAt > tagFreshness[tag]) {
          tagFreshness[tag] = board.scannedAt;
        }
      }
    }
  }

  const TRENDING_MS = 7 * 24 * 60 * 60 * 1000; // < 7 days = trending
  const STALE_MS = 30 * 24 * 60 * 60 * 1000; // > 30 days = stale

  const allTags = [];
  const addTags = (obj, n) => {
    Object.entries(obj || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .forEach(([k, v]) => allTags.push({ label: k, score: v }));
  };
  addTags(graph.themes, 4);
  addTags(graph.aesthetics, 3);
  addTags(graph.interests, 5);
  addTags(graph.categories, 3);
  addTags(graph.keywords, 3);

  const seen = new Set();
  const unique = allTags
    .filter((t) => {
      if (seen.has(t.label)) return false;
      seen.add(t.label);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 18);
  const maxScore = unique[0]?.score || 1;

  $("graphTags").innerHTML = unique
    .map((t) => {
      const age = tagFreshness[t.label]
        ? now - tagFreshness[t.label]
        : Infinity;
      const isTrending = age < TRENDING_MS;
      const isStale = age > STALE_MS;
      const lv = isTrending
        ? "trending"
        : isStale
          ? "stale"
          : t.score / maxScore > 0.6
            ? "high"
            : t.score / maxScore > 0.3
              ? "med"
              : "";
      const dot = isTrending
        ? `<span class="tag-trend-dot up" title="Trending — from a board scanned recently"></span>`
        : isStale
          ? `<span class="tag-trend-dot down" title="Stale — from a board scanned 30+ days ago"></span>`
          : "";
      return `<span class="graph-tag ${lv}" title="${isTrending ? "↑ Trending" : isStale ? "↓ Stale" : ""}">${dot}${escapeHtml(t.label)}</span>`;
    })
    .join("");

  $("graphSection").style.display = unique.length > 0 ? "block" : "none";
}

// ── Board Management ──────────────────────────────────────────────────────────

async function loadBoards() {
  const resp = await sendMessage({ action: "GET_BOARDS" });
  allBoards = resp?.boards || [];
  // Update pin count stat from boards (authoritative source)
  const boardPinSum = allBoards.reduce((s, b) => s + (b.pinCount || 0), 0);
  $("pinCountVal").textContent = boardPinSum;
  $("boardCountVal").textContent = allBoards.length;
  renderBoardChips();
}

function renderBoardChips(profileId, locked) {
  const section = $("boardSelectSection");
  const chips = $("boardChips");
  if (allBoards.length === 0) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";

  let displayBoards = allBoards;
  if (profileId) {
    // Only show boards belonging to this profile, all auto-selected
    const profile = allProfiles.find((p) => p.id === profileId);
    const profileBoardIds = profile?.boardIds || [];
    displayBoards = allBoards.filter((b) => profileBoardIds.includes(b.id));
    selectedBoardIds = profileBoardIds.slice();
  } else {
    if (selectedBoardIds === null) {
      selectedBoardIds = allBoards
        .filter((b) => b.enabled !== false)
        .map((b) => b.id);
    }
  }

  chips.innerHTML = displayBoards
    .map((b) => {
      const name = b.customName || b.name;
      const sel = selectedBoardIds.includes(b.id);
      return `<div class="board-chip ${sel ? "selected" : ""}" data-board-id="${escapeAttr(b.id)}">
      <div class="board-chip-dot"></div>
      <span>${escapeHtml(name)}</span>
    </div>`;
    })
    .join("");

  // Lock chips during generation or when profile is active
  chips.classList.toggle("locked", !!(locked || profileId));

  if (!profileId && !locked) {
    // Only bind click events when not locked
    chips.querySelectorAll(".board-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const id = chip.dataset.boardId;
        if (selectedBoardIds.includes(id)) {
          selectedBoardIds = selectedBoardIds.filter((x) => x !== id);
        } else {
          selectedBoardIds = [...selectedBoardIds, id];
        }
        renderBoardChips();
      });
    });
  }
  updateBoardSelectCount();
}

function updateBoardSelectCount() {
  const profileId = $("profileSelector").value;
  const profile = profileId
    ? allProfiles.find((p) => p.id === profileId)
    : null;
  const displayBoards = profile
    ? allBoards.filter((b) => (profile.boardIds || []).includes(b.id))
    : allBoards;
  const total = displayBoards.length;
  const sel = selectedBoardIds?.length || 0;
  $("boardSelectCount").textContent = profileId
    ? `${total} board${total !== 1 ? "s" : ""} from profile`
    : sel === total
      ? "All selected"
      : `${sel} of ${total}`;
}

function getBoardTopTags(board, n) {
  const gd = board.graphData || {};
  const all = [];
  Object.entries(gd).forEach(([field, obj]) => {
    Object.entries(obj || {}).forEach(([k, v]) => all.push({ k, v }));
  });
  return all
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
    .map((t) => t.k);
}

function renderBoardsList() {
  const container = $("boardsList");
  if (allBoards.length === 0) {
    container.innerHTML = `<div class="empty-boards"><div class="empty-boards-icon">📌</div>
      <div class="empty-boards-text">No boards scanned yet.<br>Visit a Pinterest board and click "Scan Now".</div></div>`;
    $("savedDataSub").textContent = "No boards saved yet";
    return;
  }
  $("savedDataSub").textContent =
    `${allBoards.length} board${allBoards.length !== 1 ? "s" : ""} saved`;

  // Filter to boards that need analysis (not yet analyzed)
  const boardsNeedingAnalysis = allBoards.filter((b) => !b.analyzedAt);

  container.innerHTML = allBoards
    .map((board) => {
      const name = board.customName || board.name;
      const isOn = board.enabled !== false;
      const tags = getBoardTopTags(board, 10);
      const pinCount = board.pinCount || 0;
      const scanDate = board.scannedAt ? timeAgo(board.scannedAt) : "Unknown";
      const hasData = board.analyzedAt;
      const hasError = board.analysisError;
      const isAnalyzing = board.isAnalyzing; // Temporary flag for UI feedback
      return `
      <div class="board-card ${isOn ? "" : "disabled"}" id="bc-${escapeAttr(board.id)}">
        <div class="board-card-header" data-expand-id="${escapeAttr(board.id)}">
          <button class="board-toggle ${isOn ? "on" : ""}" data-toggle-id="${escapeAttr(board.id)}"></button>
          <div class="board-info">
            <div class="board-custom-name">${escapeHtml(name)}</div>
            ${board.customName && board.customName !== board.name ? `<div class="board-orig-name">Original: ${escapeHtml(board.name)}</div>` : ""}
            <div class="board-meta">${pinCount} pins · ${scanDate}${hasError ? ' · <span class="error-badge">⚠️ Analysis failed</span>' : isAnalyzing ? ' · <span class="analyzing-badge">⏳ analyzing…</span>' : hasData ? " · ✓ analyzed" : ' · <span class="pending-badge">pending analysis</span>'}</div>
          </div>
          <button class="board-expand-btn" data-expand-id="${escapeAttr(board.id)}">▾</button>
        </div>
        <div class="board-card-body" id="body-${escapeAttr(board.id)}">
          ${
            hasError
              ? `<div style="background:var(--error-bg,rgba(255,59,48,0.1));border-left:3px solid var(--error-color,#ff3b30);padding:10px;margin-bottom:15px;border-radius:4px;">
            <div style="font-size:12px;color:var(--text-main);margin-bottom:5px;"><strong>Analysis failed</strong></div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">${escapeHtml(hasError)}</div>
            <button class="retry-analysis-btn" data-retry-id="${escapeAttr(board.id)}" style="background:var(--error-color,#ff3b30);color:white;border:none;padding:5px 10px;border-radius:3px;font-size:11px;cursor:pointer;">Retry Analysis</button>
          </div>`
              : ""
          }
          ${
            !hasData && !hasError && !isAnalyzing
              ? `<div style="background:var(--info-bg,rgba(33,150,243,0.1));border-left:3px solid var(--info);padding:10px;margin-bottom:10px;border-radius:4px;">
            <button class="analyze-board-btn" data-analyze-id="${escapeAttr(board.id)}" style="background:var(--info);color:white;border:none;padding:6px 12px;border-radius:3px;font-size:12px;cursor:pointer;font-weight:500;">Analyze this board</button>
          </div>`
              : ""
          }
          <div class="rename-row">
            <input class="rename-input" id="rename-${escapeAttr(board.id)}" placeholder="Custom name…" value="${escapeAttr(name)}">
            <button class="rename-btn" data-rename-id="${escapeAttr(board.id)}">Rename</button>
          </div>
          ${
            tags.length > 0
              ? `<div class="board-tags-label" style="font-size:10px;color:var(--text-muted);margin-bottom:5px;">Taste signals</div>
            <div class="board-tags">${tags.map((t) => `<span class="board-tag">${escapeHtml(t)}</span>`).join("")}</div>`
              : ""
          }
          <button class="board-del-btn" data-delete-id="${escapeAttr(board.id)}">Remove board</button>
        </div>
      </div>`;
    })
    .join("");

  // Add "Analyze All" button if there are boards needing analysis and none are currently analyzing
  const anyAnalyzing = allBoards.some((b) => b.isAnalyzing);
  if (boardsNeedingAnalysis.length > 0 && !anyAnalyzing) {
    container.innerHTML += `<div style="padding:15px;text-align:center;border-top:1px solid var(--border-color);margin-top:15px;">
      <button id="analyzeAllBtn" style="background:linear-gradient(135deg,var(--gold),var(--gold-light));color:white;border:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Analyze ${boardsNeedingAnalysis.length} Board${boardsNeedingAnalysis.length !== 1 ? "s" : ""}</button>
    </div>`;
  }
}

// ── Graph Explorer ────────────────────────────────────────────────────────────

async function renderGraphExplorer() {
  const resp = await sendMessage({ action: "GET_GRAPH" });
  const graph = resp?.graph;
  const container = $("graphExplorerFields");

  if (!graph) {
    container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:11px;">Scan a Pinterest board to build your graph.</div>`;
    return;
  }

  const FIELD_ICONS = {
    themes: "🎨",
    aesthetics: "✦",
    interests: "💡",
    categories: "📦",
    lifestyle: "🌿",
    colors: "🎨",
    keywords: "🏷️",
  };
  const FIELD_LABELS = {
    themes: "Themes",
    aesthetics: "Aesthetics",
    interests: "Interests",
    categories: "Categories",
    lifestyle: "Lifestyle",
    colors: "Colors",
    keywords: "Keywords",
  };

  const fields = [
    "themes",
    "aesthetics",
    "interests",
    "categories",
    "lifestyle",
    "colors",
    "keywords",
  ];
  let html = "";

  for (const field of fields) {
    const obj = graph[field] || {};
    const tags = Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    if (tags.length === 0) continue;
    html += `<div class="graph-field-header"><span class="graph-field-icon">${FIELD_ICONS[field]}</span>${FIELD_LABELS[field]}</div>`;
    html += `<div class="graph-tags-editable" data-field="${field}">`;
    for (const [tag, score] of tags) {
      const isSelected = graphSelectedTags.has(tag);
      html += `<div class="graph-tag-editable ${isSelected ? "selected-tag" : ""}" data-tag="${escapeAttr(tag)}" data-field="${field}">
        <span>${escapeHtml(tag)}</span>
        <span class="tag-remove-x" data-remove-tag="${escapeAttr(tag)}" title="Remove tag">×</span>
      </div>`;
    }
    html += `</div>`;
  }

  container.innerHTML =
    html ||
    `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:11px;">No tags yet.</div>`;
  updateSelectedTagsBar();

  // Bind clicks
  container.querySelectorAll(".graph-tag-editable").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.classList.contains("tag-remove-x")) return;
      const tag = el.dataset.tag;
      if (graphSelectedTags.has(tag)) {
        graphSelectedTags.delete(tag);
        el.classList.remove("selected-tag");
      } else {
        graphSelectedTags.add(tag);
        el.classList.add("selected-tag");
      }
      updateSelectedTagsBar();
    });
  });

  container.querySelectorAll(".tag-remove-x").forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      const tag = el.dataset.removeTag;
      const resp = await sendMessage({ action: "REMOVE_GRAPH_TAG", tag });
      if (resp?.status === "ok") {
        graphSelectedTags.delete(tag);
        await renderGraphExplorer();
        showToast("Tag removed");
      }
    });
  });
}

function updateSelectedTagsBar() {
  const bar = $("selectedTagsBar");
  const count = $("selectedTagsCount");
  const btn = $("combineBtn");
  const tags = [...graphSelectedTags];
  count.textContent = `(${tags.length})`;

  if (tags.length === 0) {
    bar.innerHTML = `<span style="font-size:10px; color:var(--text-dim); font-style:italic">Click tags below to select…</span>`;
    btn.disabled = true;
    return;
  }

  bar.innerHTML = tags
    .map(
      (t) =>
        `<div class="selected-tag-chip">${escapeHtml(t)}<span class="x" data-deselect="${escapeAttr(t)}">×</span></div>`,
    )
    .join("");

  bar.querySelectorAll(".x").forEach((el) => {
    el.addEventListener("click", () => {
      graphSelectedTags.delete(el.dataset.deselect);
      // Also deselect visually
      document
        .querySelectorAll(
          `.graph-tag-editable[data-tag="${el.dataset.deselect}"]`,
        )
        .forEach((el) => el.classList.remove("selected-tag"));
      updateSelectedTagsBar();
    });
  });

  btn.disabled = tags.length < 2;
}

async function combineTags() {
  const tags = [...graphSelectedTags];
  if (tags.length < 2) return;
  $("combineBtn").disabled = true;
  $("combineBtn").textContent = "⚡ Generating…";

  const resultDiv = $("combinationResult");
  resultDiv.style.display = "block";
  resultDiv.innerHTML = `<div class="loading"><div class="spinner"></div><div class="loading-text" style="font-size:12px">Combining tags…</div></div>`;

  try {
    const resp = await sendMessage({
      action: "GRAPH_COMBINE_TAGS",
      selectedTags: tags,
    });
    $("combineBtn").disabled = false;
    $("combineBtn").textContent = "⚡ Generate Ideas from Selected Tags";

    if (resp?.status !== "ok" || !resp.result) {
      const errMsg = resp?.error || "Failed to generate. Check your proxy server.";
      resultDiv.innerHTML = `<div style="color:var(--coral);font-size:11px;">${escapeHtml(errMsg)}</div>`;
      return;
    }

    const r = resp.result;
    let html = `<div class="combination-result">
      <div class="combination-concept">${escapeHtml(r.combinedConcept || "New concept")}</div>
      <div class="combination-desc">${escapeHtml(r.description || "")}</div>`;

    if (r.moodBoard?.length > 0) {
      html += `<div class="combination-moods">${r.moodBoard.map((m) => `<span class="mood-chip">${escapeHtml(m)}</span>`).join("")}</div>`;
    }

    if (r.emergentTags?.length > 0) {
      html += `<div style="font-size:10px;color:var(--text-muted);margin-bottom:5px;">New tags discovered</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">
          ${r.emergentTags.map((t) => `<span class="graph-tag med">${escapeHtml(t)}</span>`).join("")}
        </div>`;
    }

    if (r.giftIdeas?.length > 0) {
      html += `<div style="font-size:10px;color:var(--text-muted);margin-bottom:7px;margin-top:4px;">Gift ideas from this combo</div>`;
      for (const idea of r.giftIdeas) {
        const giftId =
          "rag-" + Date.now() + "-" + Math.random().toString(36).slice(2, 5);
        html += `<div class="gift-card" style="margin-bottom:6px;">
          <div class="gift-header"><div class="gift-name">${escapeHtml(idea.name)}</div><div class="gift-price">${escapeHtml(idea.priceRange || "")}</div></div>
          <div class="gift-desc">${escapeHtml(idea.description || "")}</div>
          <div class="gift-links">
            <a class="shop-link" href="${idea.amazonUrl}" target="_blank">🛒 Amazon</a>
            <a class="shop-link" href="${idea.etsyUrl}" target="_blank">🧵 Etsy</a>
            <a class="shop-link" href="${idea.googleUrl}" target="_blank">🔍 Shop</a>
            <button class="gift-save-btn" data-save-gift='${JSON.stringify({ ...idea, name: idea.name, description: idea.description, price_range: idea.priceRange }).replace(/'/g, "&#39;")}'>☆ Save</button>
          </div>
        </div>`;
      }
    }

    html += `</div>`;
    resultDiv.innerHTML = html;

    // Bind save buttons
    resultDiv.querySelectorAll(".gift-save-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const gift = JSON.parse(btn.dataset.saveGift.replace(/&#39;/g, "'"));
          await saveGift(gift, null);
          btn.textContent = "✓ Saved";
          btn.classList.add("saved");
          btn.disabled = true;
        } catch (e) {
          console.error(e);
        }
      });
    });
  } catch (err) {
    $("combineBtn").disabled = false;
    $("combineBtn").textContent = "⚡ Generate Ideas from Selected Tags";
    if (err.rateLimited && err.resetTime) {
      showRateLimitToast(err.resetTime);
      chrome.storage.local.set({
        rateLimitedAt: Date.now(),
        rateLimitResetTime: err.resetTime,
      });
    } else {
      resultDiv.innerHTML = `<div style="color:var(--coral);font-size:11px;">Error: ${escapeHtml(err.message || "Generation failed")}</div>`;
    }
  }
}

async function addCustomTag() {
  const input = $("addTagInput");
  const field = $("addTagField").value;
  const tag = input.value.trim();
  if (!tag) return;
  try {
    const resp = await sendMessage({
      action: "ADD_GRAPH_TAG",
      tag,
      field,
      score: 1,
    });
    if (resp?.status === "ok") {
      input.value = "";
      await renderGraphExplorer();
      showToast(`Added "${tag}" to ${field}`, "success");
    } else {
      showToast("Failed to add tag", "error");
    }
  } catch (err) {
    if (err.rateLimited && err.resetTime) {
      showRateLimitToast(err.resetTime);
      chrome.storage.local.set({
        rateLimitedAt: Date.now(),
        rateLimitResetTime: err.resetTime,
      });
    } else {
      showToast("Error: " + err.message, "error");
    }
  }
}

// ── Graph Similarity ──────────────────────────────────────────────────────────

function getBoardTagSet(board) {
  const tags = new Set();
  const gd = board.graphData || {};
  for (const field of Object.keys(gd)) {
    for (const tag of Object.keys(gd[field] || {})) {
      tags.add(tag);
    }
  }
  return tags;
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function computeProfileSimilarities(profile) {
  const boardIds = profile.boardIds || [];
  const boards = boardIds
    .map((id) => allBoards.find((b) => b.id === id))
    .filter(Boolean);
  if (boards.length < 2) return [];

  const tagSets = boards.map((b) => ({ board: b, tags: getBoardTagSet(b) }));
  const pairs = [];
  for (let i = 0; i < tagSets.length; i++) {
    for (let j = i + 1; j < tagSets.length; j++) {
      const sim = jaccardSimilarity(tagSets[i].tags, tagSets[j].tags);
      pairs.push({
        a: tagSets[i].board,
        b: tagSets[j].board,
        score: sim,
      });
    }
  }
  return pairs.sort((a, b) => b.score - a.score);
}

// ── Taste Profiles ────────────────────────────────────────────────────────────

async function loadProfiles() {
  const resp = await sendMessage({ action: "GET_TASTE_PROFILES" });
  allProfiles = resp?.profiles || [];
}

function populateProfileSelectors() {
  // Home panel profile selector
  const sel = $("profileSelector");
  const giftsFilter = $("giftsProfileFilter");
  const options = allProfiles
    .map(
      (p) =>
        `<option value="${escapeAttr(p.id)}">${escapeHtml(p.name)}</option>`,
    )
    .join("");
  sel.innerHTML = `<option value="">All boards (master profile)</option>${options}`;
  giftsFilter.innerHTML = `<option value="">All profiles</option>${options}`;
}

function renderSimilaritySection(profile) {
  const pairs = computeProfileSimilarities(profile);
  if (pairs.length === 0) return "";

  const rows = pairs
    .slice(0, 6)
    .map((pair) => {
      const pct = Math.round(pair.score * 100);
      const level = pct >= 60 ? "high" : pct >= 30 ? "med" : "low";
      const label =
        pct >= 60 ? "High overlap" : pct >= 30 ? "Moderate" : "Low overlap";
      const nameA = escapeHtml((pair.a.customName || pair.a.name).slice(0, 18));
      const nameB = escapeHtml((pair.b.customName || pair.b.name).slice(0, 18));
      return `<div class="sim-pair">
      <div class="sim-pair-names"><strong>${nameA}</strong> × <strong>${nameB}</strong></div>
      <span class="sim-badge ${level}">${pct}% — ${label}</span>
    </div>`;
    })
    .join("");

  return `<div class="similarity-section">
    <div class="profile-section-label" style="margin-top:10px;">Board similarity</div>
    <div class="similarity-grid">${rows}</div>
  </div>`;
}

function renderProfilesPanel() {
  const container = $("profilesList");
  if (allProfiles.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">✦</div>
      <div class="empty-title">No taste profiles yet</div>
      <div class="empty-desc">Create profiles to group boards and add custom tags for specific people.</div></div>`;
    return;
  }

  container.innerHTML = allProfiles
    .map((profile) => {
      const boardCount = profile.boardIds?.length || 0;
      const tagCount = profile.manualTags?.length || 0;
      return `
      <div class="profile-card" id="pc-${escapeAttr(profile.id)}">
        <div class="profile-card-header" data-expand-profile="${escapeAttr(profile.id)}">
          <div class="profile-dot"></div>
          <div class="profile-info" style="flex:1;min-width:0;">
            <div class="profile-name">${escapeHtml(profile.name)}</div>
            <div class="profile-meta">${boardCount} board${boardCount !== 1 ? "s" : ""} · ${tagCount} custom tag${tagCount !== 1 ? "s" : ""}</div>
          </div>
          <span style="font-size:11px;color:var(--text-muted)">▾</span>
        </div>
        <div class="profile-card-body" id="pbody-${escapeAttr(profile.id)}">
          <div class="profile-section-label">Boards included</div>
          <div class="profile-boards">
            ${allBoards
              .map((b) => {
                const active = (profile.boardIds || []).includes(b.id);
                return `<div class="profile-board-chip ${active ? "active" : ""}" 
                data-profile-board-toggle="${escapeAttr(profile.id)}" 
                data-board-ref="${escapeAttr(b.id)}">
                ${escapeHtml(b.customName || b.name)}
              </div>`;
              })
              .join("")}
          </div>
          <div class="profile-section-label">Custom tags</div>
          <div class="profile-tags-wrap" id="ptags-${escapeAttr(profile.id)}">
            ${(profile.manualTags || [])
              .map(
                (tag) =>
                  `<div class="profile-tag">${escapeHtml(tag)}<span class="ptx" data-profile-remove-tag="${escapeAttr(profile.id)}" data-tag="${escapeAttr(tag)}">×</span></div>`,
              )
              .join("")}
          </div>
          <div class="profile-tag-input-row">
            <input class="add-tag-input" id="ptaginput-${escapeAttr(profile.id)}" placeholder="Add tag…" style="flex:1;">
            <button class="add-tag-btn" data-profile-add-tag="${escapeAttr(profile.id)}">+ Tag</button>
          </div>
          ${renderSimilaritySection(profile)}
          <div class="profile-actions">
            <button class="profile-gen-btn" data-profile-gen="${escapeAttr(profile.id)}">✨ Generate Gifts</button>
            <button class="profile-del-btn" data-profile-del="${escapeAttr(profile.id)}">Delete</button>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

async function createProfile() {
  const name = $("newProfileName").value.trim();
  if (!name) return;
  const resp = await sendMessage({
    action: "CREATE_TASTE_PROFILE",
    name,
    boardIds: allBoards.filter((b) => b.enabled !== false).map((b) => b.id),
    manualTags: [],
  });
  if (resp?.status === "ok") {
    $("newProfileName").value = "";
    allProfiles.push(resp.profile);
    // Update counter immediately from local array
    $("profileCountVal").textContent = allProfiles.length;
    populateProfileSelectors();
    renderProfilesPanel();
    showToast(`Profile "${name}" created`, "success");
  }
}

// ── Saved Gifts ───────────────────────────────────────────────────────────────

async function renderSavedGifts() {
  const resp = await sendMessage({ action: "GET_SAVED_GIFTS" });
  const gifts = resp?.gifts || [];
  savedGiftIds = new Set(gifts.map((g) => g.id));
  const profileFilter = $("giftsProfileFilter").value;
  const filtered = profileFilter
    ? gifts.filter((g) => g.tasteProfileId === profileFilter)
    : gifts;

  $("savedGiftsSub").textContent =
    `${filtered.length} idea${filtered.length !== 1 ? "s" : ""}${profileFilter ? " in profile" : " total"}`;

  const container = $("savedGiftsList");
  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎁</div>
      <div class="empty-title">No saved gifts yet</div>
      <div class="empty-desc">Generate ideas and click ☆ Save to collect them here.</div></div>`;
    return;
  }

  const profileMap = {};
  allProfiles.forEach((p) => {
    profileMap[p.id] = p.name;
  });

  container.innerHTML = filtered
    .map(
      (gift) => `
    <div class="saved-gift-card" id="sg-${escapeAttr(gift.id)}">
      <div class="saved-gift-header">
        <div class="saved-gift-name">${escapeHtml(gift.name)}</div>
        <button class="saved-gift-del" data-delete-gift="${escapeAttr(gift.id)}">×</button>
      </div>
      ${gift.tasteProfileId ? `<div class="saved-gift-profile">✦ ${escapeHtml(profileMap[gift.tasteProfileId] || "Profile")}</div>` : ""}
      <div class="saved-gift-price">${escapeHtml(gift.price_range || "")}</div>
      <div class="saved-gift-desc">${escapeHtml(gift.description || "")}</div>
      <div class="gift-links">
        <a class="shop-link" href="${gift.amazonUrl}" target="_blank">🛒 Amazon</a>
        ${gift.etsyUrl ? `<a class="shop-link" href="${gift.etsyUrl}" target="_blank">🧵 Etsy</a>` : ""}
        <a class="shop-link" href="${gift.googleUrl}" target="_blank">🔍 Shop</a>
      </div>
    </div>`,
    )
    .join("");
}

async function saveGift(giftData, tasteProfileId) {
  const resp = await sendMessage({
    action: "SAVE_GIFT_IDEA",
    gift: { ...giftData, tasteProfileId: tasteProfileId || null },
  });
  if (resp?.status === "ok") {
    savedGiftIds.add(resp.gift.id);
    return resp.gift;
  }
}

function exportGifts() {
  sendMessage({ action: "GET_SAVED_GIFTS" }).then((resp) => {
    const gifts = resp?.gifts || [];
    const profileFilter = $("giftsProfileFilter").value;
    const filtered = profileFilter
      ? gifts.filter((g) => g.tasteProfileId === profileFilter)
      : gifts;
    const profileMap = {};
    allProfiles.forEach((p) => {
      profileMap[p.id] = p.name;
    });

    // Export as Markdown + CSV
    let md = `# PinSieve Gift Ideas\nExported: ${new Date().toLocaleDateString()}\n\n`;
    let csv =
      "Name,Price,Description,Match Reason,Amazon,Etsy,Google Shopping,Profile\n";
    for (const g of filtered) {
      const profileName = g.tasteProfileId
        ? profileMap[g.tasteProfileId] || ""
        : "All";
      md += `## ${g.name}\n**Price:** ${g.price_range || "—"}\n**Profile:** ${profileName}\n\n${g.description || ""}\n\n`;
      md += `- [Amazon](${g.amazonUrl})\n${g.etsyUrl ? `- [Etsy](${g.etsyUrl})\n` : ""}- [Google Shopping](${g.googleUrl})\n\n---\n\n`;
      csv += `"${(g.name || "").replace(/"/g, '""')}","${(g.price_range || "").replace(/"/g, '""')}","${(g.description || "").replace(/"/g, '""')}","${(g.match_reason || "").replace(/"/g, '""')}","${g.amazonUrl || ""}","${g.etsyUrl || ""}","${g.googleUrl || ""}","${profileName}"\n`;
    }

    downloadFile("pinsieve-gifts.md", md, "text/markdown");
    setTimeout(() => downloadFile("pinsieve-gifts.csv", csv, "text/csv"), 500);
    showToast("Exported Markdown + CSV!", "success");
  });
}

// ── Core Actions ──────────────────────────────────────────────────────────────

async function generateGifts() {
  if (isGenerating) return;
  const stats = await sendMessage({ action: "GET_STATS" });
  if (!stats?.hasGraph) {
    clearResults();
    showEmptyState(stats);
    return;
  }

  const tasteProfileId = $("profileSelector").value || null;
  const profile = tasteProfileId
    ? allProfiles.find((p) => p.id === tasteProfileId)
    : null;
  const profileLabel = profile?.name || null;

  // Determine boardIds: if profile selected, use its boards; else use chip selection
  let boardIds = selectedBoardIds;
  if (tasteProfileId && profile) {
    boardIds = profile.boardIds || selectedBoardIds;
  }

  // Store generation state for persistence across popup close/reopen
  const generationState = {
    inProgress: true,
    tasteProfileId,
    profileLabel,
    occasion: $("occasion").value,
    budget: $("budget").value,
    recipientAge: $("age").value,
    boardIds,
    startedAt: Date.now(),
  };
  chrome.storage.local.set({ generatingGifts: generationState });

  // Lock UI during generation
  isGenerating = true;
  $("generateBtn").disabled = true;
  $("profileSelector").disabled = true;
  renderBoardChips(tasteProfileId, true);

  // Show loading inside results area, hide filters
  enterResultsMode(0, profileLabel);
  showLoading("Curating personalized gifts…", "Analyzing your taste profile…");

  // Send request without awaiting full response — let it run in background
  sendMessage({
    action: "GENERATE_GIFTS",
    occasion: $("occasion").value,
    budget: $("budget").value,
    recipientAge: $("age").value,
    boardIds,
    tasteProfileId,
  })
    .then((resp) => {
      // Only process if we're still on this popup (hasn't closed since request started)
      if (!isGenerating) return;

      // Unlock UI
      isGenerating = false;
      $("generateBtn").disabled = false;
      $("profileSelector").disabled = false;
      renderBoardChips(tasteProfileId, false);

      if (resp?.status === "error") {
        showError(resp.error);
        chrome.storage.local.remove("generatingGifts");
        return;
      }
      if (resp?.ideas) {
        renderGifts(resp.ideas, tasteProfileId, profileLabel);
        chrome.storage.local.remove("generatingGifts");
      }
    })
    .catch((err) => {
      console.error("Gift generation error:", err);
      isGenerating = false;
      $("generateBtn").disabled = false;
      $("profileSelector").disabled = false;
      renderBoardChips(tasteProfileId, false);
      chrome.storage.local.remove("generatingGifts");

      // Handle rate limit specifically
      if (err.rateLimited && err.resetTime) {
        showRateLimitToast(err.resetTime);
        // Store rate limit info for recovery on popup reopen
        chrome.storage.local.set({
          rateLimitedAt: Date.now(),
          rateLimitResetTime: err.resetTime,
        });
      } else {
        showError("Generation failed: " + err.message);
      }
    });
}

async function rebuildGraph() {
  showLoading("Building taste profile…", "Analyzing your saved pins…");
  try {
    const resp = await sendMessage({ action: "REBUILD_GRAPH" });
    if (resp?.status === "error") {
      showError(resp.error);
      return;
    }
    await refreshStats();
    await loadBoards();
    showToast(`Profile built from ${resp.pinCount} pins!`, "success");
    await generateGifts();
  } catch (err) {
    if (err.rateLimited && err.resetTime) {
      showRateLimitToast(err.resetTime);
      chrome.storage.local.set({
        rateLimitedAt: Date.now(),
        rateLimitResetTime: err.resetTime,
      });
    } else {
      showError("Profile build failed: " + err.message);
    }
  }
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportData() {
  const resp = await sendMessage({ action: "EXPORT_DATA" });
  if (resp?.status !== "ok") {
    showToast("Export failed", "error");
    return;
  }
  const json = JSON.stringify(resp.data, null, 2);
  downloadFile("pinsieve-export.json", json, "application/json");

  // Obsidian vault zip
  const vault = resp.data.obsidianVault || {};
  let obsidianMd = "";
  for (const [path, content] of Object.entries(vault)) {
    obsidianMd += `\n\n<!-- FILE: ${path} -->\n${content}`;
  }
  if (obsidianMd)
    downloadFile("pinsieve-vault.md", obsidianMd.trim(), "text/markdown");
  showToast("Data exported!", "success");
}

// ── Delegated Click Handler ───────────────────────────────────────────────────

function handleDelegatedClicks(e) {
  // Board expand
  const expandId = e.target.closest("[data-expand-id]")?.dataset.expandId;
  if (expandId) {
    const body = $(`body-${expandId}`);
    if (body) {
      body.classList.toggle("open");
      const btn = document.querySelector(
        `[data-expand-id="${expandId}"].board-expand-btn`,
      );
      if (btn) btn.textContent = body.classList.contains("open") ? "▴" : "▾";
    }
    return;
  }
  // Board toggle (enable/disable)
  const toggleId = e.target.dataset.toggleId;
  if (toggleId) {
    toggleBoard(toggleId);
    return;
  }
  // Board rename
  const renameId = e.target.dataset.renameId;
  if (renameId) {
    const input = $(`rename-${renameId}`);
    if (input) renameBoard(renameId, input.value.trim());
    return;
  }
  // Board delete
  const deleteId = e.target.dataset.deleteId;
  if (deleteId) {
    if (confirm("Remove this board and its pins?")) deleteBoard(deleteId);
    return;
  }

  // Board retry analysis
  const retryId = e.target.dataset.retryId;
  if (retryId) {
    // Immediately clear the error and show analyzing state
    const board = allBoards.find((b) => b.id === retryId);
    if (board) {
      delete board.analysisError;
      delete board.analysisErrorAt;
      board.isAnalyzing = true; // Show analyzing state
      renderBoardsList();
    }
    sendMessage({ action: "RETRY_BOARD_ANALYSIS", boardId: retryId })
      .then((resp) => {
        if (resp?.status === "ok") {
          showToast("Analysis complete!", "success");
          loadBoards().then(() => {
            // Clear error from local copy after successful analysis
            const b = allBoards.find((board) => board.id === retryId);
            if (b) delete b.analysisError;
            if (activePanel === "boards") renderBoardsList();
          });
          loadGraphTags(); // Refresh graph tags on home panel
        } else {
          showToast(
            "Retry failed: " + (resp?.error || "Unknown error"),
            "error",
          );
          loadBoards().then(() => {
            if (activePanel === "boards") renderBoardsList();
          });
        }
      })
      .catch((err) => {
        if (err.rateLimited && err.resetTime) {
          showRateLimitToast(err.resetTime);
          chrome.storage.local.set({
            rateLimitedAt: Date.now(),
            rateLimitResetTime: err.resetTime,
          });
        } else {
          showToast("Retry failed: " + err.message, "error");
        }
        loadBoards().then(() => {
          if (activePanel === "boards") renderBoardsList();
        });
      });
    return;
  }

  // Analyze All Boards button (check this BEFORE single board analysis)
  if (e.target.id === "analyzeAllBtn") {
    e.target.disabled = true;
    e.target.textContent = "⏳ Analyzing all boards…";
    // Mark all non-analyzed boards as analyzing and clear errors
    allBoards.forEach((b) => {
      if (!b.analyzedAt) {
        delete b.analysisError; // Clear any previous errors
        b.isAnalyzing = true;
      }
    });
    renderBoardsList();
    sendMessage({ action: "ANALYZE_ALL_BOARDS" })
      .then((resp) => {
        if (resp?.status === "ok") {
          showToast("All boards analyzed!", "success");
          loadBoards().then(() => {
            // Clear errors from local copies after successful analysis
            allBoards.forEach((b) => {
              if (b.analyzedAt) delete b.analysisError;
            });
            if (activePanel === "boards") renderBoardsList();
          });
          loadGraphTags(); // Refresh graph tags on home panel
        } else {
          showToast(
            "Analysis failed: " + (resp?.error || "Unknown error"),
            "error",
          );
          loadBoards().then(() => {
            if (activePanel === "boards") renderBoardsList();
          });
        }
        e.target.disabled = false;
        e.target.textContent = "Analyze All Boards";
      })
      .catch((err) => {
        e.target.disabled = false;
        e.target.textContent = "Analyze All Boards";
        if (err.rateLimited && err.resetTime) {
          showRateLimitToast(err.resetTime);
          chrome.storage.local.set({
            rateLimitedAt: Date.now(),
            rateLimitResetTime: err.resetTime,
          });
        } else {
          showToast("Analysis failed: " + err.message, "error");
        }
        loadBoards().then(() => {
          if (activePanel === "boards") renderBoardsList();
        });
      });
    return;
  }

  // Board analysis (from "Analyze this board" button)
  const analyzeId = e.target.dataset.analyzeId;
  if (analyzeId) {
    const board = allBoards.find((b) => b.id === analyzeId);
    if (board) {
      delete board.analysisError; // Clear any previous error
      board.isAnalyzing = true; // Show analyzing state
      renderBoardsList();
    }
    sendMessage({ action: "ANALYZE_BOARD", boardId: analyzeId })
      .then((resp) => {
        if (resp?.status === "ok") {
          showToast("Board analyzed!", "success");
          loadBoards().then(() => {
            // Clear error from local copy after successful analysis
            const b = allBoards.find((board) => board.id === analyzeId);
            if (b) delete b.analysisError;
            if (activePanel === "boards") renderBoardsList();
          });
          loadGraphTags(); // Refresh graph tags on home panel
        } else {
          showToast(
            "Analysis failed: " + (resp?.error || "Unknown error"),
            "error",
          );
          loadBoards().then(() => {
            if (activePanel === "boards") renderBoardsList();
          });
        }
      })
      .catch((err) => {
        if (err.rateLimited && err.resetTime) {
          showRateLimitToast(err.resetTime);
          chrome.storage.local.set({
            rateLimitedAt: Date.now(),
            rateLimitResetTime: err.resetTime,
          });
        } else {
          showToast("Analysis failed: " + err.message, "error");
        }
        loadBoards().then(() => {
          if (activePanel === "boards") renderBoardsList();
        });
      });
    return;
  }

  if (e.target.closest("#rebuildBtn")) {
    btn.addEventListener("click", () => {
      showPanel("boards");
    });
    return;
  }
  if (e.target.closest("#regenerateBtn")) {
    generateGifts();
    return;
  }

  // Profile expand (only trigger on header, not on buttons)
  const expandProfile = e.target.closest("[data-expand-profile]")?.dataset
    .expandProfile;
  if (expandProfile) {
    // Don't expand if clicking on action buttons
    if (
      e.target.closest("[data-profile-gen]") ||
      e.target.closest("[data-profile-del]") ||
      e.target.closest("[data-profile-add-tag]") ||
      e.target.closest("[data-profile-board-toggle]") ||
      e.target.closest(".ptx")
    ) {
      return;
    }
    const body = $(`pbody-${expandProfile}`);
    if (body) body.classList.toggle("open");
    return;
  }

  // Profile board toggle
  const profileBoardEl = e.target.closest("[data-profile-board-toggle]");
  if (profileBoardEl) {
    const profileId = profileBoardEl.dataset.profileBoardToggle;
    const boardId = profileBoardEl.dataset.boardRef;
    const profile = allProfiles.find((p) => p.id === profileId);
    if (profile) {
      const idx = (profile.boardIds || []).indexOf(boardId);
      if (idx === -1) profile.boardIds = [...(profile.boardIds || []), boardId];
      else profile.boardIds.splice(idx, 1);
      sendMessage({
        action: "UPDATE_TASTE_PROFILE",
        id: profileId,
        updates: { boardIds: profile.boardIds },
      });
      profileBoardEl.classList.toggle("active", idx === -1);
    }
    return;
  }

  // Profile add tag
  const profileAddTag = e.target.dataset.profileAddTag;
  if (profileAddTag) {
    const input = $(`ptaginput-${profileAddTag}`);
    const tag = input?.value.trim();
    if (!tag) return;
    const profile = allProfiles.find((p) => p.id === profileAddTag);
    if (profile) {
      profile.manualTags = [...(profile.manualTags || []), tag];
      sendMessage({
        action: "UPDATE_TASTE_PROFILE",
        id: profileAddTag,
        updates: { manualTags: profile.manualTags },
      });
      input.value = "";
      const tagsWrap = $(`ptags-${profileAddTag}`);
      if (tagsWrap) {
        tagsWrap.innerHTML += `<div class="profile-tag">${escapeHtml(tag)}<span class="ptx" data-profile-remove-tag="${escapeAttr(profileAddTag)}" data-tag="${escapeAttr(tag)}">×</span></div>`;
      }
    }
    return;
  }

  // Profile remove tag
  const profileRemoveTag = e.target.dataset.profileRemoveTag;
  if (profileRemoveTag) {
    const tag = e.target.dataset.tag;
    const profile = allProfiles.find((p) => p.id === profileRemoveTag);
    if (profile && tag) {
      profile.manualTags = (profile.manualTags || []).filter((t) => t !== tag);
      sendMessage({
        action: "UPDATE_TASTE_PROFILE",
        id: profileRemoveTag,
        updates: { manualTags: profile.manualTags },
      });
      e.target.parentElement.remove();
    }
    return;
  }

  // Profile generate gifts
  const profileGen = e.target.dataset.profileGen;
  if (profileGen) {
    showPanel("home");
    const sel = $("profileSelector");
    sel.value = profileGen;
    // Trigger change to update board chips and tags
    sel.dispatchEvent(new Event("change"));
    generateGifts();
    return;
  }

  // Profile delete
  const profileDel = e.target.dataset.profileDel;
  if (profileDel) {
    if (!confirm("Delete this taste profile?")) return;
    sendMessage({ action: "DELETE_TASTE_PROFILE", id: profileDel }).then(() => {
      allProfiles = allProfiles.filter((p) => p.id !== profileDel);
      $("profileCountVal").textContent = allProfiles.length;
      populateProfileSelectors();
      renderProfilesPanel();
      showToast("Profile deleted");
    });
    return;
  }

  // Delete saved gift
  const deleteGift = e.target.dataset.deleteGift;
  if (deleteGift) {
    sendMessage({ action: "DELETE_GIFT_IDEA", giftId: deleteGift }).then(() => {
      $(`sg-${deleteGift}`)?.remove();
      savedGiftIds.delete(deleteGift);
      showToast("Gift removed");
    });
    return;
  }
}

// ── Board Actions ─────────────────────────────────────────────────────────────

async function toggleBoard(boardId) {
  const board = allBoards.find((b) => b.id === boardId);
  if (!board) return;
  const newState = board.enabled === false ? true : false;
  const resp = await sendMessage({
    action: "TOGGLE_BOARD",
    boardId,
    enabled: newState,
  });
  if (resp?.status === "ok") {
    board.enabled = newState;
    if (!newState && selectedBoardIds)
      selectedBoardIds = selectedBoardIds.filter((id) => id !== boardId);
    else if (
      newState &&
      selectedBoardIds &&
      !selectedBoardIds.includes(boardId)
    )
      selectedBoardIds = [...selectedBoardIds, boardId];
    const currentProfileId = $("profileSelector").value || null;
    renderBoardChips(currentProfileId);
    renderBoardsList();
    showToast(`Board ${newState ? "enabled" : "disabled"}`);
  }
}

async function renameBoard(boardId, newName) {
  if (!newName) {
    showToast("Enter a name", "error");
    return;
  }
  const resp = await sendMessage({
    action: "RENAME_BOARD",
    boardId,
    name: newName,
  });
  if (resp?.status === "ok") {
    const board = allBoards.find((b) => b.id === boardId);
    if (board) board.customName = newName;
    const currentProfileId = $("profileSelector").value || null;
    renderBoardChips(currentProfileId);
    renderBoardsList();
    showToast("Board renamed!", "success");
  }
}

async function deleteBoard(boardId) {
  const resp = await sendMessage({ action: "DELETE_BOARD", boardId });
  if (resp?.status === "ok") {
    allBoards = allBoards.filter((b) => b.id !== boardId);
    if (selectedBoardIds)
      selectedBoardIds = selectedBoardIds.filter((id) => id !== boardId);
    const boardPinSum = allBoards.reduce((s, b) => s + (b.pinCount || 0), 0);
    $("pinCountVal").textContent = boardPinSum;
    $("boardCountVal").textContent = allBoards.length;
    const currentProfileId = $("profileSelector").value || null;
    renderBoardChips(currentProfileId);
    renderBoardsList();
    showToast("Board removed");
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function showLoading(text, sub) {
  $("resultsArea").innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <div class="loading-text">${escapeHtml(text || "Loading…")}</div>
      ${sub ? `<div class="loading-sub">${escapeHtml(sub)}</div>` : ""}
    </div>`;
}

function showEmptyState(stats) {
  // Empty state always exits results mode and shows filters
  resultsMode = false;
  $("filtersSection").classList.remove("hidden");
  $("resultsClearBar").style.display = "none";
  if (stats?.pinCount > 0 && !stats?.hasGraph) {
    $("resultsArea").innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚡</div>
        <div class="empty-title">${stats.pinCount} pins saved — build profile</div>
        <div class="empty-desc" style="line-height:1.6">Pins were scanned but the taste profile hasn't been built yet.</div>
      </div>`;
    return;
  }
  $("resultsArea").innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">🌿</div>
      <div class="empty-title">No taste profile yet</div>
      <div class="empty-desc">Visit a Pinterest board to get started</div>
      <div style="margin-top:12px; text-align:left; display:inline-block">
        <div class="step"><div class="step-num">1</div><span>Open any Pinterest board</span></div>
        <div class="step"><div class="step-num">2</div><span>Click "Scan Now" in the popup</span></div>
        <div class="step"><div class="step-num">3</div><span>Generate gift ideas below</span></div>
      </div>
    </div>`;
}

function showError(msg) {
  // Keep results mode active but show error in results area
  $("resultsArea").innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">⚠️</div>
      <div class="empty-title">Something went wrong</div>
      <div class="empty-desc" style="color:var(--coral)">${escapeHtml(msg)}</div>
    </div>`;
}

function enterResultsMode(count, profileLabel) {
  resultsMode = true;
  $("filtersSection").classList.add("hidden");
  $("resultsClearBar").style.display = "flex";
  $("resultsClearLabel").textContent =
    `${count} gift idea${count !== 1 ? "s" : ""}${profileLabel ? ` · ${profileLabel}` : ""}`;
}

function clearResults() {
  resultsMode = false;
  $("filtersSection").classList.remove("hidden");
  $("resultsClearBar").style.display = "none";
  $("resultsArea").innerHTML = "";
  // Clear persistence
  try {
    chrome.storage.local.remove("persistedIdeas");
  } catch (e) {}
  // Scroll back to top
  const scroll = $("homeScroll");
  if (scroll) scroll.scrollTop = 0;
}

async function restorePersistedIdeas() {
  try {
    const data = await new Promise((res) =>
      chrome.storage.local.get("persistedIdeas", res),
    );
    if (!data?.persistedIdeas) return;
    const { ideas, tasteProfileId, profileLabel } = data.persistedIdeas;
    if (!ideas?.length) return;
    renderGifts(ideas, tasteProfileId, profileLabel, false); // false = don't re-persist
  } catch (e) {
    /* storage not available or no data */
  }
}

async function restoreGenerationState() {
  return new Promise((resolve) => {
    chrome.storage.local.get("generatingGifts", (data) => {
      if (!data.generatingGifts) {
        resolve();
        return;
      }

      const state = data.generatingGifts;
      const elapsed = Date.now() - state.startedAt;
      // If generation started more than 5 minutes ago, assume it failed and clear
      if (elapsed > 5 * 60 * 1000) {
        chrome.storage.local.remove("generatingGifts");
        resolve();
        return;
      }

      // Restore UI to show generation is in progress
      isGenerating = true;
      $("generateBtn").disabled = true;
      $("profileSelector").disabled = true;
      renderBoardChips(state.tasteProfileId, true);
      enterResultsMode(0, state.profileLabel);
      showLoading(
        "Curating personalized gifts…",
        "Still analyzing your taste profile…",
      );

      // Poll for results
      const pollInterval = setInterval(() => {
        chrome.storage.local.get("generatingGifts", (data) => {
          if (!data.generatingGifts) {
            // Generation completed, check for results
            clearInterval(pollInterval);
            const resultKey = `giftResults_${state.tasteProfileId || "master"}`;
            chrome.storage.local.get(resultKey, (resultData) => {
              if (resultData[resultKey]) {
                const ideas = resultData[resultKey];
                isGenerating = false;
                $("generateBtn").disabled = false;
                $("profileSelector").disabled = false;
                renderBoardChips(state.tasteProfileId, false);
                renderGifts(ideas, state.tasteProfileId, state.profileLabel);
                chrome.storage.local.remove(resultKey);
              }
            });
          }
        });
      }, 1000); // Poll every second

      resolve();
    });
  });
}

function renderGifts(ideas, tasteProfileId, profileLabel, persist = true) {
  // Persist ideas for reopening
  if (persist) {
    try {
      chrome.storage.local.set({
        persistedIdeas: {
          ideas,
          tasteProfileId,
          profileLabel: profileLabel || null,
        },
      });
    } catch (e) {}
  }

  enterResultsMode(ideas.length, profileLabel);

  const cards = ideas
    .map((idea) => {
      const isAlreadySaved = savedGiftIds.has(idea.id);
      return `
    <div class="gift-card">
      <div class="gift-header">
        <div class="gift-name">${escapeHtml(idea.name)}</div>
        <div class="gift-price">${escapeHtml(idea.price_range || "")}</div>
      </div>
      <div class="gift-tag">${escapeHtml(idea.category || "")}</div>
      ${idea.match_reason ? `<div class="gift-match">↳ ${escapeHtml(idea.match_reason)}</div>` : ""}
      <div class="gift-desc">${escapeHtml(idea.description)}</div>
      <div class="gift-links">
        <a class="shop-link" href="${idea.amazonUrl}" target="_blank">🛒 Amazon</a>
        ${idea.etsyUrl ? `<a class="shop-link" href="${idea.etsyUrl}" target="_blank">🧵 Etsy</a>` : ""}
        <a class="shop-link" href="${idea.googleUrl}" target="_blank">🔍 Shop</a>
        <button class="gift-save-btn ${isAlreadySaved ? "saved" : ""}"
          data-gift-idx="${escapeAttr(idea.id)}"
          ${isAlreadySaved ? "disabled" : ""}>
          ${isAlreadySaved ? "✓ Saved" : "☆ Save"}
        </button>
      </div>
    </div>`;
    })
    .join("");

  $("resultsArea").innerHTML = `
    <div class="results-header">
      <span>${ideas.length} ideas</span>
      <button id="regenerateBtn">↻ Regenerate</button>
    </div>
    <div class="gifts-list">${cards}</div>`;

  // Scroll to top of results (filtersSection hidden, so resultsArea is now at top of scroll)
  const scroll = $("homeScroll");
  if (scroll) scroll.scrollTop = 0;

  // Bind save buttons
  $("resultsArea")
    .querySelectorAll(".gift-save-btn")
    .forEach((btn, idx) => {
      if (btn.disabled) return;
      btn.addEventListener("click", async () => {
        const idea = ideas[idx];
        const saved = await saveGift(idea, tasteProfileId);
        if (saved) {
          btn.textContent = "✓ Saved";
          btn.classList.add("saved");
          btn.disabled = true;
          showToast("Gift saved!", "success");
          // Update persisted copy to reflect saved state
          try {
            const data = await new Promise((res) =>
              chrome.storage.local.get("persistedIdeas", res),
            );
            if (data?.persistedIdeas)
              chrome.storage.local.set({ persistedIdeas: data.persistedIdeas });
          } catch (e) {}
        }
      });
    });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function sendMessage(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError.message);
          resolve(null);
        } else resolve(resp);
      });
    } catch (e) {
      console.error(e);
      resolve(null);
    }
  });
}

function showToast(msg, type) {
  const t = $("toast");
  // Don't overwrite persistent rate limit toast
  if (t.classList.contains("warning") && rateLimitToastInterval) {
    return;
  }
  t.textContent = msg;
  t.className = `toast visible ${type || ""}`;
  setTimeout(() => {
    t.className = "toast";
  }, 3000);
}

// Persistent rate limit toast with countdown
let rateLimitToastInterval = null;

function showRateLimitToast(resetTime) {
  const t = $("toast");

  // Clear existing timeout/interval
  if (rateLimitToastInterval) clearInterval(rateLimitToastInterval);

  const updateToast = () => {
    const now = Date.now();
    const remaining = Math.max(0, resetTime - now);

    if (remaining <= 0) {
      // Rate limit expired
      t.className = "toast";
      if (rateLimitToastInterval) clearInterval(rateLimitToastInterval);
      rateLimitToastInterval = null;
      showToast("Rate limit lifted! Try again.", "success");
      return;
    }

    // Calculate minutes and seconds
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

    t.textContent = `⏳ Rate limited. Requests reset in ${timeStr}. Set your own API key to avoid limits.`;
    t.className = "toast visible warning";
  };

  // Update immediately and then every second
  updateToast();
  rateLimitToastInterval = setInterval(updateToast, 1000);
}

// Check if API rate limit is still active on popup load
function checkForExistingRateLimit() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["rateLimitedAt", "rateLimitResetTime"],
      (data) => {
        if (data.rateLimitResetTime) {
          const now = Date.now();
          if (now < data.rateLimitResetTime) {
            // Rate limit still active, show countdown
            showRateLimitToast(data.rateLimitResetTime);
          } else {
            // Rate limit expired, clean up storage
            chrome.storage.local.remove([
              "rateLimitedAt",
              "rateLimitResetTime",
            ]);
          }
        }
        resolve();
      },
    );
  });
}

function timeAgo(ts) {
  const d = Date.now() - ts;
  if (d < 60000) return "now";
  if (d < 3600000) return `${Math.floor(d / 60000)}m`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h`;
  return `${Math.floor(d / 86400000)}d`;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  if (!str) return "";
  return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init().catch(console.error);
