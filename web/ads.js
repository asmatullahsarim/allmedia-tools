(() => {
  "use strict";
  const slot = document.getElementById("adsterra-banner");
  if (!slot || !window.ALLMEDIA_ADS?.enabled) return;
  const label = document.createElement("small");
  label.textContent = "Advertisement";
  const frame = document.createElement("iframe");
  frame.src = "ads/banner.html";
  frame.title = "Advertisement";
  frame.width = "320";
  frame.height = "50";
  frame.setAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox");
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  slot.replaceChildren(label, frame);
  slot.hidden = false;
})();
