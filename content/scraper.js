// content/scraper.js — v4.1
// Runs on Pinterest pages — extracts pin data and sends to background.
// Safe to inject multiple times: guards with a flag on window.

if (!window.__pinSieveInjected) {
  window.__pinSieveInjected = true;

  let isScanning = false;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'PING') {
      sendResponse({ status: 'alive' });
      return;
    }
    if (msg.action === 'SCAN_PAGE') {
      if (isScanning) { sendResponse({ status: 'already_scanning' }); return; }
      scanPins().then(pins => { sendResponse({ status: 'ok', count: pins.length }); });
      return true; // keep channel open for async response
    }
    if (msg.action === 'GET_BOARD_INFO') {
      sendResponse(getBoardInfo());
    }
  });

  function getBoardInfo() {
    const title = document.querySelector('h1')?.innerText?.trim()
      || document.title.replace(/\s*[\|·].*$/, '').trim()
      || 'Unknown Board';
    const url = window.location.href;
    const pathname = window.location.pathname.split('/').filter(Boolean);
    const username = pathname[0] || null;
    const boardSlug = pathname[1] || null;
    const isBoard = !url.includes('/pin/') && pathname.length >= 2;
    const boardNameWithUser = username && boardSlug ? `${username}/${title}` : title;
    return { title, username, boardSlug, boardNameWithUser, url, isBoard };
  }

  function extractPins() {
    const pins = [];
    const seen = new Set();
    const pinEls = document.querySelectorAll('[data-test-id="pin"], [data-grid-item], [data-test-id="pinWrapper"]');
    pinEls.forEach(el => {
      const img = el.querySelector('img');
      const link = el.querySelector('a[href*="/pin/"]');
      const titleEl = el.querySelector('[data-test-id="pin-title"], [aria-label]');
      if (!img) return;
      const pinId = link?.href?.match(/\/pin\/(\d+)/)?.[1] || null;
      if (pinId && seen.has(pinId)) return;
      if (pinId) seen.add(pinId);
      const pin = {
        id: pinId || Math.random().toString(36).slice(2),
        imageUrl: img.src || img.dataset.src || '',
        alt: img.alt || '',
        title: titleEl?.innerText?.trim() || img.alt || '',
        pinUrl: link?.href || '',
        scrapedAt: Date.now()
      };
      if (pin.imageUrl && !pin.imageUrl.startsWith('data:')) pins.push(pin);
    });
    return pins;
  }

  async function scanPins() {
    isScanning = true;
    try {
      await autoScroll(3);
      const pins = extractPins();
      const boardInfo = getBoardInfo();
      console.log('[PinSieve] Found ' + pins.length + ' pins on "' + boardInfo.title + '"');
      if (pins.length > 0) {
        chrome.runtime.sendMessage({
          action: 'PROCESS_PINS',
          pins: pins.slice(0, 100),
          board: boardInfo,
        });
      }
      return pins;
    } finally {
      isScanning = false;
    }
  }

  function autoScroll(times) {
    return new Promise(resolve => {
      let count = 0;
      const interval = setInterval(() => {
        window.scrollBy(0, window.innerHeight * 1.5);
        count++;
        if (count >= times) {
          clearInterval(interval);
          setTimeout(resolve, 1500);
        }
      }, 800);
    });
  }

  // Tell the background the script is ready — it will auto-scan if enabled
  chrome.runtime.sendMessage({ action: 'CONTENT_SCRIPT_READY', url: window.location.href });
}
