// UI Logic
const trigger = document.getElementById("selectTrigger");
const container = document.getElementById("dropdownContainer");
const options = document.querySelectorAll(".option");
const hiddenInput = document.getElementById("lang");
const label = document.getElementById("selectedLabel");

trigger.addEventListener("click", (e) => {
  e.stopPropagation();
  container.classList.toggle("open");
});

options.forEach((opt) => {
  opt.addEventListener("click", () => {
    label.innerText = opt.innerText;
    hiddenInput.value = opt.getAttribute("data-value");
    container.classList.remove("open");
  });
});

document.addEventListener("click", () => container.classList.remove("open"));
