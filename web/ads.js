(() => {
  "use strict";
  if (!window.ALLMEDIA_ADS?.enabled) return;

  const leaderboard = [
    { width: 728, height: 90, key: "5f4d7f7e9ff08c20fe7873e5ca6963e8" },
    { width: 468, height: 60, key: "f4c5f912201e32a3eb2ea0c242b744a7" },
    { width: 320, height: 50, key: "4ccd05c141a3a268b563bbbabe6c14b2" },
  ];
  const rectangle = [{ width: 300, height: 250, key: "5d7a9bdaf90dfa9e47293fa02a6ceb34" }];

  for (const slot of document.querySelectorAll("[data-display-ad]")) {
    const formats = slot.dataset.displayAd === "rectangle" ? rectangle : leaderboard;
    const desktopOnly = slot.classList.contains("display-ad--desktop");
    let currentKey;
    slot.hidden = false;

    new ResizeObserver(([entry]) => {
      const format = formats.find(({ width }) => width <= entry.contentRect.width);
      if (!format || (desktopOnly && !matchMedia("(min-width: 768px)").matches)) {
        currentKey = undefined;
        slot.replaceChildren();
        return;
      }
      if (format.key === currentKey) return;
      currentKey = format.key;

      const { width, height, key } = format;
      const label = document.createElement("small");
      label.textContent = "Advertisement";
      const frame = document.createElement("iframe");
      frame.title = "Advertisement";
      frame.width = width;
      frame.height = height;
      frame.loading = "lazy";
      frame.setAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox");
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      const options = { key, format: "iframe", width, height, params: {} };
      frame.srcdoc = `<!doctype html><meta charset="utf-8"><style>body{margin:0;overflow:hidden}</style><script>window.atOptions=${JSON.stringify(options)}</script><script src="https://bauval.org/22/${key}"></script>`;
      slot.replaceChildren(label, frame);
    }).observe(slot);
  }
})();
