document.addEventListener("DOMContentLoaded", () => {

  // ── Element refs ──────────────────────────────────────────────────────────

  const trigger         = document.getElementById("selectTrigger");
  const container       = document.getElementById("dropdownContainer");
  const hiddenInput     = document.getElementById("lang");
  const selectedLabel   = document.getElementById("selectedLabel");
  const langSearch      = document.getElementById("langSearch");
  const options         = document.querySelectorAll(".option");
  const btn             = document.getElementById("translateBtn");
  const resetBtn        = document.getElementById("resetBtn");
  const btnText         = btn.querySelector("span");
  const bilingualToggle = document.getElementById("bilingualToggle");
  const statusHint      = document.getElementById("statusHint");
  const fontSizeInput   = document.getElementById("fontSizeInput");

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

  // ── Dropdown ──────────────────────────────────────────────────────────────

  function setActive(value) {
    options.forEach((o) => o.classList.remove("active"));
    document.querySelector(`.option[data-value="${value}"]`)?.classList.add("active");
  }

  function closeDropdown() {
    container.classList.remove("open");
    langSearch.value = "";
    options.forEach((o) => (o.style.display = ""));
  }

  setActive(hiddenInput.value);

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const wasOpen = container.classList.contains("open");
    container.classList.toggle("open");
    if (!wasOpen) {
      document.getElementById("optionsMenu").scrollTop = 0;
      requestAnimationFrame(() => langSearch.focus());
    }
  });

  langSearch.addEventListener("click", (e) => e.stopPropagation());

  langSearch.addEventListener("input", () => {
    const q = langSearch.value.toLowerCase().trim();
    options.forEach((o) => { o.style.display = o.innerText.toLowerCase().includes(q) ? "" : "none"; });
  });

  options.forEach((opt) => {
    opt.addEventListener("click", () => {
      const value = opt.getAttribute("data-value") ?? "";
      selectedLabel.innerText = opt.innerText;
      hiddenInput.value = value;
      setActive(value);
      closeDropdown();
    });
  });

  document.addEventListener("click", () => closeDropdown());

  // ── Restore saved state ───────────────────────────────────────────────────

  chrome.storage.sync.get(["lang", "bilingual", "fontSize"], (s) => {
    if (s.lang) {
      hiddenInput.value = s.lang;
      const match = document.querySelector(`.option[data-value="${s.lang}"]`);
      if (match) selectedLabel.innerText = match.innerText;
      setActive(s.lang);
    }
    if (s.bilingual) bilingualToggle.checked = s.bilingual;
    if (s.fontSize) fontSizeInput.value = s.fontSize;
  });

  bilingualToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ bilingual: bilingualToggle.checked });
  });

  fontSizeInput.addEventListener("change", () => {
    const val = parseInt(fontSizeInput.value, 10);
    if (val >= 10 && val <= 50) chrome.storage.sync.set({ fontSize: val });
  });

  // ── Reflect translation state on open ─────────────────────────────────────

  chrome.storage.local.get(["translationState"], (r) => {
    const state = r.translationState;
    if (state?.isTranslated) {
      const name = LANG_NAMES[state.lang] || state.lang;
      statusHint.textContent = `Active: subtitles translated to ${name}`;
      statusHint.classList.add("translated");
      btnText.textContent = "Re-translate";
    }
  });

  // ── Translate button ──────────────────────────────────────────────────────

  let progressInterval = null;

  btn.addEventListener("click", () => {
    const lang      = hiddenInput.value;
    const bilingual = bilingualToggle.checked;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return;

      const url = tab.url ?? "";
      if (!url.includes("coursera.org")) {
        const orig = btnText.textContent;
        btnText.textContent     = "Open a Coursera video first";
        btn.style.opacity       = "1";
        btn.style.pointerEvents = "none";
        setTimeout(() => { btnText.textContent = orig; btn.style.pointerEvents = "all"; }, 2500);
        return;
      }

      const orig = btnText.textContent;
      btnText.textContent     = "Translating…";
      btn.style.opacity       = "0.7";
      btn.style.pointerEvents = "none";

      chrome.storage.sync.set({ lang, bilingual });

      progressInterval = setInterval(() => {
        chrome.storage.local.get(["translationProgress"], (r) => {
          const p = r.translationProgress;
          if (p && p.total > 1) btnText.textContent = `Translating… ${p.done} / ${p.total}`;
        });
      }, 400);

      chrome.tabs.sendMessage(tab.id, { method: "translate", bilingual }, (response) => {
        clearInterval(progressInterval);
        progressInterval = null;
        btn.style.opacity       = "1";
        btn.style.pointerEvents = "all";

        const status = response?.status;
        if (chrome.runtime.lastError || !response || status === "error") {
          btnText.textContent = "Failed — try again";
          setTimeout(() => { btnText.textContent = orig; }, 2500);
        } else if (status === "busy") {
          btnText.textContent = "Already translating…";
          setTimeout(() => { btnText.textContent = orig; }, 2000);
        } else {
          const name = LANG_NAMES[lang] || lang;
          btnText.textContent    = "Re-translate";
          statusHint.textContent = `Active: subtitles translated to ${name}`;
          statusHint.classList.add("translated");
        }
      });
    });
  });

  // ── Reset button ──────────────────────────────────────────────────────────

  resetBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return;
      chrome.tabs.sendMessage(tab.id, { method: "reset" }, () => {
        btnText.textContent    = "Translate";
        statusHint.textContent = "Open a Coursera video with English subtitles, then click Translate.";
        statusHint.classList.remove("translated");
      });
    });
  });

});
