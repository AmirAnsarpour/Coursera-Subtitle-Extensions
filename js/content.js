// ── Constants ──────────────────────────────────────────────────────────────

const CHUNK_SIZE  = 4500;
const CONCURRENCY = 2;

// ⟦n⟧ markers (Mathematical White Square Brackets) are preserved by all
// translation APIs and never appear in natural subtitle text.
const marker = (i) => `⟦${i}⟧`;

const LANG_NAMES = {
  fa: "Persian",   ar: "Arabic",       bg: "Bulgarian",  ca: "Catalan",
  "zh-CN": "Chinese (Simplified)",     "zh-TW": "Chinese (Traditional)",
  cs: "Czech",     da: "Danish",        nl: "Dutch",      en: "English",
  fi: "Finnish",   fr: "French",        de: "German",     el: "Greek",
  hi: "Hindi",     hu: "Hungarian",     id: "Indonesian", it: "Italian",
  ja: "Japanese",  ko: "Korean",        no: "Norwegian",  pl: "Polish",
  pt: "Portuguese", ro: "Romanian",     ru: "Russian",    es: "Spanish",
  sv: "Swedish",   th: "Thai",          tr: "Turkish",    uk: "Ukrainian",
  vi: "Vietnamese",
};

// ── Module state ───────────────────────────────────────────────────────────

let originalCues      = null;
let isTranslating     = false;
let autoTranslate     = false;
let navigationTimeout = null;
let lastUrl           = location.href;
let lastTitle         = document.title;

// ── SPA navigation detection ───────────────────────────────────────────────
// Primary: Navigation API. Fallback: MutationObserver on <title>.
// Neither approach monkey-patches browser globals.

function handleNavigation() {
  originalCues  = null;
  isTranslating = false;
  if (navigationTimeout !== null) { clearTimeout(navigationTimeout); navigationTimeout = null; }
  chrome.runtime.sendMessage({ method: "badge", text: "" });
  chrome.storage.local.remove("translationState");
  if (!autoTranslate) return;
  navigationTimeout = setTimeout(() => {
    navigationTimeout = null;
    chrome.storage.sync.get(["lang", "bilingual"], (s) => {
      if (s.lang) openBilingual(s.bilingual || false);
    });
  }, 3000);
}

const _nav = window.navigation;
if (_nav) {
  _nav.addEventListener("navigate", (e) => {
    if (e.destination.url !== lastUrl) { lastUrl = e.destination.url; handleNavigation(); }
  });
} else {
  const titleEl = document.querySelector("title");
  if (titleEl) {
    new MutationObserver(() => {
      if (document.title !== lastTitle) {
        lastTitle = document.title;
        if (location.href !== lastUrl) { lastUrl = location.href; handleNavigation(); }
      }
    }).observe(titleEl, { childList: true });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function waitForCues(track) {
  return new Promise((resolve) => {
    if (track.cues && track.cues.length > 0) { resolve(); return; }
    const deadline = Date.now() + 8000;
    const id = setInterval(() => {
      if ((track.cues && track.cues.length > 0) || Date.now() >= deadline) {
        clearInterval(id);
        resolve();
      }
    }, 100);
  });
}

// ── Toast (success | error) ────────────────────────────────────────────────

function showToast(message, type = "success") {
  document.getElementById("cse-toast")?.remove();
  const toast = document.createElement("div");
  toast.id = "cse-toast";
  Object.assign(toast.style, {
    position:       "fixed",
    bottom:         "90px",
    left:           "50%",
    transform:      "translateX(-50%)",
    background:     type === "error" ? "rgba(160,30,30,0.88)" : "rgba(0,0,0,0.76)",
    backdropFilter: "blur(12px)",
    color:          "#fff",
    padding:        "10px 20px",
    borderRadius:   "20px",
    fontSize:       "14px",
    fontFamily:     "-apple-system, system-ui, sans-serif",
    zIndex:         "2147483647",
    pointerEvents:  "none",
    opacity:        "1",
    transition:     "opacity 0.4s ease",
    whiteSpace:     "nowrap",
  });
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 400); }, 3000);
}

// ── Translation ────────────────────────────────────────────────────────────

async function fetchTranslation(text, lang) {
  const url =
    `https://translate.googleapis.com/translate_a/single` +
    `?client=gtx&sl=en&tl=${lang}&dt=t&q=${encodeURIComponent(text)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = await r.json();
  return json[0].map((item) => item[0]).join("");
}

async function fetchWithRetry(text, lang, maxRetries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try { return await fetchTranslation(text, lang); }
    catch (err) {
      lastErr = err;
      if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr;
}

// Translate up to CONCURRENCY chunks in parallel, preserving order.
async function translateChunks(chunks, lang) {
  const results = new Array(chunks.length);
  let nextIndex = 0;
  let completed = 0;
  chrome.storage.local.set({ translationProgress: { done: 0, total: chunks.length } });

  async function worker() {
    while (nextIndex < chunks.length) {
      const i = nextIndex++;
      results[i] = await fetchWithRetry(chunks[i], lang);
      chrome.storage.local.set({ translationProgress: { done: ++completed, total: chunks.length } });
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
  return results;
}

// ── Core translation ────────────────────────────────────────────────────────

async function openBilingual(bilingual) {
  if (isTranslating) return "busy";
  isTranslating = true;

  try {
    const video = document.querySelector("video");
    if (!video) { showToast("No video found on this page.", "error"); return "error"; }

    const enTrack = Array.from(video.textTracks).find(
      (t) => t.language === "en" || t.label.toLowerCase().includes("english"),
    );
    if (!enTrack) {
      showToast("English subtitle track not found — enable English subs first.", "error");
      return "error";
    }

    enTrack.mode = "showing";
    await waitForCues(enTrack);

    const cues = enTrack.cues;
    if (!cues || cues.length === 0) {
      showToast("Subtitles not loaded yet — play the video for a moment first.", "error");
      return "error";
    }

    if (!originalCues) originalCues = Array.from(cues).map((c) => c.text);

    return await new Promise((resolve) => {
      chrome.storage.sync.get(["lang"], async (s) => {
        const targetLang = s.lang || "fa";
        const cacheKey   = `${location.href}|${targetLang}|${bilingual}`;

        try {
          // ── Cache hit ──────────────────────────────────────────────────
          const store = await new Promise((res) =>
            chrome.storage.local.get(["translationCache"], (r) => res(r.translationCache || {}))
          );
          const cached = store[cacheKey];
          if (cached && Date.now() - cached.ts < 7 * 864e5) {
            for (let i = 0; i < cues.length; i++) {
              if (cached.cues[i] !== undefined) cues[i].text = cached.cues[i];
            }
            finishTranslation(targetLang);
            resolve("done");
            return;
          }

          // ── Build chunks ───────────────────────────────────────────────
          const segments = originalCues.map((text, i) => text.replace(/\n/g, " ") + ` ${marker(i)} `);
          const chunks = [];
          let current = "";
          for (const seg of segments) {
            if (current.length > 0 && current.length + seg.length > CHUNK_SIZE) {
              chunks.push(current);
              current = "";
            }
            current += seg;
          }
          if (current) chunks.push(current);

          // ── Translate ──────────────────────────────────────────────────
          const translated = (await translateChunks(chunks, targetLang)).join("");

          // ── Apply to cues ──────────────────────────────────────────────
          const finalCues = [];
          for (let i = 0; i < cues.length; i++) {
            const sm = marker(i);
            const em = marker(i + 1);
            const si = translated.indexOf(sm);
            const ei = translated.indexOf(em);
            if (si !== -1) {
              const raw = (ei !== -1
                ? translated.substring(si + sm.length, ei)
                : translated.substring(si + sm.length)).trim();
              cues[i].text = bilingual ? raw + "\n" + originalCues[i] : raw;
            }
            finalCues.push(cues[i].text);
          }

          // ── Save to cache (cap at 100 entries) ─────────────────────────
          const newStore = { ...store, [cacheKey]: { cues: finalCues, ts: Date.now() } };
          const keys = Object.keys(newStore);
          if (keys.length > 100) delete newStore[keys.sort((a, b) => newStore[a].ts - newStore[b].ts)[0]];
          chrome.storage.local.set({ translationCache: newStore });

          chrome.storage.local.remove("translationProgress");
          finishTranslation(targetLang);
          resolve("done");
        } catch (err) {
          console.error("Translation failed", err);
          chrome.storage.local.remove("translationProgress");
          showToast("Translation failed. Please try again.", "error");
          resolve("error");
        }
      });
    });
  } finally {
    isTranslating = false;
  }
}

function finishTranslation(lang) {
  autoTranslate = true;
  showToast(`Subtitles translated to ${LANG_NAMES[lang] || lang} ✓`);
  chrome.runtime.sendMessage({ method: "badge", text: "ON" });
  chrome.storage.local.set({ translationState: { isTranslated: true, lang } });
}

function resetSubtitles() {
  if (!originalCues) return;
  const video = document.querySelector("video");
  if (!video) return;
  const enTrack = Array.from(video.textTracks).find(
    (t) => t.language === "en" || t.label.toLowerCase().includes("english"),
  );
  if (!enTrack?.cues) return;
  for (let i = 0; i < enTrack.cues.length; i++) {
    if (originalCues[i] !== undefined) enTrack.cues[i].text = originalCues[i];
  }
  originalCues  = null;
  autoTranslate = false;
  chrome.runtime.sendMessage({ method: "badge", text: "" });
  chrome.storage.local.remove("translationState");
}

function applySubtitleFont() {
  chrome.storage.sync.get(["fontSize"], (s) => {
    const styleId = "cse-font-style";
    let el = document.getElementById(styleId);
    if (!el) { el = document.createElement("style"); el.id = styleId; document.head.appendChild(el); }
    el.textContent = `::cue { font-size: ${s.fontSize || 16}px !important; }`;
  });
}
applySubtitleFont();
chrome.storage.onChanged.addListener((changes) => { if (changes.fontSize) applySubtitleFont(); });

// ── Message listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.method === "translate") {
    openBilingual(request.bilingual).then((status) => sendResponse({ status }));
    return true;
  }
  if (request.method === "reset") {
    resetSubtitles();
    sendResponse({ status: "reset" });
    return true;
  }
});
