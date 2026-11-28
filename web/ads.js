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

    let rafId = 0;
    const renderForWidth = (width) => {
      const format = formats.find((item) => item.width <= width);
      if (!format || (desktopOnly && !matchMedia("(min-width: 768px)").matches)) {
        if (currentKey !== undefined || slot.children?.length) {
          currentKey = undefined;
          slot.replaceChildren();
        }
        return;
      }
      if (format.key === currentKey) return;
      currentKey = format.key;

      const { width: adWidth, height, key } = format;
      const label = document.createElement("small");
      label.textContent = "Advertisement";
      const frame = document.createElement("iframe");
      frame.title = "Advertisement";
      frame.width = adWidth;
      frame.height = height;
      frame.loading = "eager";
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      const options = { key, format: "iframe", width: adWidth, height, params: {} };
      frame.srcdoc = `<!doctype html><meta charset="utf-8"><style>body{margin:0;overflow:hidden}</style><script>window.atOptions=${JSON.stringify(options)}</script><script data-cfasync="false" type="text/javascript" src="https://bauval.org/22/${key}"></script>`;
      slot.replaceChildren(label, frame);
    };

    new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width || slot.getBoundingClientRect?.().width || 0;
      if (typeof requestAnimationFrame === "function") {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          renderForWidth(width);
        });
      } else {
        renderForWidth(width);
      }
    }).observe(slot);
  }
})();
