
# [`PinSieve`](https://pin-sieve.vercel.app/)

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat\&logo=javascript\&logoColor=black) ![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=flat\&logo=googlechrome\&logoColor=white) ![IndexedDB](https://img.shields.io/badge/IndexedDB-003B57?style=flat)

**AI-powered Chrome extension that analyzes Pinterest boards to generate highly personalized gift ideas.**

---

## Demo

<video src="https://github.com/user-attachments/assets/f680a465-8afb-4c89-a7a2-9dbc148b68f5" width="600" controls>
    Your browser does not support the video tag.
</video>

---

## Features

* Board scanning with auto or manual trigger
* Per-board and master taste graphs
* Named Taste Profiles with manual tag boosts
* Graph Explorer to combine tags and generate ideas
* Saved Gifts panel with Markdown and CSV export
* Local data storage using IndexedDB
* Adjustable generation settings and pin limits

---

## Tech Stack

* **Platform:** Chrome Extension, Manifest V3
* **AI:** ChatGPT o4-mini for pin analysis and gift generation
* **Storage:** IndexedDB for 'taste' knowledge graph
* **Memory:** chrome.storage.local for UI persistence
* **Architecture:** Background service worker, content scripts, popup UI
* **Language:** Vanilla JavaScript

---

## Local Setup

1. Clone the repository:

```bash
git clone https://github.com/maxtmiller/pinsieve-chrome-extension.git
cd pinsieve-chrome-extension
```

2. Load extension in Chrome
    1. Open `chrome://extensions`
    2. Enable Developer Mode
    3. Click **Load unpacked**
    4. Select the `pinsieve-chrome-extension` folder

4. Visit a Pinterest board and click **Generate Gift Ideas**


---

## Next Steps

* Integrate Amazon Product Advertising API for real product data
* Implement image vision analysis for deeper style extraction
* Add board-level weighting system
* Enable email sharing of gift lists
