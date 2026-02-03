document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("translateBtn");
  const btnText = btn.querySelector("span");

  btn.addEventListener("click", async () => {
    const lang = document.getElementById("lang").value;

    // UI Feedback: Loading State
    const originalText = btnText.innerText;
    btnText.innerText = "Translating...";
    btn.style.opacity = "0.7";
    btn.style.pointerEvents = "none";

    // Save language
    chrome.storage.sync.set({ lang: lang });

    // Send message to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { method: "translate" },
          (response) => {
            // Reset UI after a delay
            setTimeout(() => {
              btnText.innerText = originalText;
              btn.style.opacity = "1";
              btn.style.pointerEvents = "all";
            }, 1000);
          },
        );
      }
    });
  });
});
