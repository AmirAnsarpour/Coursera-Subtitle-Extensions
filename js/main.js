async function openBilingual() {
  // 1. Find the video element and the English track
  const video = document.querySelector("video");
  if (!video) return alert("Video not found!");

  let tracks = video.textTracks;
  let enTrack = Array.from(tracks).find(
    (t) => t.language === "en" || t.label.toLowerCase().includes("english"),
  );

  if (!enTrack) {
    return alert(
      "English subtitle track not found. Please enable English subs first.",
    );
  }

  // 2. Force track to load cues
  enTrack.mode = "showing";

  // Wait for cues to populate (Coursera fetches them on demand)
  if (!enTrack.cues || enTrack.cues.length === 0) {
    await new Promise((r) => setTimeout(r, 1000));
  }

  const cues = enTrack.cues;
  if (!cues || cues.length === 0)
    return alert("Cues empty. Try play the video for 1 sec.");

  // 3. Collect text and use a safer separator
  // We use a unique number pattern that Google Translate won't destroy
  let fullText = "";
  for (let i = 0; i < cues.length; i++) {
    fullText += cues[i].text.replace(/\n/g, " ") + ` [${i}] `;
  }

  // 4. Get Translation
  chrome.storage.sync.get(["lang"], async (result) => {
    const targetLang = result.lang || "fa";

    try {
      const translatedText = await fetchTranslation(fullText, targetLang);

      // 5. Map translations back to cues using the [index] marker
      for (let i = 0; i < cues.length; i++) {
        // Find text between [i] and [i+1]
        let startMarker = `[${i}]`;
        let endMarker = `[${i + 1}]`;

        let startIdx = translatedText.indexOf(startMarker);
        let endIdx = translatedText.indexOf(endMarker);

        if (startIdx !== -1) {
          let chunk;
          if (endIdx !== -1) {
            chunk = translatedText.substring(
              startIdx + startMarker.length,
              endIdx,
            );
          } else {
            chunk = translatedText.substring(startIdx + startMarker.length);
          }

          // Clean up the text and update the subtitle
          cues[i].text = chunk.trim();
        }
      }
    } catch (err) {
      console.error("Translation failed", err);
    }
  });
}

async function fetchTranslation(text, lang) {
  // Google Translate "gtx" has a roughly 5000 character limit.
  // For long videos, we might need to chunk this, but for most Coursera clips, this works:
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${lang}&dt=t&q=${encodeURIComponent(text)}`;

  const response = await fetch(url);
  const json = await response.json();

  // Google returns an array of chunks
  return json[0].map((item) => item[0]).join("");
}

// Listener for the popup button
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.method === "translate") {
    openBilingual();
    sendResponse({ method: "translate", status: "started" });
  }
  return true;
});
