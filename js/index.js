document.addEventListener(
  "DOMContentLoaded",
  function () {
    let checkButton = document.getElementById("translateBtn");
    checkButton.addEventListener(
      "click",
      function () {
        let lang = document.getElementById("lang").value;
        chrome.storage.sync.set({ lang: lang }, function () {
          console.log("Value is set to " + lang);
        });
        chrome.tabs.query(
          { active: true, currentWindow: true },
          function (tabs) {
            chrome.tabs.sendMessage(
              tabs[0].id,
              { method: "translate" },
              function (response) {
                if (response.method == "translate") {
                }
              }
            );
          }
        );
      },
      false
    );
  },
  false
);
