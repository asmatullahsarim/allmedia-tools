
// ============================================================================
// Configure an optional separate All Media Tools API origin here.
// Leave empty when the API and website are served from the same origin.
// Leave empty ("") if served from the same origin or configured in-app.
// ============================================================================
const BACKEND_URL = "";

  const libraryLoads = new Map();
  function loadClientLibrary(key, src) {
    if (key === "jszip" && typeof window.JSZip === "function") return Promise.resolve();
    if (key === "qrcode" && typeof window.QRCode === "function") return Promise.resolve();
    if ((key === "papaparse" && window.Papa) || (key === "xlsx" && window.XLSX)) return Promise.resolve();
    if (libraryLoads.has(key)) return libraryLoads.get(key);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`${key} library failed to load.`));
      document.head.append(script);
    });
    libraryLoads.set(key, promise);
    return promise;
  }

(() => {
  "use strict";

  const STORAGE_KEYS = {
    BACKEND_URL: "allmedia_backend_url",
    THEME: "allmedia_theme",
    SKIN: "allmedia_skin",
  };

  function safeStorageGet(key, fallback = "") {
    try {
      const val = window.localStorage ? window.localStorage.getItem(key) : null;
      return val !== null && val !== undefined ? val : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function safeStorageSet(key, value) {
    try {
      if (window.localStorage) window.localStorage.setItem(key, value);
    } catch (_) {}
  }

  function getApiBase() {
    const raw = (safeStorageGet(STORAGE_KEYS.BACKEND_URL, "") || window.ALLMEDIA_CONFIG?.backendUrl || BACKEND_URL || "").trim();
    if (!raw) return "";
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error("Set a valid HTTP(S) backend URL without credentials, query or fragment.");
    }
    if (location.protocol === "https:" && url.protocol !== "https:") {
      throw new Error("An HTTPS website requires an HTTPS backend.");
    }
    return raw.replace(/\/+$/, "");
  }

  function apiEndpoint(path) {
    const base = getApiBase();
    return base ? `${base}${path}` : path;
  }

  function ensureBackendUrlConfigured() {
    if (
      !getApiBase() &&
      (location.protocol === "file:" ||
        location.hostname.endsWith(".pages.dev") ||
        location.hostname === "appassets.androidplatform.net")
    ) {
      throw new Error("All Media Tools API URL is not configured. Set backendUrl in config.js for a separately hosted API.");
    }
  }

  // ==========================================================================
  // COMPLETE CATALOG (REAL CLIENT-SIDE & FASTAPI TOOLS - NO DUMMY TOOLS)
  // ==========================================================================
  const ALL_TOOLS = [
    // --- AI FREE TOOLS (8) ---
    { name: "Free AI Image Generator", category: "ai", engine: "client_ai_image", badge: "FREE AI" },
    { name: "Free AI Chat Assistant", category: "ai", engine: "client_ai_chat", badge: "FREE AI" },
    { name: "Remove Background", category: "ai", engine: "api_bg", action: "remove", ad: true, badge: "u2netp" },
    { name: "Image to Text (OCR)", category: "ai", engine: "api_ocr", badge: "Tesseract" },
    { name: "AI Image Upscaler", category: "ai", engine: "api_upscale_ai", badge: "FSRCNN" },
    { name: "Remove Watermark", category: "ai", engine: "api_watermark", ad: true, badge: "OpenCV" },
    { name: "Cleanup Picture", category: "ai", engine: "api_watermark", ad: true, badge: "Brush" },
    { name: "Remove Objects", category: "ai", engine: "api_watermark", ad: true, badge: "Inpaint" },
    { name: "Boost Photo Color", category: "ai", engine: "api_image", action: "colorize", badge: "Color" },
    { name: "YouTube Transcript", category: "ai", engine: "api_transcript", badge: "Captions" },

    // --- VIDEO TOOLS (15) ---
    { name: "All Video Downloader", category: "video", engine: "api_video_url" },
    { name: "Instagram Downloader", category: "video", engine: "api_video_url" },
    { name: "TikTok No-Watermark", category: "video", engine: "api_video_url" },
    { name: "Facebook Video Saver", category: "video", engine: "api_video_url" },
    { name: "X Twitter Downloader", category: "video", engine: "api_video_url" },
    { name: "MP4 to MP3", category: "video", engine: "api_video_convert", action: "mp4_to_mp3" },
    { name: "Extract Audio", category: "video", engine: "api_video_convert", action: "extract_audio" },
    { name: "Compress Video", category: "video", engine: "api_video_convert", action: "compress_video" },
    { name: "Trim Video", category: "video", engine: "api_video_convert", action: "trim_video" },
    { name: "Resize Video", category: "video", engine: "api_video_convert", action: "resize_video" },
    { name: "MOV to MP4", category: "video", engine: "api_video_convert", action: "mov_to_mp4" },
    { name: "WEBM to MP4", category: "video", engine: "api_video_convert", action: "webm_to_mp4" },
    { name: "MKV to MP4", category: "video", engine: "api_video_convert", action: "mkv_to_mp4" },
    { name: "MP4 to AVI", category: "video", engine: "api_video_convert", action: "mp4_to_avi" },
    { name: "Video to GIF", category: "video", engine: "api_video_convert", action: "video_to_gif" },

    // --- IMAGE TOOLS (28) ---
    { name: "Social & Stock Image Downloader", category: "image", engine: "api_image_url" },
    { name: "Thumbnail & Insta DP Saver", category: "image", engine: "api_thumb_dp" },
    { name: "Change Background", category: "image", engine: "api_bg", action: "change_color", ad: true },
    { name: "Blur Background", category: "image", engine: "api_bg", action: "blur", ad: true },
    { name: "Remove Text from Photo", category: "image", engine: "api_watermark", ad: true },
    { name: "Compress Image", category: "image", engine: "api_image", action: "compress" },
    { name: "Resize Image", category: "image", engine: "api_image", action: "resize" },
    { name: "Enlarge Image", category: "image", engine: "api_upscale_ai", badge: "FSRCNN" },
    { name: "Crop Image", category: "image", engine: "client_canvas", op: "crop" },
    { name: "Make Round Image", category: "image", engine: "client_canvas", op: "round" },
    { name: "Profile Photo Maker", category: "image", engine: "client_canvas", op: "profile" },
    { name: "Rotate & Flip Image", category: "image", engine: "client_canvas", op: "rotate_flip" },
    { name: "Black & White", category: "image", engine: "client_canvas", op: "bw" },
    { name: "Pixelate Image", category: "image", engine: "client_canvas", op: "pixelate" },
    { name: "Add Text to Image", category: "image", engine: "client_canvas", op: "add_text" },
    { name: "Image Splitter", category: "image", engine: "client_canvas", op: "split" },
    { name: "Collage Maker", category: "image", engine: "client_collage", op: "collage" },
    { name: "Combine Images", category: "image", engine: "client_collage", op: "combine" },
    { name: "PDF to JPG", category: "image", engine: "api_pdf", action: "pdf_to_jpg" },
    { name: "JPG to PDF", category: "image", engine: "api_pdf", action: "jpg_to_pdf", multi: true },
    { name: "PNG to JPG", category: "image", engine: "api_image", action: "png_to_jpg" },
    { name: "JPG to PNG", category: "image", engine: "api_image", action: "jpg_to_png" },
    { name: "WEBP to JPG", category: "image", engine: "api_image", action: "webp_to_jpg" },
    { name: "JPG to WEBP", category: "image", engine: "api_image", action: "jpg_to_webp" },
    { name: "WEBP to PNG", category: "image", engine: "api_image", action: "webp_to_png" },
    { name: "PNG to WEBP", category: "image", engine: "api_image", action: "png_to_webp" },
    { name: "HEIC to JPG", category: "image", engine: "api_image", action: "heic_to_jpg" },
    { name: "HEIC to PNG", category: "image", engine: "api_image", action: "heic_to_png" },
    { name: "PNG to SVG", category: "image", engine: "client_canvas", op: "png_to_svg" },
    { name: "SVG to PNG", category: "image", engine: "client_canvas", op: "svg_to_png" },

    // --- PDF TOOLS (18) ---
    { name: "Merge PDF", category: "pdf", engine: "api_pdf", action: "merge", multi: true, ad: true },
    { name: "Split PDF", category: "pdf", engine: "api_pdf", action: "split" },
    { name: "Compress PDF", category: "pdf", engine: "api_pdf", action: "compress" },
    { name: "PDF to Text/Word", category: "pdf", engine: "api_pdf", action: "pdf_to_word" },
    { name: "Text to PDF", category: "pdf", engine: "api_pdf", action: "text_to_pdf" },
    { name: "Add Signature Stamp", category: "pdf", engine: "api_pdf", action: "esign", badge: "Text stamp" },
    { name: "Protect PDF", category: "pdf", engine: "api_pdf", action: "protect" },
    { name: "Unlock PDF", category: "pdf", engine: "api_pdf", action: "unlock" },
    { name: "Rotate PDF", category: "pdf", engine: "api_pdf", action: "rotate" },
    { name: "Rearrange PDF", category: "pdf", engine: "api_pdf", action: "rearrange" },
    { name: "Reverse PDF Pages", category: "pdf", engine: "api_pdf", action: "reverse_pages" },
    { name: "Delete PDF Pages", category: "pdf", engine: "api_pdf", action: "delete_pages" },
    { name: "PDF to Grayscale", category: "pdf", engine: "api_pdf", action: "grayscale" },
    { name: "Crop PDF", category: "pdf", engine: "api_pdf", action: "crop" },
    { name: "Add Page Numbers", category: "pdf", engine: "api_pdf", action: "add_page_numbers" },
    { name: "PDF Header & Footer", category: "pdf", engine: "api_pdf", action: "header_footer" },
    { name: "Watermark PDF", category: "pdf", engine: "api_pdf", action: "watermark" },
    { name: "Extract PDF Images", category: "pdf", engine: "api_pdf", action: "extract_images" },

    // --- CONVERTER TOOLS (8) ---
    { name: "CSV to JSON", category: "converter", engine: "client_data", op: "csv_to_json" },
    { name: "JSON to XML", category: "converter", engine: "client_data", op: "json_to_xml" },
    { name: "CSV to Excel", category: "converter", engine: "client_data", op: "csv_to_excel" },
    { name: "Excel to CSV", category: "converter", engine: "client_data", op: "excel_to_csv" },
    { name: "Split CSV", category: "converter", engine: "client_data", op: "split_csv" },
    { name: "Split Excel", category: "converter", engine: "client_data", op: "split_excel" },
    { name: "XML to Excel", category: "converter", engine: "client_data", op: "xml_to_excel" },
    { name: "Excel to JSON", category: "converter", engine: "client_data", op: "excel_to_json" },

    // --- OTHER TOOLS (6) ---
    { name: "QR Code Generator", category: "other", engine: "client_qr" },
    { name: "WhatsApp Status Saver", category: "other", engine: "wa_bridge", badge: "Native" },
    { name: "Meme Maker", category: "other", engine: "client_canvas", op: "meme" },
    { name: "Create ZIP", category: "other", engine: "client_zip" },
    { name: "Lorem Ipsum Generator", category: "other", engine: "client_lorem" },
    { name: "Epoch Converter", category: "other", engine: "client_epoch" },
  ];

  const CATEGORY_META = {
    ai: {
      label: "AI Free",
      textClass: "text-fuchsia-600 dark:text-fuchsia-400",
      iconBg: "bg-fuchsia-50 dark:bg-fuchsia-950/60 text-fuchsia-600 dark:text-fuchsia-400",
      badgeBg: "bg-fuchsia-100 dark:bg-fuchsia-950 text-fuchsia-700 dark:text-fuchsia-300",
      svg: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.1" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/></svg>`,
    },
    video: {
      label: "Video Tools",
      textClass: "text-rose-600 dark:text-rose-400",
      iconBg: "bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400",
      badgeBg: "bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300",
      svg: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.1" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`,
    },
    image: {
      label: "Image Tools",
      textClass: "text-indigo-600 dark:text-indigo-400",
      iconBg: "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400",
      badgeBg: "bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300",
      svg: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.1" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>`,
    },
    pdf: {
      label: "PDF Tools",
      textClass: "text-sky-600 dark:text-sky-400",
      iconBg: "bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400",
      badgeBg: "bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300",
      svg: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.1" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`,
    },
    converter: {
      label: "Converter",
      textClass: "text-emerald-600 dark:text-emerald-400",
      iconBg: "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400",
      badgeBg: "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300",
      svg: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.1" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>`,
    },
    other: {
      label: "Other Tools",
      textClass: "text-amber-600 dark:text-amber-400",
      iconBg: "bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400",
      badgeBg: "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300",
      svg: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.1" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/></svg>`,
    },
  };

  let activeFilter = "all";
  let searchQuery = "";
  let toastTimer = null;

  // ==========================================================================
  // REWARDED AD & ANDROID WEBVIEW BRIDGE
  // ==========================================================================
  let pendingAdUnlock = null;
  let pendingAdCancel = null;

  window.onAndroidRewardedAdComplete = function () {
    const cb = pendingAdUnlock;
    pendingAdUnlock = null;
    pendingAdCancel = null;
    if (typeof cb === "function") cb();
  };

  window.onAndroidRewardedAdFailed = function (reason) {
    const cb = pendingAdCancel;
    pendingAdUnlock = null;
    pendingAdCancel = null;
    if (typeof cb === "function") cb(reason || "Rewarded ad was skipped.");
  };

  window.triggerRewardedAd = function triggerRewardedAd(featureName, onUnlocked, onCancelled) {
    if (window.AndroidInterface && typeof window.AndroidInterface.showRewardedAd === "function") {
      pendingAdUnlock = onUnlocked;
      pendingAdCancel = onCancelled;
      try {
        window.AndroidInterface.showRewardedAd(featureName);
      } catch (err) {
        pendingAdUnlock = null;
        pendingAdCancel = null;
        if (typeof onCancelled === "function") onCancelled(err.message);
      }
      return;
    }
    if (typeof window.onWebRewardedAdTrigger === "function") {
      window.onWebRewardedAdTrigger(featureName, onUnlocked, onCancelled);
      return;
    }
    // Tools remain free under banner monetization; never claim a reward was earned.
    if (typeof onUnlocked === "function") onUnlocked();
  };

  // ==========================================================================
  // SKINS & LIGHT/DARK THEME
  // ==========================================================================
  const skinMenuBtn = document.getElementById("skin-menu-btn");
  const skinPopover = document.getElementById("skin-popover");

  if (skinMenuBtn && skinPopover) {
    skinMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      skinPopover.classList.toggle("hidden");
    });

    document.addEventListener("click", (e) => {
      if (!skinPopover.contains(e.target) && e.target !== skinMenuBtn) {
        skinPopover.classList.add("hidden");
      }
    });
  }

  window.setAppSkin = function setAppSkin(skinId, skinName) {
    try {
      if (document.body) document.body.setAttribute("data-skin", skinId);
      safeStorageSet(STORAGE_KEYS.SKIN, skinId);
      document.querySelectorAll(".skin-check").forEach((el) => {
        el.classList.toggle("hidden", el.getAttribute("data-check") !== skinId);      });
      if (skinPopover) skinPopover.classList.add("hidden");
      if (skinName) showToast(`Skin changed to ${skinName}`);    } catch (_) {}
  };

  window.setAppSkin(safeStorageGet(STORAGE_KEYS.SKIN, "ocean") || "ocean", null);

  function applyThemeMode(mode) {
    const html = document.documentElement;
    if (mode === "dark") {
      html.classList.remove("light");
      html.classList.add("dark");
    } else {
      html.classList.remove("dark");
      html.classList.add("light");
    }
    safeStorageSet(STORAGE_KEYS.THEME, mode);
  }

  applyThemeMode(safeStorageGet(STORAGE_KEYS.THEME, "light") || "light");

  const themeToggleBtn = document.getElementById("theme-toggle-btn");
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      const isDark = document.documentElement.classList.contains("dark");
      const next = isDark ? "light" : "dark";
      applyThemeMode(next);
      showToast(next === "dark" ? "Dark Mode Enabled" : "Light Mode Enabled");
    });
  }

  // ==========================================================================
  // HELPERS (DOWNLOAD, CLIPBOARD, FORMAT BYTES, ESCAPING)
  // ==========================================================================
  function showToast(msg) {
    const toast = document.getElementById("app-toast");
    toast.textContent = msg;
    toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add("hidden"), 2400);
  }
  window.showToast = showToast;

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return "0 KB";
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    return `${Math.max(1, Math.round(n / 1024))} KB`;
  }

  function downloadBlob(blob, filename) {
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
  }

  function triggerDirectDownload(downloadUrl, filename) {
    try {
      const target = new URL(downloadUrl, location.href);
      if (!["https:", "http:"].includes(target.protocol) || target.username || target.password) {
        throw new Error("Invalid download URL");
      }
      downloadUrl = target.href;
    } catch (_) { showToast("Invalid download URL"); return; }
    if (!downloadUrl) return;
    if (window.AndroidInterface && typeof window.AndroidInterface.downloadFile === "function") {
      try {
        window.AndroidInterface.downloadFile(downloadUrl, filename || "allmedia_download");
        return;
      } catch (_) {}
    }
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    if (filename) a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function parseDispositionFilename(res, fallback) {
    const cd = res.headers.get("Content-Disposition") || "";
    const match = cd.match(/filename="?([^";]+)"?/i);
    return match ? match[1] : fallback;
  }

  function detectLinkType(url) {
    const value = (url || "").trim();
    if (value.startsWith("@") || /^https?:\/\/(www\.)?instagram\.com\/[a-z0-9._]+\/?$/i.test(value)) return "thumb_dp";
    let parsed;
    try { parsed = new URL(value); } catch (_) { return "invalid"; }
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname.includes(".")) return "invalid";
    const path = parsed.pathname.toLowerCase();
    if (/\.(mp3|m4a|aac|wav|ogg|opus|flac)$/.test(path)) return "audio";
    if (/\.(jpg|jpeg|png|webp|gif|avif|heic)$/.test(path)) return "image";
    if (/\.(mp4|m4v|mov|webm|mkv|avi|m3u8)$/.test(path)) return "video";
    if (/(pinterest\.|pin\.it|unsplash\.com|pexels\.com|pixabay\.com|freepik\.com|behance\.net|dribbble\.com|artstation\.com|deviantart\.com|flickr\.com|imgur\.com|instagram\.com\/p\/|reddit\.com\/gallery)/i.test(value)) return "image";
    return "video";
  }

  function detectLinkSource(value) {
    const kind = detectLinkType(value);
    if (kind === "invalid") return { kind, label: "" };
    if (kind === "thumb_dp") return { kind, label: "Instagram profile" };
    let hostname = "";
    try { hostname = new URL(value).hostname.toLowerCase().replace(/^(www|m|mobile)\./, ""); } catch (_) {}
    const providers = [
      [/^(youtube\.com|youtu\.be|youtube-nocookie\.com)$/, "YouTube"],
      [/^(instagram\.com)$/, "Instagram"],
      [/^(tiktok\.com|vm\.tiktok\.com)$/, "TikTok"],
      [/^(facebook\.com|fb\.watch|m\.facebook\.com)$/, "Facebook"],
      [/^(vimeo\.com)$/, "Vimeo"],
      [/^(x\.com|twitter\.com)$/, "X / Twitter"],
      [/^(pinterest\.com|pin\.it)$/, "Pinterest"],
    ];
    for (const [pattern, name] of providers) if (pattern.test(hostname)) return { kind, label: name };
    if (kind === "image") return { kind, label: "Direct image" };
    if (kind === "audio") return { kind, label: "Direct audio" };
    if (/\.(mp4|m4v|mov|webm|mkv|avi|m3u8)$/i.test(hostname)) return { kind, label: "Direct video" };
    return { kind, label: hostname || "Video link" };
  }

  // Smart paste bar: detect the source before exposing its matching tool action.
  const smartLinkInput = document.getElementById("smart-link-input");
  const clipboardPasteBtn = document.getElementById("clipboard-paste-btn");
  const smartDownloadBtn = document.getElementById("smart-download-btn");
  const smartLinkStatus = document.getElementById("smart-link-status");
  const smartLinkSource = document.getElementById("smart-link-source");

  function updateSmartLinkState(rawValue) {
    const value = (rawValue || "").trim();
    const detection = detectLinkSource(value);
    const validHandle = /^@[a-z0-9._]+$/i.test(value);
    if (smartDownloadBtn) {
      smartDownloadBtn.classList.toggle("hidden", !(value && (detection.kind !== "invalid" || validHandle)));
      smartDownloadBtn.disabled = !(value && (detection.kind !== "invalid" || validHandle));
      smartDownloadBtn.textContent = detection.kind === "image"
        ? "Open image downloader"
        : detection.kind === "audio"
          ? "Open audio tool"
          : detection.kind === "thumb_dp"
            ? "Open profile saver"
            : `Open ${detection.label || "video"} downloader`;
    }
    if (smartLinkSource) {
      const isDetected = value && (detection.kind !== "invalid" || validHandle);
      smartLinkSource.hidden = !isDetected;
      smartLinkSource.textContent = isDetected ? `${detection.label} detected` : "";
    }
    if (smartLinkStatus) {
      smartLinkStatus.textContent = !value
        ? "Paste a link to identify its source and open the matching downloader."
        : (detection.kind === "invalid" && !validHandle)
          ? "Enter a complete http:// or https:// link."
          : "Source identified. Fetch available formats to reveal download options.";
    }
  }

  async function readClipboardUrl() {
    let text = "";
    try {
      if (window.AndroidInterface && typeof window.AndroidInterface.getClipboardText === "function") {
        text = window.AndroidInterface.getClipboardText() || "";
      } else if (navigator.clipboard && navigator.clipboard.readText) {
        text = await navigator.clipboard.readText();
      }
    } catch (_) { text = ""; }
    const m = (text || "").trim().match(/https?:\/\/[^\s<>"']+/i);
    return m ? m[0].replace(/[.,)\];]+$/, "") : "";
  }

  if (smartLinkInput) {
    smartLinkInput.addEventListener("input", () => updateSmartLinkState(smartLinkInput.value));
    smartLinkInput.addEventListener("paste", () => setTimeout(() => updateSmartLinkState(smartLinkInput.value), 0));
    smartLinkInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); smartDownloadBtn?.click(); }
    });
  }
  if (clipboardPasteBtn) clipboardPasteBtn.addEventListener("click", async () => {
    const clip = await readClipboardUrl();
    if (!clip) {
      smartLinkInput?.focus();
      showToast("Clipboard link not available. Paste it into the URL field.");
      return;
    }
    smartLinkInput.value = clip;
    updateSmartLinkState(clip);
  });
  if (smartDownloadBtn) smartDownloadBtn.addEventListener("click", () => {
    const url = (smartLinkInput?.value || "").trim();
    if (!url || smartDownloadBtn.disabled) return;
    handleSmartLinkGo(url);
    window.AllMediaAnalytics?.track("smart_link_open", { source: detectLinkSource(url).label });
  });
  document.getElementById("home-search-btn")?.addEventListener("click", () => smartLinkInput && document.getElementById("live-search-input")?.focus());

  document.querySelectorAll("[data-category-link]").forEach((button) => {
    button.addEventListener("click", () => {
      const category = button.dataset.categoryLink || "all";
      document.querySelectorAll("[data-category-link]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      if (typeof window.selectCategoryFilter === "function") window.selectCategoryFilter(category, false);
      document.getElementById("tools-section-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  function handleSmartLinkGo(url) {
    const kind = detectLinkType(url);
    if (kind === "invalid") { showToast("Enter a valid http or https link"); return; }
    if (kind === "audio") openToolByName("MP4 to MP3", url);
    else if (kind === "image") openToolByName("Social & Stock Image Downloader", url);
    else if (kind === "thumb_dp") openToolByName("Thumbnail & Insta DP Saver", url);
    else openToolByName("All Video Downloader", url);
  }

  // Account, quota inventory and optional feedback
  const accountModal = document.getElementById("account-modal");
  const accountOpenBtn = document.getElementById("account-open-btn");
  const accountCloseBtn = document.getElementById("account-close-btn");
  const emailAuthForm = document.getElementById("email-auth-form");
  let createAccountMode = false;
  function openAccount() {
    if (accountModal) accountModal.hidden = false;
    document.body.style.overflow = "hidden";
    refreshUsageInventory();
  }
  function closeAccount() {
    if (accountModal) accountModal.hidden = true;
    document.body.style.overflow = "";
  }
  accountOpenBtn?.addEventListener("click", openAccount);
  accountCloseBtn?.addEventListener("click", closeAccount);
  accountModal?.addEventListener("click", (event) => { if (event.target === accountModal) closeAccount(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && accountModal && !accountModal.hidden) closeAccount(); });

  async function refreshUsageInventory() {
    const imageText = document.getElementById("usage-image-count");
    const chatText = document.getElementById("usage-chat-count");
    const tier = document.getElementById("usage-tier");
    const note = document.getElementById("usage-note");
    try {
      const headers = {};
      const token = await window.AllMediaAuth?.getIdToken?.();
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(apiEndpoint("/api/usage"), { headers, credentials: "include" });
      if (!response.ok) throw new Error("Usage info is not available yet.");
      const usage = await response.json();
      if (imageText) imageText.textContent = `${usage.image.used} / ${usage.image.limit} today`;
      if (chatText) chatText.textContent = `${usage.chat.used} / ${usage.chat.limit} today`;
      if (tier) tier.textContent = usage.authenticated ? "Signed in" : "Guest";
      if (note) note.textContent = usage.authenticated ? "Standard free limits. Usage resets daily." : "Guest limits are 50% lower. Sign in for the standard free limits.";
      const im = document.getElementById("usage-image-meter");
      const cm = document.getElementById("usage-chat-meter");
      if (im) im.style.width = `${Math.min(100, usage.image.used / Math.max(1, usage.image.limit) * 100)}%`;
      if (cm) cm.style.width = `${Math.min(100, usage.chat.used / Math.max(1, usage.chat.limit) * 100)}%`;
    } catch (_) {
      if (note) note.textContent = "Usage inventory appears when the API and Firebase configuration are available.";
    }
  }
  window.addEventListener("allmedia-auth-changed", (event) => {
    const user = event.detail?.user;
    const userLabel = document.getElementById("auth-user-label");
    const authPanel = document.getElementById("account-auth-panel");
    if (userLabel) userLabel.textContent = user ? `Signed in as ${user.email || "your account"}` : "Sign in for higher free AI limits.";
    if (accountOpenBtn) accountOpenBtn.textContent = user ? "My account" : "Sign in";
    if (authPanel) authPanel.classList.toggle("is-authenticated", Boolean(user));
    refreshUsageInventory();
  });
  document.querySelectorAll("[data-auth-provider]").forEach((button) => button.addEventListener("click", async () => {
    const status = document.getElementById("auth-status");
    try {
      status.textContent = "Opening secure sign-in…";
      await window.AllMediaAuth?.signInWithProvider(button.dataset.authProvider);
    } catch (error) { status.textContent = error.message || "Sign-in could not be completed."; }
  }));
  document.getElementById("email-auth-mode")?.addEventListener("click", (event) => {
    createAccountMode = !createAccountMode;
    document.getElementById("email-auth-submit").textContent = createAccountMode ? "Create account" : "Sign in";
    event.currentTarget.textContent = createAccountMode ? "Have an account? Sign in" : "Create account";
    document.getElementById("auth-password")?.setAttribute("autocomplete", createAccountMode ? "new-password" : "current-password");
  });
  emailAuthForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.getElementById("auth-status");
    const email = document.getElementById("auth-email")?.value.trim();
    const password = document.getElementById("auth-password")?.value || "";    try {
      status.textContent = createAccountMode ? "Creating your account…" : "Signing in…";
      if (createAccountMode) await window.AllMediaAuth?.createAccount(email, password);
      else await window.AllMediaAuth?.signInWithEmail(email, password);      status.textContent = "You are signed in.";
    } catch (error) { status.textContent = error.message || "Email sign-in is not available yet."; }
  });
  document.getElementById("sign-out-btn")?.addEventListener("click", async () => {
    try { await window.AllMediaAuth?.signOut(); } catch (error) { document.getElementById("auth-status").textContent = error.message; }
  });
  document.getElementById("feedback-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.getElementById("feedback-message")?.value.trim();
    const status = document.getElementById("feedback-status");
    if (!message) { status.textContent = "Write a short suggestion first."; return; }
    try {
      const token = await window.AllMediaAuth?.getIdToken?.();
      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const rawRating = document.getElementById("feedback-rating")?.value;
      const response = await fetch(apiEndpoint("/api/feedback"), { method: "POST", headers, credentials: "include", body: JSON.stringify({ message, rating: rawRating ? Number(rawRating) : null }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || "Feedback is not configured yet.");
      status.textContent = "Thanks — your feedback was received.";
      document.getElementById("feedback-message").value = "";
      document.getElementById("feedback-rating").value = "";
    } catch (error) { status.textContent = error.message || "Feedback could not be sent."; }
  });
  document.getElementById("analytics-consent")?.addEventListener("change", (event) => {
    window.AllMediaAnalytics?.setConsent(event.target.checked);
  });

  // Use the visitor's browser language for the main shell. English is the fallback.
  const UI_LANGUAGE = (navigator.languages?.[0] || navigator.language || "en").toLowerCase().split("-")[0];
  const UI_COPY = {
    ur: { download:"ڈاؤن لوڈ", paste:"پیسٹ", search:"ٹول تلاش کریں", free:"مفت ٹولز • AI اور میڈیا", all:"تمام ٹولز", ai:"AI ٹولز", video:"ویڈیو ٹولز", image:"تصویری ٹولز", pdf:"PDF ٹولز", converter:"کنورٹرز", other:"مزید ٹولز" },
    hi: { download:"डाउनलोड", paste:"पेस्ट", search:"टूल खोजें", free:"मुफ़्त टूल • AI और मीडिया", all:"सभी टूल", ai:"AI टूल", video:"वीडियो टूल", image:"इमेज टूल", pdf:"PDF टूल", converter:"कन्वर्टर", other:"अन्य टूल" },
    es: { download:"Descargar", paste:"Pegar", search:"Buscar herramientas", free:"Herramientas gratis • IA y medios", all:"Todas", ai:"IA", video:"Vídeo", image:"Imagen", pdf:"PDF", converter:"Convertidores", other:"Otros" },
    ar: { download:"تنزيل", paste:"لصق", search:"ابحث عن الأدوات", free:"أدوات مجانية • الذكاء الاصطناعي والوسائط", all:"كل الأدوات", ai:"أدوات AI", video:"أدوات الفيديو", image:"أدوات الصور", pdf:"أدوات PDF", converter:"المحوّلات", other:"أدوات أخرى" }
  };
  const selectedCopy = UI_COPY[UI_LANGUAGE];
  if (selectedCopy) {
    const applyShellLanguage = () => {
      const button = document.getElementById("smart-download-btn"); if (button) button.textContent = selectedCopy.download;
      const paste = document.querySelector("#clipboard-paste-btn span"); if (paste) paste.textContent = selectedCopy.paste;
      const search = document.getElementById("live-search-input"); if (search) search.placeholder = selectedCopy.search;
      const slogan = document.querySelector("#app-shell header p"); if (slogan) slogan.textContent = selectedCopy.free;
      document.querySelectorAll("[data-filter]").forEach((el) => { const key = el.dataset.filter; if (selectedCopy[key]) { const icon = el.querySelector("svg"); el.textContent = selectedCopy[key]; if (icon) el.prepend(icon); } });
      if (UI_LANGUAGE === "ur" || UI_LANGUAGE === "ar") document.getElementById("app-shell")?.setAttribute("dir", "rtl");
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyShellLanguage, { once:true }); else applyShellLanguage();
  }

  // ==========================================================================
  // LIVE SEARCH & GRID RENDERING
  // ==========================================================================
  const toolsGridEl = document.getElementById("tools-grid");
  const noResultsBox = document.getElementById("no-results-box");
  const showingCountBadge = document.getElementById("showing-count-badge");
  const liveSearchInput = document.getElementById("live-search-input");
  const clearSearchBtn = document.getElementById("clear-search-btn");
  const filterPills = document.querySelectorAll(".filter-pill");

  function updateToolCounts() {
    document.querySelectorAll("[data-tool-count]").forEach((el) => {
      const category = el.dataset.toolCount;
      const count = ALL_TOOLS.filter((tool) => tool.category === category).length;
      el.textContent = category === "ai" ? `${count} AI tools` : `${count} tools`;
    });
    const total = ALL_TOOLS.length;
    const summary = document.getElementById("desktop-tool-summary");
    if (summary) summary.textContent = `${total} listed tools`;
  }

  async function refreshApiHealth() {
    const statusEl = document.getElementById("api-health-status");
    const dotEl = document.getElementById("api-health-dot");
    const labelEl = document.getElementById("api-health-label");
    if (!statusEl || !labelEl) return;
    const setState = (state, message, title = "") => {
      statusEl.dataset.state = state;
      statusEl.title = title;
      labelEl.textContent = message;
      if (dotEl) {
        dotEl.className = `h-1.5 w-1.5 rounded-full ${state === "online" ? "bg-emerald-500" : state === "offline" ? "bg-rose-500" : "bg-slate-400"}`;
      }
    };

    setState("checking", "Checking server tools…");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(apiEndpoint("/api/health"), {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Health check returned HTTP ${response.status}`);
      const health = await response.json();
      if (health.status !== "ok") throw new Error("API did not report an OK status");
      const checkedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setState("online", `Server tools online · ${checkedAt}`, `Live API health check at ${checkedAt}`);
    } catch (error) {
      setState("offline", "Server tools unavailable · browser tools still work", error.message || "API health check failed");
    } finally {
      window.clearTimeout(timeout);
      renderToolsGrid();
    }
  }

  updateToolCounts();
  window.setInterval(refreshApiHealth, 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshApiHealth();
  });

  const descriptions = {
    "Compress Image": "Reduce image file size.",
    "Resize Image": "Set the image width in pixels.",
    "PNG to JPG": "Convert PNG images to JPEG.",
    "JPG to PDF": "Put JPG images into one PDF.",
    "Merge PDF": "Combine multiple PDFs.",
    "MP4 to MP3": "Extract audio from an MP4.",
    "Free AI Chat Assistant": "Draft, translate, or ask a question.",
    "Free AI Image Generator": "Generate an image from a prompt.",
    "Remove Background": "Make the background transparent.",
    "AI Image Upscaler": "Enhance image resolution with AI — 2× or 4× upscaling using neural networks for crisp, sharp results.",
      "Image to Text (OCR)": "Extract text from any image using AI — perfect for receipts, screenshots, and scanned documents.",
    "Compress Video": "Make a video file smaller.",
    "Trim Video": "Keep a selected part of a video.",
    "Split PDF": "Save selected pages separately.",
    "PDF to JPG": "Save PDF pages as images.",
  };

  const verifiedToolOrder = ["QR Code Generator", "Lorem Ipsum Generator", "Epoch Converter"];

  // Top tools by search volume — shown in "Popular" strip
  const POPULAR_TOOL_NAMES = [
    "Remove Background",
    "AI Image Upscaler",
    "Compress Image",
    "JPG to PDF",
    "Image to Text (OCR)",
    "MP4 to MP3",
    "Merge PDF",
    "Resize Image",
  ];

  function needsServer(tool) {
    return tool.engine.startsWith("api_") || tool.engine.startsWith("client_ai_");
  }

  function comingSoon(tool) {
    if (tool.engine === "wa_bridge") return typeof window.AndroidInterface?.openStatusSaver !== "function";
    return needsServer(tool) && document.getElementById("api-health-status")?.dataset.state !== "online";
  }

  function toolPriority(tool) {
    const verifiedIndex = verifiedToolOrder.indexOf(tool.name);
    if (verifiedIndex !== -1) return verifiedIndex;
    return comingSoon(tool) ? verifiedToolOrder.length + 1 : verifiedToolOrder.length;
  }

  function appendToolGuide(body, tool) {
    const engine = tool?.engine || "";
    let steps;
    if (engine === "api_video_url" || engine === "api_image_url" || engine === "api_thumb_dp" || engine === "api_transcript") {
      steps = ["Paste a public link from a supported source.", "Choose Fetch or Convert and wait for the result.", "Use the result link or download button shown below."];
    } else if (engine === "api_video_convert" || engine === "api_image" || engine === "api_pdf" || engine === "api_bg" || engine === "api_ocr" || engine === "api_upscale_ai" || engine === "api_watermark") {
      steps = ["Choose a supported file from your device.", "Set the available options and start processing.", "Download the completed result when it appears."];
    } else if (engine.startsWith("client_ai")) {
      steps = ["Enter your prompt or text in the tool above.", "Choose any available settings and start generation.", "Review the result and save or copy it."];
    } else {
      steps = ["Enter or upload the content requested above.", "Choose the available options and run the tool.", "Review the result and download or copy it."];
    }
    const section = document.createElement("section");
    section.className = "tool-guide";
    section.setAttribute("aria-label", `How to use ${tool.name}`);
    section.innerHTML = `
      <h4>How to use ${escapeHtml(tool.name)}</h4>
      <ol>${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
      <p>Use files and links you own or have permission to process. Availability can depend on the source and file format.</p>`;
    body.append(section);
  }

  function appendToolAd(body) {
    if (!window.ALLMEDIA_ADS?.enabled) return;
    const slot = document.createElement("aside");
    slot.dataset.toolAd = "";
    slot.style.cssText = "margin:16px 0 0;text-align:center;min-height:66px";
    slot.setAttribute("aria-label", "Advertisement");
    const label = document.createElement("small");
    label.textContent = "Advertisement";
    label.style.display = "block";
    const frame = document.createElement("iframe");
    frame.title = "Tool advertisement";
    frame.src = new URL("/ads/banner.html?v=2", location.origin).href;
    frame.style.cssText = "width:320px;max-width:100%;height:50px;border:0";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    slot.append(label, frame);
    body.prepend(slot);
  }

  function renderPopularStrip() {
    const strip = document.getElementById("popular-strip");
    if (!strip) return;
    const popularTools = POPULAR_TOOL_NAMES.map(name => ALL_TOOLS.find(t => t.name === name)).filter(Boolean);
    if (!popularTools.length) { document.getElementById("popular-strip-wrap")?.remove(); return; }
    strip.innerHTML = popularTools.map(tool => {
      const meta = CATEGORY_META[tool.category];
      return `<button type="button" data-popular-tool="${escapeHtml(tool.name)}"
        class="shrink-0 flex flex-col items-center gap-1 bg-white dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl px-3 py-2.5 shadow-sm hover:shadow-md active:scale-[0.97] transition-all cursor-pointer min-w-[72px]">
        <div class="w-9 h-9 rounded-xl ${meta.iconBg} flex items-center justify-center">${meta.svg}</div>
        <span class="text-[9.5px] font-bold text-slate-700 dark:text-slate-200 text-center leading-tight line-clamp-2 max-w-[70px]">${escapeHtml(tool.name)}</span>
      </button>`;
    }).join("");
    strip.onclick = (event) => {
      const button = event.target.closest("[data-popular-tool]");
      if (button) window.openToolByName(button.dataset.popularTool);
    };
  }

  function renderToolsGrid() {
    if (!toolsGridEl) return;
    const filtered = ALL_TOOLS.filter((tool) => {
      const catOk = activeFilter === "all" || tool.category === activeFilter;
      const q = searchQuery.toLowerCase();
      const searchOk = !q || tool.name.toLowerCase().includes(q) || CATEGORY_META[tool.category].label.toLowerCase().includes(q);
      return catOk && searchOk;
    });

    if (showingCountBadge) showingCountBadge.textContent = `${filtered.length} tools`;
    if (!filtered.length) {
      toolsGridEl.innerHTML = "";
      if (noResultsBox) noResultsBox.classList.remove("hidden");
      return;
    }
    if (noResultsBox) noResultsBox.classList.add("hidden");
    toolsGridEl.innerHTML = filtered
      .sort((a, b) => toolPriority(a) - toolPriority(b))
      .map((tool) => {
        const meta = CATEGORY_META[tool.category];
        const description = descriptions[tool.name];
        return `
          <div role="button" tabindex="0" data-tool-name="${escapeHtml(tool.name)}" class="tool-card-item bg-white dark:bg-slate-800/95 rounded-2xl p-2.5 border border-slate-200/80 dark:border-slate-700/80 shadow-sm hover:shadow-md active:scale-[0.97] transition-all cursor-pointer flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-xl ${meta.iconBg} flex items-center justify-center shrink-0">${meta.svg}</div>
            <div class="min-w-0 flex-1">
              <h3 class="text-[12px] font-bold text-slate-900 dark:text-white leading-snug line-clamp-2">${escapeHtml(tool.name)}</h3>
              <div class="flex items-center justify-between gap-1 mt-0.5">
                <span class="text-[10px] font-semibold ${meta.textClass} truncate">${comingSoon(tool) ? "Coming soon" : meta.label}</span>
              </div>
              ${description ? `<p class="tool-card-description">${escapeHtml(description)}</p>` : ""}
            </div>
          </div>`;
      })
      .join("");
  }

  if (toolsGridEl) {
    toolsGridEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        const card = e.target.closest("[data-tool-name]");
        if (card) { e.preventDefault(); window.openToolByName(card.dataset.toolName); }
      }
    });
    toolsGridEl.addEventListener("click", (e) => {
      const card = e.target.closest("[data-tool-name]");
      if (card) {
        const name = card.getAttribute("data-tool-name");
        if (name) window.openToolByName(name);
      }
    });
  }

  document.querySelectorAll("[data-featured-tool]").forEach((button) => {
    button.addEventListener("click", () => window.openToolByName(button.dataset.featuredTool));
  });

  const categoryLinks = document.querySelectorAll("[data-category-link]");
  categoryLinks.forEach((button) => {
    button.addEventListener("click", () => window.selectCategoryFilter(button.dataset.categoryLink));
  });

  window.selectCategoryFilter = function selectCategoryFilter(cat, shouldScroll = true) {
    activeFilter = cat;
    categoryLinks.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.categoryLink === cat));
    });
    filterPills.forEach((p) => {
      const isSelected = p.getAttribute("data-filter") === cat;
      p.classList.toggle("skin-bg", isSelected);
      p.classList.toggle("text-white", isSelected);
      p.classList.toggle("font-bold", isSelected);
      p.classList.toggle("skin-shadow", isSelected);
      p.classList.toggle("bg-white", !isSelected);
      p.classList.toggle("dark:bg-slate-800", !isSelected);
      p.classList.toggle("text-slate-600", !isSelected);
      p.classList.toggle("dark:text-slate-300", !isSelected);
      p.classList.toggle("border", !isSelected);
    });
    renderToolsGrid();
    if (shouldScroll) {
      document.getElementById("tools-section-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  if (liveSearchInput) {
    liveSearchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value.trim();
      if (clearSearchBtn) clearSearchBtn.classList.toggle("hidden", !searchQuery);
      renderToolsGrid();
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener("click", () => {
      if (liveSearchInput) liveSearchInput.value = "";
      searchQuery = "";
      clearSearchBtn.classList.add("hidden");
      renderToolsGrid();
    });
  }

  window.resetFilters = function resetFilters() {
    liveSearchInput.value = "";
    searchQuery = "";    clearSearchBtn.classList.add("hidden");
    window.selectCategoryFilter("all", false);
  };

  // ==========================================================================  // BOTTOM DRAWER OPEN / CLOSE
  // ==========================================================================
  const drawerBackdrop = document.getElementById("drawer-backdrop");
  const toolDrawer = document.getElementById("tool-drawer");

  const drawerCloseButton = toolDrawer?.querySelector("[data-drawer-close]");
  let drawerTrigger;

  function showDrawer() {
    if (!toolDrawer) return;
    if (toolDrawer.classList.contains("drawer-closed")) drawerTrigger = document.activeElement;
    drawerBackdrop?.classList.remove("hidden", "pointer-events-none");
    toolDrawer.classList.remove("drawer-closed", "pointer-events-none", "translate-y-full");
    drawerCloseButton?.focus({ preventScroll: true });
  }

  window.closeToolDrawer = function closeToolDrawer() {
    toolDrawer?.querySelector("[data-tool-ad]")?.remove();
    toolDrawer?.classList.add("drawer-closed", "pointer-events-none", "translate-y-full");
    drawerBackdrop?.classList.add("hidden", "pointer-events-none");
    drawerTrigger?.focus({ preventScroll: true });
  };

  drawerCloseButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    window.closeToolDrawer();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && toolDrawer && !toolDrawer.classList.contains("drawer-closed")) {
      window.closeToolDrawer();
    }
  });

  function loadingSpinnerHtml(label) {
    return `<div class="py-5 flex flex-col items-center gap-2"><div class="spinner-circle"></div><p class="text-xs font-bold text-slate-700 dark:text-slate-200">${escapeHtml(label)}</p></div>`;
  }

  function errorBoxHtml(msg) {
    return `<div class="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs font-semibold text-rose-700 dark:text-rose-300">${escapeHtml(msg)}</div>`;
  }

  function downloadResultCardHtml(blob, filename, origSize = null, previewDataUrl = null) {
    const objUrl = URL.createObjectURL(blob);
    const sizeInfo = origSize
      ? `${formatBytes(origSize)} → ${formatBytes(blob.size)}`
      : `${formatBytes(blob.size)}`;
    const previewHtml = previewDataUrl
      ? `<div class="checker-bg rounded-xl p-2 mb-2 text-center"><img src="${previewDataUrl}" class="max-h-44 mx-auto rounded-lg object-contain" alt="Result preview"></div>`
      : "";
    return `
      <div class="p-3 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 space-y-2">
        ${previewHtml}
        <div class="flex items-center justify-between text-xs font-bold text-emerald-800 dark:text-emerald-300">
          <span class="truncate mr-2">${escapeHtml(filename)}</span>
          <span class="shrink-0">${sizeInfo}</span>
        </div>
        <a href="${objUrl}" download="${escapeHtml(filename)}" class="block w-full py-2.5 rounded-xl skin-bg text-white text-xs font-bold text-center skin-shadow">
          Download File ↓
        </a>
      </div>`;
  }

  // ==========================================================================
  // KEYLESS CLIENT FALLBACKS FOR INSTANT VIDEO/IMAGE LINKS
  // ==========================================================================
  async function tryKeylessVideoFallback(url) {
    try {
      if (/tiktok\.com/i.test(url)) {
        const r = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`);
        const j = await r.json();
        if (j.code === 0 && j.data) {
          const abs = (p) => (!p ? null : p.startsWith("http") ? p : `https://www.tikwm.com${p}`);
          return {
            title: j.data.title || "TikTok Video",
            platform: "TikTok (No Watermark)",
            thumbnail: abs(j.data.cover),
            standard_url: abs(j.data.wmplay) || abs(j.data.play),
            clean_hd_url: abs(j.data.play),
            full_hd_url: abs(j.data.hdplay) || abs(j.data.play),
          };
        }
      }
      if (/(twitter\.com|x\.com)\/.*\/status\/(\d+)/i.test(url)) {
        const id = url.match(/\/status\/(\d+)/)[1];
        const r = await fetch(`https://api.fxtwitter.com/i/status/${id}`);
        const j = await r.json();
        const v = j?.tweet?.media?.videos?.[0];
        if (v) {
          const mp4s = (v.variants || [])
            .filter((x) => x.url && (!x.content_type || x.content_type.includes("mp4")))
            .sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0))
            .map((x) => x.url);
          const best = mp4s[mp4s.length - 1] || v.url;
          return {
            title: (j.tweet.text || "X Video").slice(0, 110),
            platform: "X (Twitter)",
            thumbnail: v.thumbnail_url || null,
            standard_url: mp4s[0] || best,
            clean_hd_url: mp4s[Math.floor(mp4s.length / 2)] || best,
            full_hd_url: best,
          };
        }
      }
      if (/(youtube\.com|youtu\.be)/i.test(url)) {
        const m = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([a-zA-Z0-9_-]{11})/);
        if (m) {
          for (const host of ["https://pipedapi.kavin.rocks", "https://pipedapi.adminforge.de"]) {
            try {
              const r = await fetch(`${host}/streams/${m[1]}`);
              if (!r.ok) continue;
              const j = await r.json();
              const muxed = (j.videoStreams || [])
                .filter((s) => s.url && !s.videoOnly && (s.mimeType || "").includes("mp4"))
                .sort((a, b) => (a.height || 0) - (b.height || 0));
              if (muxed.length > 0) {
                const urls = muxed.map((s) => s.url);
                return {
                  title: j.title || "YouTube Video",
                  platform: "YouTube",
                  thumbnail: j.thumbnailUrl || `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`,
                  standard_url: urls[0],
                  clean_hd_url: urls[Math.floor(urls.length / 2)],
                  full_hd_url: urls[urls.length - 1],
                };
              }
            } catch (_) {}
          }
        }
      }
    } catch (_) {}
    return null;
  }

  // ==========================================================================
  // TOOL ROUTER
  // ==========================================================================
  window.openToolByName = function openToolByName(toolName, prefillUrl = "") {
    const tool = ALL_TOOLS.find((t) => t.name === toolName);
    if (!tool) return;
    window.AllMediaAnalytics?.track("tool_open", { tool_name: tool.name, tool_category: tool.category });

    // Direct WhatsApp Status Bridge check
    if (tool.engine === "wa_bridge") {
      if (window.AndroidInterface && typeof window.AndroidInterface.openStatusSaver === "function") {
        try {
          window.AndroidInterface.openStatusSaver();
          showToast("Opening WhatsApp Status Saver...");
          return;
        } catch (err) {
          showToast(`Bridge error: ${err.message}`);
        }
      }
    }

    const meta = CATEGORY_META[tool.category];
    document.getElementById("drawer-title").textContent = tool.name;
    const badgeEl = document.getElementById("drawer-cat-badge");
    badgeEl.textContent = meta.label;
    badgeEl.className = `inline-block px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide mb-0.5 ${meta.badgeBg}`;
    const iconBox = document.getElementById("drawer-icon-box");
    iconBox.className = `w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${meta.iconBg}`;
    iconBox.innerHTML = meta.svg;

    const bodyEl = document.getElementById("drawer-dynamic-body");

    if (comingSoon(tool)) {
      badgeEl.textContent = "Coming soon";
      bodyEl.innerHTML = '<p role="status">Coming soon. This tool is currently unavailable.</p>';
      toolDrawer?.classList.add("tool-page-open");
      showDrawer();
      return;
    }

    switch (tool.engine) {
      case "client_ai_image":
        mountAiImageGenerator(bodyEl);
        break;
      case "client_ai_chat":
        mountAiChatAssistant(bodyEl);
        break;
      case "client_qr":
        mountQrGenerator(bodyEl);
        break;
      case "client_zip":
        mountCreateZip(bodyEl);
        break;
      case "client_lorem":
        mountLoremGenerator(bodyEl);
        break;
      case "client_epoch":
        mountEpochConverter(bodyEl);
        break;
      case "client_data":
        mountDataConverter(bodyEl, tool);
        break;
      case "client_canvas":
        mountCanvasImageTool(bodyEl, tool);
        break;
      case "client_collage":
        mountCollageOrCombineTool(bodyEl, tool);
        break;
      case "wa_bridge":
        mountWhatsAppBridgeInfo(bodyEl);
        break;
      case "api_video_url":
        mountVideoDownloader(bodyEl, prefillUrl);
        break;
      case "api_image_url":
        mountImageDownloader(bodyEl, prefillUrl);
        break;
      case "api_thumb_dp":
        mountThumbDpSaver(bodyEl, prefillUrl);
        break;
      case "api_transcript":
        mountYoutubeTranscript(bodyEl, prefillUrl);
        break;
      case "api_video_convert":
        mountVideoConvert(bodyEl, tool, prefillUrl);
        break;
      case "api_bg":
        mountBgRemover(bodyEl, tool);
        break;
      case "api_ocr":
        mountOcrTool(bodyEl, tool);
        break;
      case "api_upscale_ai":
        mountUpscaleAiTool(bodyEl, tool);
        break;
      case "api_watermark":
        mountWatermarkCanvasTool(bodyEl, tool);
        break;
      case "api_image":
        mountBackendImageTool(bodyEl, tool);
        break;
      case "api_pdf":
        mountBackendPdfTool(bodyEl, tool);
        break;
      default:
        bodyEl.innerHTML = errorBoxHtml("Tool configuration missing.");
    }

    appendToolGuide(bodyEl, tool);
    appendToolAd(bodyEl);
    toolDrawer?.classList.add("tool-page-open");
    showDrawer();
  };

  // ==========================================================================
  // CLIENT-SIDE TOOL UI BUILDERS (ZERO SERVER LOAD)
  // ==========================================================================
  async function requestAi(path, payload) {
    const headers = { "Content-Type": "application/json" };
    const idToken = await window.AllMediaAuth?.getIdToken?.();
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    const response = await fetch(apiEndpoint(path), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(105000),
    });
    if (response.ok) return response;
    if (response.status === 429) throw new Error("AI generation is busy. Try again shortly.");
    if (response.status === 502) throw new Error("The AI provider could not complete this request. Try again.");
    if (response.status === 503) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || "AI service is not configured yet.");
    }
    if (response.status === 401) throw new Error("Your login session expired. Sign in again or continue as a guest.");
    throw new Error("AI generation is temporarily unavailable.");
  }

  function mountAiImageGenerator(bodyEl) {
    bodyEl.innerHTML = `
      <div class="space-y-3">
        <textarea id="ai-img-prompt" rows="2" maxlength="900" placeholder="Describe the image you want to create..." class="w-full rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none"></textarea>
        <div class="flex gap-2">
          <select id="ai-img-style" class="flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
            <option value="photorealistic, 8k uhd">Photorealistic 8K</option>
            <option value="anime studio ghibli style">Anime Art</option>
            <option value="3d octane render">3D Render</option>
            <option value="clean flat vector logo">Vector Logo</option>
          </select>
          <button id="ai-img-go" class="px-4 py-2 rounded-xl skin-bg text-white text-xs font-bold skin-shadow">Generate Free</button>
        </div>
        <div id="ai-img-out" class="rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 text-center text-xs text-slate-500">Prompts can be up to 900 characters. Generation is subject to availability and usage limits.</div>
      </div>`;

    document.getElementById("ai-img-go").addEventListener("click", async () => {
      const p = document.getElementById("ai-img-prompt").value.trim();
      const s = document.getElementById("ai-img-style").value;
      const out = document.getElementById("ai-img-out");
      if (!p) { out.innerHTML = errorBoxHtml("Please write an image prompt first."); return; }
      out.innerHTML = loadingSpinnerHtml("Generating HD AI image...");
      const button = document.getElementById("ai-img-go");
      button.disabled = true;
      try {
        const res = await requestAi("/api/ai/image", { prompt: `${p}, ${s}` });
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[blob.type];
        out.innerHTML = downloadResultCardHtml(blob, `ai-generated.${extension}`, null, objUrl);
      } catch (err) {
        out.innerHTML = errorBoxHtml(err.message);
      } finally {
        button.disabled = false;
      }
    });
  }

  function mountAiChatAssistant(bodyEl) {
    const chatMessages = [];
    bodyEl.innerHTML = `
      <div class="space-y-2.5">
        <p class="text-sm text-slate-600 dark:text-slate-300">Free chat has usage limits. Messages can be up to 4,000 characters. If chat is busy or the limit is reached, try again later.</p>
        <div id="ai-chat-history" class="h-52 overflow-y-auto no-scrollbar rounded-2xl bg-slate-100 dark:bg-slate-800/90 p-3 space-y-2.5 border border-slate-200 dark:border-slate-700">
          <div class="bg-white dark:bg-slate-900 rounded-2xl rounded-tl-none px-3 py-2 text-xs text-slate-800 dark:text-slate-200 shadow-sm">
            Hello! Ask anything — Instagram captions, YouTube titles, coding help, or translations.
          </div>
        </div>
        <div class="flex gap-2 bg-slate-100 dark:bg-slate-800 p-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
          <input id="ai-chat-input" maxlength="4000" type="text" placeholder="Ask anything..." class="flex-1 bg-transparent text-xs text-slate-900 dark:text-white px-2 py-1 focus:outline-none" />
          <button id="ai-chat-send" class="px-3.5 py-1.5 rounded-lg skin-bg text-white text-xs font-bold">Send</button>
        </div>
      </div>`;

    const historyEl = document.getElementById("ai-chat-history");
    const inputEl = document.getElementById("ai-chat-input");
    const sendBtn = document.getElementById("ai-chat-send");

    async function sendChat() {
      const q = inputEl.value.trim();
      if (!q || sendBtn.disabled) return;
      inputEl.value = "";
      sendBtn.disabled = true;
      chatMessages.push({ role: "user", content: q });
      historyEl.innerHTML += `<div class="flex justify-end"><div class="skin-bg text-white rounded-2xl rounded-tr-none px-3 py-2 text-xs max-w-[85%]">${escapeHtml(q)}</div></div>`;
      const pendingId = `ai-wait-${Date.now()}`;
      historyEl.innerHTML += `<div id="${pendingId}" class="text-[11px] font-semibold text-slate-500">Thinking...</div>`;
      historyEl.scrollTop = historyEl.scrollHeight;

      try {
        const res = await requestAi("/api/ai/chat", { messages: chatMessages.slice(-11) });
        const { answer } = await res.json();
        chatMessages.push({ role: "assistant", content: answer });
        const waitNode = document.getElementById(pendingId);
        if (waitNode) {
          waitNode.outerHTML = `<div class="bg-white dark:bg-slate-900 rounded-2xl rounded-tl-none px-3 py-2 text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap shadow-sm">${escapeHtml(answer)}</div>`;
        }
      } catch (err) {
        const waitNode = document.getElementById(pendingId);
        chatMessages.pop();
        if (!inputEl.value) inputEl.value = q;
        if (waitNode) waitNode.outerHTML = errorBoxHtml(err.message);
      } finally {
        sendBtn.disabled = false;
        historyEl.scrollTop = historyEl.scrollHeight;
      }
    }

    sendBtn.addEventListener("click", sendChat);
    inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
  }

  function mountQrGenerator(bodyEl) {
    bodyEl.innerHTML = `
      <div class="space-y-3 text-center">
        <div class="flex gap-2">
          <input id="qr-input" type="text" placeholder="Enter a URL, Wi-Fi details or text..." class="flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs text-slate-900 dark:text-white" />
          <button id="qr-make-btn" class="px-3.5 py-2 rounded-xl skin-bg text-white text-xs font-bold">Generate</button>
        </div>
        <div id="qr-canvas-wrap" class="p-3 bg-white rounded-2xl border border-slate-200 inline-block mx-auto"></div>
        <div id="qr-dl-area"></div>
      </div>`;

    const wrap = document.getElementById("qr-canvas-wrap");
    const dlArea = document.getElementById("qr-dl-area");

    async function buildQr() {
      const txt = document.getElementById("qr-input").value.trim();
      if (!txt) { dlArea.innerHTML = errorBoxHtml("Enter text or URL."); return; }
      dlArea.innerHTML = loadingSpinnerHtml("Loading QR generator…");
      try {
        await loadClientLibrary("qrcode", "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js");
      } catch (error) { dlArea.innerHTML = errorBoxHtml(error.message); return; }
      if (typeof window.QRCode !== "function") { dlArea.innerHTML = errorBoxHtml("QR generator is unavailable."); return; }
      dlArea.replaceChildren();
      wrap.innerHTML = "";
      new window.QRCode(wrap, { text: txt, width: 220, height: 220, correctLevel: window.QRCode.CorrectLevel.H });
      setTimeout(async () => {
        const c = wrap.querySelector("canvas");
        const im = wrap.querySelector("img");
        if (c && c.toBlob) {
          c.toBlob((blob) => {
            if (blob) dlArea.innerHTML = downloadResultCardHtml(blob, "qrcode.png");
          }, "image/png");
        } else if (im && im.src) {
          try {
            const b = await (await fetch(im.src)).blob();
            dlArea.innerHTML = downloadResultCardHtml(b, "qrcode.png");
          } catch (_) {}
        }
      }, 80);
    }

    document.getElementById("qr-make-btn").addEventListener("click", buildQr);
    buildQr();
  }

  function mountCreateZip(bodyEl) {
    bodyEl.innerHTML = `
      <div class="space-y-3">
        <label class="flex flex-col items-center justify-center w-full h-28 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 cursor-pointer">
          <span class="text-xs font-bold text-slate-800 dark:text-slate-200">Select multiple files to ZIP</span>
          <span id="zip-count-lbl" class="text-[10px] text-slate-400 mt-1">Processed locally with JSZip</span>
          <input id="zip-files-input" type="file" multiple class="hidden" />
        </label>
        <button id="zip-go-btn" class="w-full py-3 rounded-2xl skin-bg text-white text-xs font-bold skin-shadow" disabled>Create ZIP Archive</button>
        <div id="zip-out"></div>
      </div>`;

    const input = document.getElementById("zip-files-input");
    const btn = document.getElementById("zip-go-btn");
    const out = document.getElementById("zip-out");
    input.addEventListener("change", () => {
      const n = input.files.length;
      document.getElementById("zip-count-lbl").textContent = n ? `${n} file(s) ready` : "Select files";
      btn.disabled = n === 0;
    });
    btn.addEventListener("click", async () => {
      out.innerHTML = loadingSpinnerHtml("Compressing files into ZIP...");
      try {
        await loadClientLibrary("jszip", "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js");
        const zip = new window.JSZip();
        let total = 0;
        for (const f of input.files) {
          total += f.size;
          zip.file(f.name, await f.arrayBuffer());
        }
        const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
        out.innerHTML = downloadResultCardHtml(blob, "allmedia_archive.zip", total);
      } catch (err) {
        out.innerHTML = errorBoxHtml(err.message);
      }
    });
  }

  function mountLoremGenerator(bodyEl) {
    bodyEl.innerHTML = `
      <div class="space-y-3">
        <div class="flex items-center gap-2">
          <label class="text-xs font-semibold text-slate-600 dark:text-slate-300">Paragraphs:</label>
          <input id="lorem-count" type="number" min="1" max="15" value="3" class="w-20 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs" />
          <button id="lorem-gen-btn" class="flex-1 py-2 rounded-xl skin-bg text-white text-xs font-bold">Generate</button>
        </div>
        <textarea id="lorem-out" rows="6" class="w-full rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2.5 text-xs text-slate-800 dark:text-slate-200"></textarea>
        <div class="flex gap-2">
          <button id="lorem-copy-btn" class="flex-1 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-xs font-bold text-slate-900 dark:text-white">Copy Text</button>
          <button id="lorem-dl-btn" class="flex-1 py-2 rounded-xl skin-bg text-white text-xs font-bold">Save .TXT</button>
        </div>
      </div>`;
    const bank = [
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer nec odio. Praesent libero. Sed cursus ante dapibus diam.",
      "Sed nisi. Nulla quis sem at nibh elementum imperdiet. Duis sagittis ipsum. Praesent mauris. Fusce nec tellus sed augue semper porta.",
      "Mauris massa. Vestibulum lacinia arcu eget nulla. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
      "Curabitur sodales ligula in libero. Sed dignissim lacinia nunc. Curabitur tortor. Pellentesque nibh. Aenean quam.",
    ];
    function gen() {
      const c = Math.max(1, Math.min(15, parseInt(document.getElementById("lorem-count").value || "3", 10)));
      const lines = Array.from({ length: c }, (_, i) => bank[i % bank.length]);
      document.getElementById("lorem-out").value = lines.join("\n\n");
    }
    document.getElementById("lorem-gen-btn").addEventListener("click", gen);
    document.getElementById("lorem-copy-btn").addEventListener("click", () => {
      navigator.clipboard?.writeText(document.getElementById("lorem-out").value);
      showToast("Copied to clipboard!");
    });
    document.getElementById("lorem-dl-btn").addEventListener("click", () => {
      downloadBlob(new Blob([document.getElementById("lorem-out").value], { type: "text/plain" }), "lorem_ipsum.txt");
    });
    gen();
  }

  function mountEpochConverter(bodyEl) {
    const nowSec = Math.floor(Date.now() / 1000);
    bodyEl.innerHTML = `
      <div class="space-y-3">
        <div class="p-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs flex justify-between items-center">
          <span class="font-semibold text-slate-600 dark:text-slate-300">Current Unix Epoch:</span>
          <strong id="epoch-live" class="font-mono skin-text">${nowSec}</strong>
        </div>
        <div class="flex gap-2">
          <input id="epoch-in" type="number" value="${nowSec}" class="flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-mono" />
          <button id="epoch-btn" class="px-3.5 py-2 rounded-xl skin-bg text-white text-xs font-bold">Convert</button>
        </div>
        <div id="epoch-out" class="p-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs space-y-1"></div>
      </div>`;
    function convert() {
      const val = Number(document.getElementById("epoch-in").value.trim());
      if (!Number.isFinite(val)) { document.getElementById("epoch-out").innerHTML = errorBoxHtml("Invalid timestamp."); return; }
      const ms = val > 1e12 ? val : val * 1000;
      const d = new Date(ms);
      document.getElementById("epoch-out").innerHTML = `<div><strong>UTC:</strong> ${d.toUTCString()}</div><div><strong>Local:</strong> ${d.toLocaleString()}</div><div><strong>ISO 8601:</strong> ${d.toISOString()}</div>`;
    }
    document.getElementById("epoch-btn").addEventListener("click", convert);
    convert();
  }

  // Real Client CSV / JSON / XML / Excel Converters (PapaParse + SheetJS XLSX)
  function mountDataConverter(bodyEl, tool) {
    const acceptMap = {
      csv_to_json: ".csv,text/csv",
      csv_to_excel: ".csv,text/csv",
      split_csv: ".csv,text/csv",
      json_to_xml: ".json,application/json",
      excel_to_csv: ".xlsx,.xls",
      split_excel: ".xlsx,.xls",
      excel_to_json: ".xlsx,.xls",
      xml_to_excel: ".xml,text/xml",
    };
    const extraCtrl = (tool.op === "split_csv" || tool.op === "split_excel")
      ? `<label class="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">Rows per file: <input id="data-rows-per" type="number" min="1" value="100" class="w-24 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2 py-1"></label>`
      : "";

    bodyEl.innerHTML = `
      <div class="space-y-3">
        <label class="flex flex-col items-center justify-center w-full h-28 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 cursor-pointer">
          <span class="text-xs font-bold text-slate-800 dark:text-slate-200">Select file to convert (${tool.name})</span>
          <span id="data-file-lbl" class="text-[10px] text-slate-400 mt-1">Instant browser conversion • Zero upload</span>
          <input id="data-file-in" type="file" accept="${acceptMap[tool.op] || "*"}" class="hidden" />
        </label>
        ${extraCtrl}
        <button id="data-go-btn" class="w-full py-3 rounded-2xl skin-bg text-white text-xs font-bold skin-shadow" disabled>Convert Now</button>
        <div id="data-out"></div>
      </div>`;

    const fileIn = document.getElementById("data-file-in");
    const btn = document.getElementById("data-go-btn");
    const out = document.getElementById("data-out");

    fileIn.addEventListener("change", () => {
      const f = fileIn.files[0];
      document.getElementById("data-file-lbl").textContent = f ? `${f.name} (${formatBytes(f.size)})` : "Select file";
      btn.disabled = !f;
    });

    btn.addEventListener("click", async () => {
      const f = fileIn.files[0];
      if (!f) return;
      out.innerHTML = loadingSpinnerHtml("Converting locally...");
      const base = f.name.replace(/\.[^.]+$/, "");
      try {
        const needsPapa = ["csv_to_json", "csv_to_excel", "split_csv"].includes(tool.op);
        const needsXlsx = !["csv_to_json", "json_to_xml", "split_csv"].includes(tool.op);
        const needsZip = ["split_csv", "split_excel"].includes(tool.op);
        await Promise.all([
          ...(needsPapa ? [loadClientLibrary("papaparse", "https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js")] : []),
          ...(needsXlsx ? [loadClientLibrary("xlsx", "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js")] : []),
          ...(needsZip ? [loadClientLibrary("jszip", "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js")] : []),
        ]);
        if (tool.op === "csv_to_json") {
          const text = await f.text();
          const parsed = window.Papa.parse(text, { header: true, skipEmptyLines: true });
          const blob = new Blob([JSON.stringify(parsed.data, null, 2)], { type: "application/json" });
          out.innerHTML = downloadResultCardHtml(blob, `${base}.json`, f.size);
        } else if (tool.op === "json_to_xml") {
          const obj = JSON.parse(await f.text());
          const toXml = (val, tag = "item") => {
            if (Array.isArray(val)) return val.map((v) => `<${tag}>${toXml(v, "entry")}</${tag}>`).join("");
            if (val && typeof val === "object") {
              return Object.entries(val).map(([k, v]) => `<${k.replace(/[^a-zA-Z0-9_-]/g, "_")}>${toXml(v, "item")}</${k.replace(/[^a-zA-Z0-9_-]/g, "_")}>`).join("");
            }
            return escapeHtml(String(val ?? ""));
          };
          const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<root>${toXml(obj)}</root>`;
          out.innerHTML = downloadResultCardHtml(new Blob([xml], { type: "application/xml" }), `${base}.xml`, f.size);
        } else if (tool.op === "csv_to_excel") {
          const parsed = window.Papa.parse(await f.text(), { header: true, skipEmptyLines: true });
          const ws = window.XLSX.utils.json_to_sheet(parsed.data);
          const wb = window.XLSX.utils.book_new();
          window.XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
          const arr = window.XLSX.write(wb, { bookType: "xlsx", type: "array" });
          out.innerHTML = downloadResultCardHtml(new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${base}.xlsx`, f.size);
        } else if (tool.op === "excel_to_csv" || tool.op === "excel_to_json") {
          const wb = window.XLSX.read(await f.arrayBuffer(), { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          if (tool.op === "excel_to_csv") {
            const csv = window.XLSX.utils.sheet_to_csv(ws);
            out.innerHTML = downloadResultCardHtml(new Blob([csv], { type: "text/csv" }), `${base}.csv`, f.size);
          } else {
            const json = window.XLSX.utils.sheet_to_json(ws);
            out.innerHTML = downloadResultCardHtml(new Blob([JSON.stringify(json, null, 2)], { type: "application/json" }), `${base}.json`, f.size);
          }
        } else if (tool.op === "xml_to_excel") {
          const doc = new DOMParser().parseFromString(await f.text(), "application/xml");
          const rows = Array.from(doc.documentElement.children).map((node) => {
            const row = {};
            Array.from(node.children).forEach((child) => { row[child.tagName] = child.textContent; });
            return Object.keys(row).length ? row : { value: node.textContent };
          });
          const ws = window.XLSX.utils.json_to_sheet(rows);
          const wb = window.XLSX.utils.book_new();
          window.XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
          const arr = window.XLSX.write(wb, { bookType: "xlsx", type: "array" });
          out.innerHTML = downloadResultCardHtml(new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${base}.xlsx`, f.size);
        } else if (tool.op === "split_csv") {
          const per = Math.max(1, parseInt(document.getElementById("data-rows-per").value || "100", 10));
          const parsed = window.Papa.parse(await f.text(), { header: true, skipEmptyLines: true });
          const zip = new window.JSZip();
          for (let i = 0, part = 1; i < parsed.data.length; i += per, part++) {
            const chunk = parsed.data.slice(i, i + per);
            zip.file(`${base}_part_${part}.csv`, window.Papa.unparse(chunk));
          }
          const zblob = await zip.generateAsync({ type: "blob" });
          out.innerHTML = downloadResultCardHtml(zblob, `${base}_split_csv.zip`, f.size);
        } else if (tool.op === "split_excel") {
          const per = Math.max(1, parseInt(document.getElementById("data-rows-per").value || "100", 10));
          const wb = window.XLSX.read(await f.arrayBuffer(), { type: "array" });
          const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
          const zip = new window.JSZip();
          for (let i = 0, part = 1; i < rows.length; i += per, part++) {
            const newWb = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(newWb, window.XLSX.utils.json_to_sheet(rows.slice(i, i + per)), "Sheet1");
            zip.file(`${base}_part_${part}.xlsx`, window.XLSX.write(newWb, { bookType: "xlsx", type: "array" }));
          }
          const zblob = await zip.generateAsync({ type: "blob" });
          out.innerHTML = downloadResultCardHtml(zblob, `${base}_split_xlsx.zip`, f.size);
        }
      } catch (err) {
        out.innerHTML = errorBoxHtml(`Conversion error: ${err.message}`);
      }
    });
  }

  // Real Client HTML5 Canvas Tools (Crop, Round, Profile, Rotate/Flip, B&W, Pixelate, Meme, Text, Split, PNG/SVG)
  function mountCanvasImageTool(bodyEl, tool) {
    let extraControls = "";
    if (tool.op === "crop") {
      extraControls = `
        <div class="grid grid-cols-2 gap-2 text-xs">
          <label>X Offset % <input id="c-x" type="range" min="0" max="50" value="10" class="w-full" /></label>
          <label>Y Offset % <input id="c-y" type="range" min="0" max="50" value="10" class="w-full" /></label>
          <label>Width % <input id="c-w" type="range" min="20" max="100" value="80" class="w-full" /></label>
          <label>Height % <input id="c-h" type="range" min="20" max="100" value="80" class="w-full" /></label>
        </div>`;
    } else if (tool.op === "profile") {
      extraControls = `<div class="flex items-center gap-3 text-xs"><label>Ring Color <input id="c-ring-color" type="color" value="#2563eb" /></label><label>Thickness <input id="c-ring-px" type="range" min="0" max="40" value="16" /></label></div>`;
    } else if (tool.op === "rotate_flip") {
      extraControls = `<div class="flex gap-2 text-xs"><select id="c-rot" class="flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2"><option value="90">Rotate 90° Right</option><option value="180">Rotate 180°</option><option value="270">Rotate 90° Left</option><option value="fliph">Flip Horizontal</option><option value="flipv">Flip Vertical</option></select></div>`;
    } else if (tool.op === "pixelate") {
      extraControls = `<label class="text-xs flex items-center gap-2">Block Size: <input id="c-pix" type="range" min="4" max="40" value="14" class="flex-1" /></label>`;
    } else if (tool.op === "meme" || tool.op === "add_text") {
      extraControls = `
        <div class="space-y-2 text-xs">
          <input id="c-top-txt" type="text" placeholder="${tool.op === "meme" ? "Top meme text..." : "Text to add..."}" class="w-full rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2" />
          ${tool.op === "meme" ? '<input id="c-bot-txt" type="text" placeholder="Bottom meme text..." class="w-full rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2" />' : '<div class="flex gap-2 items-center"><label>Color <input id="c-txt-col" type="color" value="#ffffff" /></label><label class="flex-1">Size <input id="c-txt-sz" type="range" min="20" max="90" value="44" class="w-full" /></label></div>'}
        </div>`;
    } else if (tool.op === "split") {
      extraControls = `<select id="c-grid" class="w-full rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 text-xs"><option value="2x2">2×2 (4 Tiles ZIP)</option><option value="3x3">3×3 (9 Tiles ZIP)</option><option value="1x2">Horizontal 2 Halves ZIP</option></select>`;
    }

    bodyEl.innerHTML = `
      <div class="space-y-3">
        <label class="flex flex-col items-center justify-center w-full h-24 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 cursor-pointer">
          <span class="text-xs font-bold text-slate-800 dark:text-slate-200">Tap to choose photo</span>
          <span id="canvas-file-lbl" class="text-[10px] text-slate-400 mt-0.5">Instant HTML5 Canvas engine</span>
          <input id="canvas-file-in" type="file" accept="${tool.op === "svg_to_png" ? ".svg,image/svg+xml" : "image/*"}" class="hidden" />
        </label>
        ${extraControls}
        <button id="canvas-go-btn" class="w-full py-3 rounded-2xl skin-bg text-white text-xs font-bold skin-shadow" disabled>Apply &amp; Download</button>
        <div id="canvas-out"></div>
      </div>`;

    const fileIn = document.getElementById("canvas-file-in");
    const btn = document.getElementById("canvas-go-btn");
    const out = document.getElementById("canvas-out");

    fileIn.addEventListener("change", () => {
      const f = fileIn.files[0];
      document.getElementById("canvas-file-lbl").textContent = f ? `${f.name} (${formatBytes(f.size)})` : "Choose photo";
      btn.disabled = !f;
    });

    btn.addEventListener("click", () => {      const f = fileIn.files[0];
      if (!f) return;
      out.innerHTML = loadingSpinnerHtml("Rendering on Canvas...");
      const base = f.name.replace(/\.[^.]+$/, "");

      const reader = new FileReader();      reader.onload = async (ev) => {
        const img = new Image();
        img.onload = async () => {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");

          if (tool.op === "png_to_svg") {
            const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${img.width}" height="${img.height}" viewBox="0 0 ${img.width} ${img.height}"><image href="${ev.target.result}" width="${img.width}" height="${img.height}"/></svg>`;
            const blob = new Blob([svgStr], { type: "image/svg+xml" });
            out.innerHTML = downloadResultCardHtml(blob, `${base}.svg`, f.size);
            return;
          }

          if (tool.op === "split") {
            await loadClientLibrary("jszip", "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js");
            const mode = document.getElementById("c-grid").value;
            const [cols, rows] = mode === "3x3" ? [3, 3] : mode === "1x2" ? [2, 1] : [2, 2];
            const tw = Math.floor(img.width / cols);
            const th = Math.floor(img.height / rows);
            const zip = new window.JSZip();
            for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) {
                canvas.width = tw;
                canvas.height = th;
                ctx.clearRect(0, 0, tw, th);
                ctx.drawImage(img, c * tw, r * th, tw, th, 0, 0, tw, th);
                const tileBlob = await new Promise((res) => canvas.toBlob(res, "image/png"));
                zip.file(`${base}_r${r + 1}_c${c + 1}.png`, tileBlob);
              }
            }
            const zblob = await zip.generateAsync({ type: "blob" });
            out.innerHTML = downloadResultCardHtml(zblob, `${base}_tiles.zip`, f.size);
            return;
          }

          if (tool.op === "crop") {
            const xp = Number(document.getElementById("c-x").value) / 100;
            const yp = Number(document.getElementById("c-y").value) / 100;
            const wp = Number(document.getElementById("c-w").value) / 100;
            const hp = Number(document.getElementById("c-h").value) / 100;
            const sx = Math.round(img.width * xp);
            const sy = Math.round(img.height * yp);
            const sw = Math.max(10, Math.min(img.width - sx, Math.round(img.width * wp)));
            const sh = Math.max(10, Math.min(img.height - sy, Math.round(img.height * hp)));
            canvas.width = sw;
            canvas.height = sh;
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
          } else if (tool.op === "round" || tool.op === "profile") {
            const side = Math.min(img.width, img.height);
            canvas.width = side;
            canvas.height = side;
            const ringPx = tool.op === "profile" ? Number(document.getElementById("c-ring-px").value) : 0;
            const ringCol = tool.op === "profile" ? document.getElementById("c-ring-color").value : "#ffffff";
            ctx.save();
            ctx.beginPath();
            ctx.arc(side / 2, side / 2, side / 2 - ringPx / 2, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, side, side);
            ctx.restore();
            if (ringPx > 0) {
              ctx.beginPath();
              ctx.arc(side / 2, side / 2, side / 2 - ringPx / 2, 0, Math.PI * 2);
              ctx.lineWidth = ringPx;
              ctx.strokeStyle = ringCol;
              ctx.stroke();
            }
          } else if (tool.op === "rotate_flip") {
            const mode = document.getElementById("c-rot").value;
            if (mode === "90" || mode === "270") {
              canvas.width = img.height;
              canvas.height = img.width;
              ctx.translate(canvas.width / 2, canvas.height / 2);
              ctx.rotate((Number(mode) * Math.PI) / 180);
              ctx.drawImage(img, -img.width / 2, -img.height / 2);
            } else if (mode === "180") {
              canvas.width = img.width;
              canvas.height = img.height;
              ctx.translate(canvas.width / 2, canvas.height / 2);
              ctx.rotate(Math.PI);
              ctx.drawImage(img, -img.width / 2, -img.height / 2);
            } else {
              canvas.width = img.width;
              canvas.height = img.height;
              ctx.translate(mode === "fliph" ? img.width : 0, mode === "flipv" ? img.height : 0);
              ctx.scale(mode === "fliph" ? -1 : 1, mode === "flipv" ? -1 : 1);
              ctx.drawImage(img, 0, 0);
            }
          } else if (tool.op === "bw") {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.filter = "grayscale(100%)";
            ctx.drawImage(img, 0, 0);
          } else if (tool.op === "pixelate") {
            const blk = Number(document.getElementById("c-pix").value);
            canvas.width = img.width;
            canvas.height = img.height;
            const sw = Math.max(4, Math.floor(img.width / blk));
            const sh = Math.max(4, Math.floor(img.height / blk));
            const tmp = document.createElement("canvas");
            tmp.width = sw;
            tmp.height = sh;
            tmp.getContext("2d").drawImage(img, 0, 0, sw, sh);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(tmp, 0, 0, sw, sh, 0, 0, img.width, img.height);
          } else if (tool.op === "meme" || tool.op === "add_text") {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            const top = document.getElementById("c-top-txt").value;
            const bot = document.getElementById("c-bot-txt")?.value || "";
            const fsz = tool.op === "meme" ? Math.max(24, Math.round(img.width * 0.08)) : Number(document.getElementById("c-txt-sz").value);
            ctx.font = `900 ${fsz}px Impact, Inter, sans-serif`;
            ctx.textAlign = "center";
            ctx.lineWidth = Math.max(3, fsz / 10);
            ctx.strokeStyle = "#000000";
            ctx.fillStyle = tool.op === "meme" ? "#ffffff" : document.getElementById("c-txt-col").value;
            if (top) {
              ctx.strokeText(top, img.width / 2, fsz + 14);
              ctx.fillText(top, img.width / 2, fsz + 14);
            }
            if (bot) {
              ctx.strokeText(bot, img.width / 2, img.height - 20);
              ctx.fillText(bot, img.width / 2, img.height - 20);
            }
          } else if (tool.op === "svg_to_png") {
            canvas.width = img.width || 1024;
            canvas.height = img.height || 1024;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          }

          canvas.toBlob((blob) => {
            const objUrl = URL.createObjectURL(blob);
            out.innerHTML = downloadResultCardHtml(blob, `${base}_${tool.op}.png`, f.size, objUrl);
          }, "image/png");
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(f);
    });
  }

  function mountCollageOrCombineTool(bodyEl, tool) {
    bodyEl.innerHTML = `
      <div class="space-y-3">
        <label class="flex flex-col items-center justify-center w-full h-24 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 cursor-pointer">
          <span class="text-xs font-bold text-slate-800 dark:text-slate-200">Select 2 to 6 images</span>
          <span id="col-lbl" class="text-[10px] text-slate-400 mt-0.5">Combines locally via HTML5 Canvas</span>
          <input id="col-files" type="file" accept="image/*" multiple class="hidden" />
        </label>
        <select id="col-layout" class="w-full rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 text-xs">
          <option value="grid">2-Column Collage Grid</option>
          <option value="horizontal">Combine Side-by-Side (Horizontal)</option>
          <option value="vertical">Combine Stacked (Vertical)</option>
        </select>
        <button id="col-go-btn" class="w-full py-3 rounded-2xl skin-bg text-white text-xs font-bold skin-shadow" disabled>Build Image</button>
        <div id="col-out"></div>
      </div>`;

    const input = document.getElementById("col-files");
    const btn = document.getElementById("col-go-btn");
    const out = document.getElementById("col-out");
    input.addEventListener("change", () => {
      document.getElementById("col-lbl").textContent = `${input.files.length} image(s) selected`;
      btn.disabled = input.files.length < 2;
    });
    btn.addEventListener("click", async () => {
      out.innerHTML = loadingSpinnerHtml("Stitching images together...");
      const files = Array.from(input.files).slice(0, 6);
      const totalBytes = files.reduce((s, f) => s + f.size, 0);
      const imgs = await Promise.all(
        files.map((f) => new Promise((res) => {
          const im = new Image();
          im.onload = () => res(im);
          im.src = URL.createObjectURL(f);
        }))
      );
      const layout = document.getElementById("col-layout").value;
      const c = document.createElement("canvas");
      const ctx = c.getContext("2d");
      const cell = 600;
      if (layout === "horizontal") {
        c.width = cell * imgs.length;
        c.height = cell;
        imgs.forEach((im, idx) => ctx.drawImage(im, idx * cell, 0, cell, cell));
      } else if (layout === "vertical") {
        c.width = cell;
        c.height = cell * imgs.length;
        imgs.forEach((im, idx) => ctx.drawImage(im, 0, idx * cell, cell, cell));
      } else {
        const cols = 2;
        const rows = Math.ceil(imgs.length / 2);
        c.width = cols * cell;
        c.height = rows * cell;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, c.width, c.height);
        imgs.forEach((im, idx) => {
          const r = Math.floor(idx / 2);
          const col = idx % 2;
          ctx.drawImage(im, col * cell + 8, r * cell + 8, cell - 16, cell - 16);
        });
      }
      c.toBlob((blob) => {
        out.innerHTML = downloadResultCardHtml(blob, `${tool.op}.png`, totalBytes, URL.createObjectURL(blob));
      }, "image/png");
    });
  }

  function mountWhatsAppBridgeInfo(bodyEl) {
    bodyEl.innerHTML = `
      <div class="space-y-3">
        <div class="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-slate-700 dark:text-slate-300 space-y-1.5">
          <p class="font-bold text-emerald-800 dark:text-emerald-300">Android App Native Bridge</p>
          <p>WhatsApp Status Saver reads local device statuses natively inside the Android App container via <code>window.AndroidInterface.openStatusSaver()</code>.</p>
          <p class="text-[11px] opacity-80">Yeh feature sirf Android App mein chalta hai (standard browser phone files access nahi kar sakta).</p>
        </div>
        <button id="wa-retry-btn" class="w-full py-3 rounded-2xl skin-bg text-white text-xs font-bold skin-shadow">Open WhatsApp Status Saver</button>
      </div>`;
    document.getElementById("wa-retry-btn").addEventListener("click", () => {
      if (window.AndroidInterface && typeof window.AndroidInterface.openStatusSaver === "function") {
        window.AndroidInterface.openStatusSaver();
      } else {
        showToast("Open inside the Android App to access local WhatsApp Statuses");
      }
    });
  }

  // ==========================================================================
  // BACKEND API TOOLS (FastAPI ON HUGGING FACE SPACES)
  // ==========================================================================
  function mountVideoDownloader(bodyEl, prefillUrl = "") {
    bodyEl.innerHTML = `
      <div class="space-y-3">
        <p class="rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Free limit: up to 10 minutes, 720p, and 100 MB per video.</p>
        <div class="flex gap-2">
          <input id="v-url-in" type="url" value="${escapeHtml(prefillUrl)}" placeholder="Paste YouTube, TikTok, IG Reels, FB, X link..." class="flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-xs text-slate-900 dark:text-white" />
          <button id="v-paste-btn" class="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-xs font-bold">Paste</button>
        </div>
        <button id="v-fetch-btn" class="w-full py-3 rounded-2xl skin-bg text-white text-xs font-bold skin-shadow">Fetch HD Video Links</button>
        <div id="v-out"></div>
      </div>`;

    const urlIn = document.getElementById("v-url-in");
    const out = document.getElementById("v-out");
    document.getElementById("v-paste-btn").addEventListener("click", async () => {
      const c = await readClipboardUrl();
      if (c) urlIn.value = c;
    });

    async function runFetch() {
      const u = urlIn.value.trim();
      if (!/^https?:\/\/.+/i.test(u)) { out.innerHTML = errorBoxHtml("Please enter a valid http/https video link."); return; }
      out.innerHTML = loadingSpinnerHtml("Extracting HD video formats via yt-dlp...");
      let data = null;
      let apiError = "";
      if (getApiBase() || !location.hostname.endsWith(".pages.dev")) {
        try {
          const res = await fetch(apiEndpoint("/api/video-download"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: u, max_resolution: "720p" }),
            signal: AbortSignal.timeout(90000),
          });
          if (res.ok) data = await res.json();
          else {
            const err = await res.json().catch(() => ({}));
            apiError = typeof err.detail === "string" ? err.detail.slice(0, 240) : `API request failed (${res.status}).`;
          }
        } catch (_) { apiError = "The video API could not be reached."; }
      }
      if (!data) data = await tryKeylessVideoFallback(u);
      if (!data) {
        out.innerHTML = errorBoxHtml(apiError || "Could not fetch this video. It may be private, region-restricted, or unsupported by the source.");
        return;
      }
      out.innerHTML = `
        <div class="space-y-2.5">
          <div class="flex gap-2.5 items-center p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800">
            ${data.thumbnail ? `<img src="${escapeHtml(data.thumbnail)}" class="w-20 h-14 rounded-lg object-cover shrink-0" alt="thumb" />` : ""}
            <div class="min-w-0">
              <div class="text-xs font-bold text-slate-900 dark:text-white truncate">${escapeHtml(data.title || "Video Ready")}</div>
              <div class="text-[11px] text-slate-500">${escapeHtml(data.platform || "Video")} • ${escapeHtml(data.duration || "HD")}</div>
            </div>
          </div>
          <div class="grid grid-cols-1 gap-2">
            ${(data.direct_480p_url || data.standard_url) ? `<button data-dl="${escapeHtml(data.direct_480p_url || data.standard_url)}" data-q="${Number(data.standard_quality) || 480}p" class="v-tier-btn w-full py-2.5 px-3 rounded-xl bg-blue-600 text-white text-xs font-bold flex justify-between"><span>${data.direct_480p_url ? `${Number(data.standard_quality) || 480}p Direct MP4` : "480p Standard MP4"}</span><span>Download ↓</span></button>` : ""}
            ${(data.direct_720p_url || data.clean_hd_url) ? `<button data-dl="${escapeHtml(data.direct_720p_url || data.clean_hd_url)}" data-q="${Number(data.hd_quality) || 720}p" class="v-tier-btn w-full py-2.5 px-3 rounded-xl bg-emerald-600 text-white text-xs font-bold flex justify-between"><span>${data.direct_720p_url ? `${Number(data.hd_quality) || 720}p Direct MP4` : "Up to 720p HD MP4"}</span><span>Download ↓</span></button>` : ""}
          </div>
        </div>`;

      out.querySelectorAll(".v-tier-btn").forEach((b) => {
        b.addEventListener("click", () => {
          const dl = b.getAttribute("data-dl");
          const q = b.getAttribute("data-q");
          triggerDirectDownload(dl, `video_${q}.mp4`);
        });
      });
    }

    document.getElementById("v-fetch-btn").addEventListener("click", runFetch);
    if (prefillUrl) runFetch();  }

  function mountImageDownloader(bodyEl, prefillUrl = "") {
    bodyEl.innerHTML = `
      <div class="space-y-3">
        <div class="flex gap-2">
          <input id="im-url-in" type="url" value="${escapeHtml(prefillUrl)}" placeholder="Instagram, Pinterest, Unsplash, Pexels, Pixabay, Freepik..." class="flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-xs text-slate-900 dark:text-white" />
          <button id="im-paste-btn" class="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-xs font-bold">Paste</button>
        </div>
        <button id="im-fetch-btn" class="w-full py-3 rounded-2xl skin-bg text-white text-xs font-bold skin-shadow">Extract HD Photos</button>
        <div id="im-out"></div>
      </div>`;

    const urlIn = document.getElementById("im-url-in");
    const out = document.getElementById("im-out");
    document.getElementById("im-paste-btn").addEventListener("click", async () => {
      const c = await readClipboardUrl();
      if (c) urlIn.value = c;
    });

    async function runFetch() {
      const u = urlIn.value.trim();
      if (!/^https?:\/\/.+/i.test(u)) { out.innerHTML = errorBoxHtml("Please enter a valid http/https image link."); return; }
      out.innerHTML = loadingSpinnerHtml("Scraping HD images via gallery-dl...");
      try {
        ensureBackendUrlConfigured();
        const res = await fetch(apiEndpoint("/api/image-download"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: u }),
          signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.detail || `HTTP ${res.status}`);
        }
        const data = await res.json();
        const zipBtnHtml = data.images.length > 1
          ? `<button id="im-zip-btn" class="w-full mb-2.5 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold">Download All ${data.images.length} Photos as ZIP ↓</button>`
          : "";
        out.innerHTML = `${zipBtnHtml}<div class="grid grid-cols-2 gap-2">${data.images.map((im, i) => `
          <div class="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
            <img src="${escapeHtml(im.download_url || im.url)}" class="w-full h-32 object-cover" loading="lazy" alt="HD ${i + 1}" />
            <button data-dl="${escapeHtml(im.download_url || im.url)}" data-fn="${escapeHtml(im.filename || `photo_${i + 1}.jpg`)}" class="im-dl-btn w-full py-1.5 text-[11px] font-bold skin-bg text-white">Save ↓</button>
          </div>`).join("")}</div>`;
        out.querySelectorAll(".im-dl-btn").forEach((b) => {
          b.addEventListener("click", () => triggerDirectDownload(b.getAttribute("data-dl"), b.getAttribute("data-fn")));
        });
        const zipBtn = document.getElementById("im-zip-btn");
        if (zipBtn) {
          zipBtn.addEventListener("click", async () => {
            zipBtn.disabled = true;
            zipBtn.textContent = "Packing ZIP...";
            try {
              const zr = await fetch(apiEndpoint("/api/images/download-zip"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ urls: data.images.map((x) => x.url), archive_name: "allmedia_album" }),
              });
              if (!zr.ok) throw new Error("ZIP creation failed");
              downloadBlob(await zr.blob(), "allmedia_album.zip");
            } catch (e) {
              showToast(e.message);
            } finally {
              zipBtn.disabled = false;
              zipBtn.textContent = `Download All ${data.images.length} Photos as ZIP ↓`;
            }
          });
        }
      } catch (err) {
        out.innerHTML = errorBoxHtml(err.message);
      }
    }

    document.getElementById("im-fetch-btn").addEventListener("click", runFetch);
    if (prefillUrl) runFetch();
  }

  function mountThumbDpSaver(bodyEl, prefillUrl = "") {
    bodyEl.innerHTML = `
      <div class="space-y-3">
        <input id="td-in" type="text" value="${escapeHtml(prefillUrl)}" placeholder="Paste YouTube link or Instagram @username..." class="w-full rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-xs text-slate-900 dark:text-white" />
        <button id="td-btn" class="w-full py-3 rounded-2xl skin-bg text-white text-xs font-bold skin-shadow">Fetch HD Thumbnail / DP</button>
        <div id="td-out"></div>
      </div>`;

    const out = document.getElementById("td-out");
    async function runFetch() {
      const raw = document.getElementById("td-in").value.trim();
      if (!raw) { out.innerHTML = errorBoxHtml("Paste a YouTube link or @username."); return; }
      out.innerHTML = loadingSpinnerHtml("Fetching HD Thumbnail / DP...");
      try {
        const yt = raw.match(/(?:youtube\.com\/watch\?.*?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
        let items = null;
        if (getApiBase() || !location.hostname.endsWith(".pages.dev")) {
          try {
            const res = await fetch(apiEndpoint("/thumbnail-dp"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: raw }),
            });
            if (res.ok) items = (await res.json()).items;
          } catch (_) {}
        }
        if (!items && yt) {
          items = [
            { label: "MaxRes HD (1280x720)", url: `https://i.ytimg.com/vi/${yt[1]}/maxresdefault.jpg`, filename: `yt_${yt[1]}_hd.jpg` },
            { label: "HQ (480x360)", url: `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg`, filename: `yt_${yt[1]}_hq.jpg` },
          ];
        }
        if (!items || !items.length) throw new Error("Connect the All Media Tools API to load Instagram profile pictures.");
        out.innerHTML = `<div class="grid grid-cols-2 gap-2">${items.map((it) => `
          <div class="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
            <img src="${escapeHtml(it.download_url || it.url)}" class="w-full h-28 object-cover" alt="${escapeHtml(it.label)}" />
            <button data-dl="${escapeHtml(it.download_url || it.url)}" data-fn="${escapeHtml(it.filename || "thumb.jpg")}" class="td-dl-btn w-full py-1.5 text-[11px] font-bold skin-bg text-white">${escapeHtml(it.label)} ↓</button>
          </div>`).join("")}</div>`;
        out.querySelectorAll(".td-dl-btn").forEach((b) => {
          b.addEventListener("click", () => triggerDirectDownload(b.getAttribute("data-dl"), b.getAttribute("data-fn")));
        });
      } catch (err) {
        out.innerHTML = errorBoxHtml(err.message);
      }
    }
    document.getElementById("td-btn").addEventListener("click", runFetch);
    if (prefillUrl) runFetch();
  }

  function mountYoutubeTranscript(bodyEl, prefillUrl = "") {
    bodyEl.innerHTML = `
      <div class="space-y-3">
        <input id="tr-url" type="url" value="${escapeHtml(prefillUrl)}" placeholder="Paste YouTube video link..." class="w-full rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-xs text-slate-900 dark:text-white" />
        <button id="tr-go" class="w-full py-3 rounded-2xl skin-bg text-white text-xs font-bold skin-shadow">Extract Transcript</button>
        <div id="tr-out"></div>
      </div>`;
    document.getElementById("tr-go").addEventListener("click", async () => {
      const u = document.getElementById("tr-url").value.trim();
      const out = document.getElementById("tr-out");
      if (!/^https?:\/\/.+/i.test(u)) { out.innerHTML = errorBoxHtml("Enter valid YouTube link."); return; }
      out.innerHTML = loadingSpinnerHtml("Fetching video subtitles...");
      try {
        ensureBackendUrlConfigured();
        const res = await fetch(apiEndpoint("/api/youtube-transcript"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: u }),
          signal: AbortSignal.timeout(60000),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.detail || "Transcript unavailable.");
        out.innerHTML = `<textarea rows="6" class="w-full rounded-xl bg-slate-100 dark:bg-slate-800 p-2.5 text-xs">${escapeHtml(j.transcript)}</textarea>`;
        const blob = new Blob([j.transcript], { type: "text/plain" });
        out.innerHTML += `<div class="mt-2">${downloadResultCardHtml(blob, "transcript.txt")}</div>`;
      } catch (err) {
        out.innerHTML = errorBoxHtml(err.message);
      }
    });
  }

  function mountVideoConvert(bodyEl, tool, prefillUrl = "") {
    let extra = "";
    if (tool.action === "mp4_to_mp3" || tool.action === "extract_audio") {
      extra = `<input id="vc-url" type="url" value="${escapeHtml(prefillUrl)}" placeholder="Or paste video link for MP3 extraction..." class="w-full rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs" /><select id="vc-bitrate" class="w-full rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 text-xs"><option value="128k">128 kbps</option><option value="192k" selected>192 kbps (HD)</option><option value="320k">320 kbps (Max)</option></select>`;
    } else if (tool.action === "trim_video") {
      extra = `<div class="flex gap-2 text-xs"><input id="vc-start" type="number" min="0" value="0" placeholder="Start (sec)" class="flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 border p-2" /><input id="vc-end" type="number" min="1" value="10" placeholder="End (sec)" class="flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 border p-2" /></div>`;
    } else if (tool.action === "resize_video") {
      extra = `<select id="vc-width" class="w-full rounded-xl bg-slate-100 dark:bg-slate-800 border p-2 text-xs"><option value="1280">720p HD (1280w)</option><option value="854">480p (854w)</option><option value="640">360p Compact (640w)</option></select>`;
    } else if (tool.action === "compress_video") {
      extra = `<select id="vc-preset" class="w-full rounded-xl bg-slate-100 dark:bg-slate-800 border p-2 text-xs"><option value="light">Light Compression (HD)</option><option value="balanced" selected>Balanced (720p)</option><option value="max">Maximum Shrink (WhatsApp)</option></select>`;
    }

    bodyEl.innerHTML = `
      <div class="space-y-3">
        <label class="flex flex-col items-center justify-center w-full h-24 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 cursor-pointer">
          <span class="text-xs font-bold text-slate-800 dark:text-slate-200">Select video file</span>
          <span id="vc-file-lbl" class="text-[10px] text-slate-400 mt-0.5">FFmpeg cloud converter</span>
          <input id="vc-file-in" type="file" accept="video/*" class="hidden" />
        </label>
        ${extra}
        <button id="vc-go-btn" class="w-full py-3 rounded-2xl skin-bg text-white text-xs font-bold skin-shadow">Convert via FFmpeg</button>
        <div id="vc-out"></div>
      </div>`;

    const fileIn = document.getElementById("vc-file-in");
    const out = document.getElementById("vc-out");
    fileIn.addEventListener("change", () => {
      const f = fileIn.files[0];
      document.getElementById("vc-file-lbl").textContent = f ? `${f.name} (${formatBytes(f.size)})` : "Select video file";
    });

    document.getElementById("vc-go-btn").addEventListener("click", async () => {
      const f = fileIn.files[0];
      const urlVal = document.getElementById("vc-url")?.value.trim() || "";
      if (!f && !urlVal) { out.innerHTML = errorBoxHtml("Upload a video file (or paste link for MP3)."); return; }
      out.innerHTML = loadingSpinnerHtml(`Converting (${tool.name}) via FFmpeg… may take 20–60 s on first use.`);
      try {
        ensureBackendUrlConfigured();
        const form = new FormData();
        form.append("action", tool.action);
        if (f) form.append("file", f);
        if (urlVal) form.append("url", urlVal);
        if (document.getElementById("vc-bitrate")) form.append("bitrate", document.getElementById("vc-bitrate").value);
        if (document.getElementById("vc-start")) form.append("start_sec", document.getElementById("vc-start").value);
        if (document.getElementById("vc-end")) form.append("end_sec", document.getElementById("vc-end").value);
        if (document.getElementById("vc-width")) form.append("width", document.getElementById("vc-width").value);
        if (document.getElementById("vc-preset")) form.append("preset", document.getElementById("vc-preset").value);

        const res = await fetch(apiEndpoint("/api/video-convert"), { method: "POST", body: form, signal: AbortSignal.timeout(120000) });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.detail || `Conversion failed (${res.status})`);
        }
        const blob = await res.blob();
        const fname = parseDispositionFilename(res, `output_${tool.action}`);
        out.innerHTML = downloadResultCardHtml(blob, fname, f ? f.size : null);
      } catch (err) {
        out.innerHTML = errorBoxHtml(err.message);
      }
    });
    if (prefillUrl) document.getElementById("vc-go-btn").click();
  }

  function mountBgRemover(bodyEl, tool) {
    let extra = "";
    if (tool.action === "change_color") {
      extra = `<label class="flex items-center gap-2 text-xs font-semibold">Background Color: <input id="bg-col" type="color" value="#2563eb" /></label>`;
    } else if (tool.action === "blur") {
      extra = `<label class="flex items-center gap-2 text-xs font-semibold">Blur Strength: <input id="bg-blur" type="range" min="4" max="30" value="14" class="flex-1" /></label>`;
    }
    bodyEl.innerHTML = `
      <div class="space-y-3">
        <label class="flex flex-col items-center justify-center w-full h-24 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 cursor-pointer">
          <span class="text-xs font-bold text-slate-800 dark:text-slate-200">Tap to upload photo</span>
          <span id="bg-lbl" class="text-[10px] text-slate-400 mt-0.5">JPG, PNG, or WebP · max 5 MB · max 8 MP</span>
          <input id="bg-in" type="file" accept="image/*" class="hidden" />
        </label>
        ${extra}
        <button id="bg-go" class="w-full py-3 rounded-2xl skin-bg text-white text-xs font-bold skin-shadow" disabled>Process Background (Free)</button>
        <div id="bg-out"></div>
      </div>`;

    const fileIn = document.getElementById("bg-in");
    const btn = document.getElementById("bg-go");
    const out = document.getElementById("bg-out");
    let processing = false;
    let fileValidated = false;
    let invalidFile = false;
    fileIn.addEventListener("change", () => {
      const f = fileIn.files[0];
      const tooLarge = Boolean(f && f.size > 5 * 1024 * 1024);
      const supportedType = !f || ["image/jpeg", "image/png", "image/webp"].includes(f.type);
      fileValidated = false;
      invalidFile = !f || tooLarge || !supportedType;
      document.getElementById("bg-lbl").textContent = f ? `${f.name} (${formatBytes(f.size)})` : "JPG, PNG, or WebP · max 5 MB · max 8 MP";
      btn.disabled = true;
      out.innerHTML = tooLarge
        ? errorBoxHtml("Background removal accepts images up to 5 MB and 8 megapixels on the free server. Please choose a smaller image.")
        : !supportedType ? errorBoxHtml("Use a JPG, PNG, or WebP image.") : "";
      if (!f || tooLarge || !supportedType) return;

      const objectUrl = URL.createObjectURL(f);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        if (fileIn.files[0] !== f) return;
        const tooManyPixels = image.naturalWidth * image.naturalHeight > 8_000_000;
        fileValidated = true;
        invalidFile = tooManyPixels;
        btn.disabled = processing || invalidFile;
        if (tooManyPixels) out.innerHTML = errorBoxHtml("This free server accepts images up to 8 megapixels. Please choose a smaller image.");
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        if (fileIn.files[0] === f) {
          fileValidated = true;
          invalidFile = true;
          btn.disabled = true;
          out.innerHTML = errorBoxHtml("Could not read this image. Choose a valid JPG, PNG, or WebP file.");
        }
      };
      image.src = objectUrl;
    });

    btn.addEventListener("click", () => {
      const f = fileIn.files[0];
      if (!f || processing || btn.disabled) return;
      processing = true;
      btn.disabled = true;
      fileIn.disabled = true;
      window.triggerRewardedAd(tool.name, async () => {
        out.innerHTML = loadingSpinnerHtml("Connecting to the free server. If idle, waking can take about a minute.");
        try {
          ensureBackendUrlConfigured();
          const health = await fetch(apiEndpoint("/api/health"), {
            cache: "no-store",
            signal: AbortSignal.timeout(120000),
          });
          if (!health.ok) throw new Error("The free server is still starting. Wait a minute, then try again.");
          out.innerHTML = loadingSpinnerHtml("Server ready. Removing the background; the first request may take longer.");
          const form = new FormData();
          form.append("file", f);
          form.append("action", tool.action || "remove");
          if (document.getElementById("bg-col")) form.append("bg_color", document.getElementById("bg-col").value);
          if (document.getElementById("bg-blur")) form.append("blur_radius", document.getElementById("bg-blur").value);

          const res = await fetch(apiEndpoint("/api/bg-remove"), {
            method: "POST",
            body: form,
            signal: AbortSignal.timeout(180000),
          });
          if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            throw new Error(e.detail || "BG removal failed.");
          }
          const blob = await res.blob();
          const objUrl = URL.createObjectURL(blob);
          out.innerHTML = downloadResultCardHtml(blob, `${f.name.replace(/\.[^.]+$/, "")}_${tool.action}.png`, f.size, objUrl);
        } catch (err) {
          const msg = err.name === "TimeoutError"
            ? "The free server took too long to wake or process this image. Your file is still selected; wait a minute and try again."
            : err.message;
          out.innerHTML = errorBoxHtml(msg);
        } finally {
          processing = false;
          fileIn.disabled = false;
          const currentFile = fileIn.files[0];
          btn.disabled = !currentFile || !fileValidated || invalidFile || currentFile.size > 5 * 1024 * 1024;
        }
      }, (msg) => {
        processing = false;
        fileIn.disabled = false;
        btn.disabled = !fileIn.files[0] || !fileValidated || invalidFile || fileIn.files[0].size > 5 * 1024 * 1024;
        out.innerHTML = errorBoxHtml(msg);
      });
    });
  }


  function mountUpscaleAiTool(bodyEl, tool) {
    bodyEl.innerHTML = `<div class="space-y-4">
      <div class="upload-zone rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 p-8 text-center cursor-pointer hover:border-blue-400 transition-colors" id="upscale-drop">
        <div class="text-4xl mb-3">🔍</div>
        <p class="font-semibold text-slate-700 dark:text-slate-200 mb-1">Drop image here or click to upload</p>
        <p class="text-sm text-slate-500 dark:text-slate-400">JPG, PNG, WEBP — max 10 MB</p>
        <input id="upscale-file" type="file" accept="image/*" class="hidden" />
      </div>      <div class="flex items-center gap-3">
        <span class="text-sm font-medium text-slate-600 dark:text-slate-300">Upscale factor:</span>
        <label class="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" name="upscale-factor" value="2" checked class="accent-blue-500" />
          <span class="text-sm">2× (faster)</span>
        </label>
        <label class="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" name="upscale-factor" value="4" class="accent-blue-500" />          <span class="text-sm">4× (best quality)</span>
        </label>
      </div>
      <div id="upscale-out"></div>
    </div>`;

    const dropZone = bodyEl.querySelector("#upscale-drop");
    const fileInput = bodyEl.querySelector("#upscale-file");
    const out = bodyEl.querySelector("#upscale-out");

    dropZone.addEventListener("click", () => fileInput.click());
    dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("border-blue-400"); });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("border-blue-400"));
    dropZone.addEventListener("drop", e => { e.preventDefault(); dropZone.classList.remove("border-blue-400"); if (e.dataTransfer.files[0]) processUpscale(e.dataTransfer.files[0]); });
    fileInput.addEventListener("change", () => { if (fileInput.files[0]) processUpscale(fileInput.files[0]); });

    async function processUpscale(file) {
      const scale = bodyEl.querySelector("input[name='upscale-factor']:checked")?.value || "2";
      out.innerHTML = loadingSpinnerHtml(`Upscaling ${scale}x with AI… this may take 15–30 s on cold start`);
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("scale", scale);
        const res = await fetch(apiEndpoint("/api/upscale-ai"), { method: "POST", body: form, signal: AbortSignal.timeout(90000) });
        if (!res.ok) { const e = await res.json().catch(() => ({})); out.innerHTML = `<p class="text-red-500 text-sm">${e.detail || "Upscaling failed."}</p>`; return; }
        const blob = await res.blob();
        const outW = res.headers.get("X-Output-Width") || "";
        const outH = res.headers.get("X-Output-Height") || "";
        const url = URL.createObjectURL(blob);
        const ext = blob.type === "image/png" ? "png" : "jpg";
        out.innerHTML = `<div class="space-y-3">
          <img src="${url}" class="max-w-full rounded-xl border border-slate-200 dark:border-slate-700 shadow" />
          ${outW ? `<p class="text-xs text-slate-500 dark:text-slate-400 text-center">Output: ${outW} × ${outH} px</p>` : ""}
          <a href="${url}" download="upscaled_${scale}x.${ext}" class="btn-primary flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors no-underline">
            ⬇️ Download ${scale}× Upscaled Image
          </a>
        </div>`;
      } catch (err) {
        out.innerHTML = `<p class="text-red-500 text-sm">${err.name === "TimeoutError" ? "Request timed out. Try a smaller image or 2× scale." : "Something went wrong. Please try again."}</p>`;
      }
    }
  }

  function mountOcrTool(bodyEl, tool) {
    bodyEl.innerHTML = `
      <div class="space-y-3">
        <div class="upload-zone rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 p-5 text-center cursor-pointer hover:border-blue-400 transition-colors" id="ocr-drop">
          <div class="text-3xl mb-2">📄</div>
          <p class="text-xs font-semibold text-slate-500 dark:text-slate-400">Drop an image here, or click to upload</p>
          <p class="text-[10px] text-slate-400 mt-1">JPG, PNG, WebP, HEIC — up to 20 MB</p>
          <input id="ocr-file" type="file" accept="image/*" class="hidden" />
        </div>
        <div id="ocr-out"></div>
      </div>`;
    const dropZone = bodyEl.querySelector("#ocr-drop");
    const fileInput = bodyEl.querySelector("#ocr-file");
    const out = bodyEl.querySelector("#ocr-out");
    dropZone.addEventListener("click", () => fileInput.click());
    dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("border-blue-400"); });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("border-blue-400"));
    dropZone.addEventListener("drop", (e) => { e.preventDefault(); dropZone.classList.remove("border-blue-400"); if (e.dataTransfer.files[0]) processOcr(e.dataTransfer.files[0]); });
    fileInput.addEventListener("change", () => { if (fileInput.files[0]) processOcr(fileInput.files[0]); });

    async function processOcr(file) {
      out.innerHTML = loadingSpinnerHtml("Extracting text… may take 10–20 s on first use.");
      const form = new FormData();
      form.append("file", file);
      try {
        const res = await fetch(apiEndpoint("/api/ocr"), { method: "POST", body: form, signal: AbortSignal.timeout(60000) });
        const json = await res.json();
        if (!res.ok) { out.innerHTML = errorBoxHtml(json.detail || "OCR failed."); return; }
        if (!json.text) { out.innerHTML = errorBoxHtml(json.message || "No text found in this image."); return; }
        out.innerHTML = `
          <div class="rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-slate-700 dark:text-slate-200">Extracted Text</span>
              <span class="text-[10px] text-slate-400">${json.word_count} words · ${json.char_count} chars</span>
            </div>
            <textarea readonly class="w-full text-xs text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 h-40 resize-none font-mono leading-relaxed">${escapeHtml(json.text)}</textarea>
            <button onclick="navigator.clipboard.writeText(${JSON.stringify(json.text)}).then(()=>this.textContent='Copied!').catch(()=>{})" class="w-full py-2.5 rounded-xl skin-bg text-white text-xs font-bold skin-shadow">Copy Text</button>
          </div>`;
      } catch(e) { out.innerHTML = errorBoxHtml(e.name === "TimeoutError" ? "OCR timed out. Try a smaller image." : "Network error."); }
    }
  }

  function mountWatermarkCanvasTool(bodyEl, tool) {
    bodyEl.innerHTML = `
      <div class="space-y-3">
        <label class="flex flex-col items-center justify-center w-full h-24 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 cursor-pointer">
          <span class="text-xs font-bold text-slate-800 dark:text-slate-200">Upload photo to brush watermark / object</span>
          <span id="wm-lbl" class="text-[10px] text-slate-400 mt-0.5">OpenCV Inpainting</span>
          <input id="wm-in" type="file" accept="image/*" class="hidden" />
        </label>
        <div id="wm-editor" class="hidden space-y-2">
          <div class="flex items-center gap-2 text-xs">
            <span>Brush</span>
            <input id="wm-brush" type="range" min="8" max="60" value="22" class="flex-1" />
            <button id="wm-clear" class="px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 font-bold">Clear</button>
          </div>
          <div class="canvas-stage"><canvas id="wm-img-canvas"></canvas><canvas id="wm-mask-canvas"></canvas></div>
        </div>
        <button id="wm-go" class="w-full py-3 rounded-2xl skin-bg text-white text-xs font-bold skin-shadow" disabled>Erase Selected Area (Free)</button>
        <div id="wm-out"></div>
      </div>`;

    const fileIn = document.getElementById("wm-in");
    const editor = document.getElementById("wm-editor");
    const imgCanvas = document.getElementById("wm-img-canvas");
    const maskCanvas = document.getElementById("wm-mask-canvas");
    const imgCtx = imgCanvas.getContext("2d");
    const maskCtx = maskCanvas.getContext("2d");
    const goBtn = document.getElementById("wm-go");
    const out = document.getElementById("wm-out");
    let drawing = false;
    let hasStrokes = false;
    let loadedFile = null;

    fileIn.addEventListener("change", () => {
      const f = fileIn.files[0];
      if (!f) return;
      loadedFile = f;
      document.getElementById("wm-lbl").textContent = `${f.name} (${formatBytes(f.size)})`;
      const reader = new FileReader();
      reader.onload = (e) => {
        const im = new Image();
        im.onload = () => {
          const scale = Math.min(1, 1400 / Math.max(im.width, im.height));
          const w = Math.round(im.width * scale);
          const h = Math.round(im.height * scale);
          imgCanvas.width = w; imgCanvas.height = h;
          maskCanvas.width = w; maskCanvas.height = h;
          maskCtx.clearRect(0, 0, w, h);
          imgCtx.drawImage(im, 0, 0, w, h);
          hasStrokes = false;
          editor.classList.remove("hidden");
          goBtn.disabled = false;
        };
        im.src = e.target.result;
      };
      reader.readAsDataURL(f);
    });

    function coords(evt) {
      const r = maskCanvas.getBoundingClientRect();
      const cx = evt.touches ? evt.touches[0].clientX : evt.clientX;
      const cy = evt.touches ? evt.touches[0].clientY : evt.clientY;
      return { x: ((cx - r.left) / r.width) * maskCanvas.width, y: ((cy - r.top) / r.height) * maskCanvas.height };
    }
    function stroke(x, y) {
      const radius = Number(document.getElementById("wm-brush").value) * (maskCanvas.width / Math.max(maskCanvas.clientWidth, 1));
      maskCtx.fillStyle = "rgba(225, 29, 72, 0.78)";
      maskCtx.beginPath();
      maskCtx.arc(x, y, radius / 2, 0, Math.PI * 2);
      maskCtx.fill();
      hasStrokes = true;
    }
    maskCanvas.addEventListener("pointerdown", (e) => {
      maskCanvas.setPointerCapture?.(e.pointerId);
      drawing = true;
      const p = coords(e);
      stroke(p.x, p.y);
    });
    maskCanvas.addEventListener("pointermove", (e) => { if (!drawing) return; const p = coords(e); stroke(p.x, p.y); });
    maskCanvas.addEventListener("pointerup", () => { drawing = false; });
    maskCanvas.addEventListener("pointercancel", () => { drawing = false; });
    document.getElementById("wm-clear").addEventListener("click", () => { maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height); hasStrokes = false; });

    goBtn.addEventListener("click", () => {
      if (!loadedFile) return;
      if (!hasStrokes) { out.innerHTML = errorBoxHtml("Please brush red over the watermark area first."); return; }
      window.triggerRewardedAd(tool.name, async () => {
        out.innerHTML = loadingSpinnerHtml("Inpainting with OpenCV...");
        try {
          ensureBackendUrlConfigured();
          const imgBlob = await new Promise((r) => imgCanvas.toBlob(r, "image/png"));
          const maskExp = document.createElement("canvas");
          maskExp.width = maskCanvas.width; maskExp.height = maskCanvas.height;
          const mctx = maskExp.getContext("2d");
          mctx.fillStyle = "#000"; mctx.fillRect(0, 0, maskExp.width, maskExp.height);
          const sdata = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
          const odata = mctx.getImageData(0, 0, maskExp.width, maskExp.height);
          for (let i = 0; i < sdata.data.length; i += 4) {
            if (sdata.data[i + 3] > 10) { odata.data[i] = odata.data[i + 1] = odata.data[i + 2] = odata.data[i + 3] = 255; }
          }
          mctx.putImageData(odata, 0, 0);
          const mBlob = await new Promise((r) => maskExp.toBlob(r, "image/png"));

          const form = new FormData();
          form.append("image", imgBlob, loadedFile.name);
          form.append("mask", mBlob, "mask.png");
          const res = await fetch(apiEndpoint("/api/watermark-remove"), { method: "POST", body: form });
          if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || "Inpaint failed."); }
          const resBlob = await res.blob();
          out.innerHTML = downloadResultCardHtml(resBlob, `${loadedFile.name.replace(/\.[^.]+$/, "")}_clean.png`, loadedFile.size, URL.createObjectURL(resBlob));
        } catch (err) {
          out.innerHTML = errorBoxHtml(err.message);
        }
      }, (msg) => { out.innerHTML = errorBoxHtml(msg); });
    });
  }

  function mountBackendImageTool(bodyEl, tool) {
    // Bulk-capable actions: compress, resize, format conversions
    const bulkOk = ["compress","resize","png_to_jpg","jpg_to_png","jpg_to_webp","webp_to_jpg","webp_to_png","png_to_webp"].includes(tool.action);
    let extra = "";
    if (tool.action === "compress") {
      extra = `<label class="text-xs flex items-center gap-2">Quality: <input id="bi-q" type="range" min="20" max="95" value="75" class="flex-1" /></label>`;
    } else if (tool.action === "resize") {
      extra = `<input id="bi-w" type="number" value="1080" placeholder="Target width px" class="w-full rounded-xl bg-slate-100 dark:bg-slate-800 border p-2 text-xs" />`;
    }
    bodyEl.innerHTML = `
      <div class="space-y-3">
        <label class="flex flex-col items-center justify-center w-full h-24 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 cursor-pointer">
          <span class="text-xs font-bold text-slate-800 dark:text-slate-200">Select image${bulkOk ? "s" : ""} (${tool.name})</span>
          <span id="bi-lbl" class="text-[10px] text-slate-400 mt-0.5">${bulkOk ? "Up to 10 images at once · Pillow cloud engine" : "Pillow + HEIC cloud engine"}</span>
          <input id="bi-in" type="file" accept="image/*,.heic,.heif" ${bulkOk ? "multiple" : ""} class="hidden" />
        </label>
        ${extra}
        <button id="bi-go" class="w-full py-3 rounded-2xl skin-bg text-white text-xs font-bold skin-shadow" disabled>Process Image${bulkOk ? "s" : ""}</button>
        <div id="bi-out"></div>
      </div>`;

    const fileIn = document.getElementById("bi-in");
    const btn = document.getElementById("bi-go");
    const out = document.getElementById("bi-out");
    fileIn.addEventListener("change", () => {
      const n = fileIn.files.length;
      document.getElementById("bi-lbl").textContent = n > 1 ? `${n} images selected · will ZIP results` : n === 1 ? `${fileIn.files[0].name} (${formatBytes(fileIn.files[0].size)})` : (bulkOk ? "Up to 10 images at once" : "Select image");
      btn.disabled = n === 0;
      btn.textContent = n > 1 ? `Process All ${n} Images → ZIP` : `Process Image`;
    });
    btn.addEventListener("click", async () => {
      const files = Array.from(fileIn.files);
      if (!files.length) return;
      const isBulk = files.length > 1;
      out.innerHTML = loadingSpinnerHtml(isBulk ? `Processing ${files.length} images…` : `Running ${tool.name} via Pillow...`);
      try {
        ensureBackendUrlConfigured();
        const form = new FormData();
        form.append("action", tool.action);
        if (document.getElementById("bi-q")) form.append("quality", document.getElementById("bi-q").value);
        if (document.getElementById("bi-w")) form.append("width", document.getElementById("bi-w").value);
        let res;
        if (isBulk && bulkOk) {
          files.forEach(f => form.append("files", f));
          res = await fetch(apiEndpoint("/api/bulk-image"), { method: "POST", body: form, signal: AbortSignal.timeout(120000) });
        } else {
          form.append("file", files[0]);
          res = await fetch(apiEndpoint("/api/image-process"), { method: "POST", body: form, signal: AbortSignal.timeout(60000) });
        }
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || "Image processing failed."); }
        const blob = await res.blob();
        if (isBulk) {
          const processed = res.headers.get("X-Processed-Count") || files.length;
          const fname = `bulk_${tool.action}.zip`;
          const url = URL.createObjectURL(blob);
          out.innerHTML = `<div class="space-y-2 text-center">
            <div class="text-3xl">✅</div>
            <p class="text-sm font-bold text-slate-800 dark:text-slate-200">${processed} images processed!</p>
            <a href="${url}" download="${fname}" class="btn-primary flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors no-underline text-sm">⬇️ Download ZIP (${processed} files)</a>
          </div>`;
        } else {
          const fname = parseDispositionFilename(res, `output_${tool.action}.png`);
          const previewUrl = blob.type.startsWith("image/") ? URL.createObjectURL(blob) : null;
          out.innerHTML = downloadResultCardHtml(blob, fname, files[0].size, previewUrl);
        }
      } catch (err) {
        out.innerHTML = errorBoxHtml(err.message);
      }
    });
  }

  function mountBackendPdfTool(bodyEl, tool) {
    let extra = "";
    if (tool.action === "rotate") {
      extra = `<select id="pdf-ang" class="w-full rounded-xl bg-slate-100 dark:bg-slate-800 border p-2 text-xs"><option value="90">Rotate 90° Clockwise</option><option value="180">Rotate 180°</option><option value="270">Rotate 270°</option></select>`;
    } else if (tool.action === "rearrange" || tool.action === "delete_pages") {
      extra = `<input id="pdf-pages" type="text" placeholder="Page numbers e.g. ${tool.action === "rearrange" ? "3,1,2" : "2,4-5"}" class="w-full rounded-xl bg-slate-100 dark:bg-slate-800 border p-2 text-xs" />`;
    } else if (tool.action === "unlock" || tool.action === "protect") {
      extra = `<input id="pdf-pass" type="password" placeholder="${tool.action === "protect" ? "Create password to lock PDF" : "Enter PDF password"}" class="w-full rounded-xl bg-slate-100 dark:bg-slate-800 border p-2 text-xs" />`;
    } else if (tool.action === "watermark" || tool.action === "esign" || tool.action === "header_footer") {
      const ph = tool.action === "esign" ? "Type a name for the visible signature stamp" : tool.action === "header_footer" ? "Header & Footer text" : "Watermark text";
      extra = `<input id="pdf-wm" type="text" placeholder="${ph}" class="w-full rounded-xl bg-slate-100 dark:bg-slate-800 border p-2 text-xs" />`;
    } else if (tool.action === "text_to_pdf") {
      extra = `<textarea id="pdf-text" rows="5" placeholder="Paste text here (or upload a .txt file above)..." class="w-full rounded-xl bg-slate-100 dark:bg-slate-800 border p-2.5 text-xs"></textarea>`;
    }

    const isTextPdf = tool.action === "text_to_pdf";
    const accept = tool.action === "jpg_to_pdf" ? "image/*" : isTextPdf ? ".txt,text/plain" : "application/pdf";
    bodyEl.innerHTML = `
      <div class="space-y-3">
        <label class="flex flex-col items-center justify-center w-full h-24 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 cursor-pointer">          <span class="text-xs font-bold text-slate-800 dark:text-slate-200">${isTextPdf ? "Optional: Upload .TXT file" : tool.multi ? "Select multiple files" : "Select PDF file"}</span>
          <span id="pdf-lbl" class="text-[10px] text-slate-400 mt-0.5">PyPDF + PyMuPDF + ReportLab</span>
          <input id="pdf-in" type="file" accept="${accept}" ${tool.multi ? "multiple" : ""} class="hidden" />
        </label>
        ${extra}
        <button id="pdf-go" class="w-full py-3 rounded-2xl skin-bg text-white text-xs font-bold skin-shadow" ${isTextPdf ? "" : "disabled"}>${tool.ad ? `${tool.name} (Free)` : tool.name}</button>
        <div id="pdf-out"></div>
      </div>`;
    const fileIn = document.getElementById("pdf-in");
    const btn = document.getElementById("pdf-go");
    const out = document.getElementById("pdf-out");
    fileIn.addEventListener("change", () => {
      const n = fileIn.files.length;
      document.getElementById("pdf-lbl").textContent = n ? `${n} file(s) selected` : "Select file";
      if (!isTextPdf) btn.disabled = n === 0;
    });

    async function executePdf() {
      const files = Array.from(fileIn.files);
      const txtVal = document.getElementById("pdf-text")?.value.trim() || "";
      if (!isTextPdf && !files.length) return;
      if (isTextPdf && !files.length && !txtVal) {
        out.innerHTML = errorBoxHtml("Type text or upload a .txt file first.");
        return;
      }
      const origSum = files.reduce((s, f) => s + f.size, 0) || txtVal.length;
      out.innerHTML = loadingSpinnerHtml(`Processing ${tool.name}...`);
      try {
        ensureBackendUrlConfigured();
        const form = new FormData();
        files.forEach((f) => form.append("files", f));
        form.append("action", tool.action);
        if (document.getElementById("pdf-ang")) form.append("angle", document.getElementById("pdf-ang").value);
        if (document.getElementById("pdf-pages")) form.append("pages", document.getElementById("pdf-pages").value);
        if (document.getElementById("pdf-pass")) form.append("password", document.getElementById("pdf-pass").value);
        if (document.getElementById("pdf-wm")) form.append("watermark_text", document.getElementById("pdf-wm").value);
        if (document.getElementById("pdf-text")) form.append("text_content", txtVal);

        const res = await fetch(apiEndpoint("/api/pdf-process"), { method: "POST", body: form });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || "PDF processing failed."); }
        const blob = await res.blob();
        const fname = parseDispositionFilename(res, `${tool.action}.pdf`);
        out.innerHTML = downloadResultCardHtml(blob, fname, origSum);
      } catch (err) {
        out.innerHTML = errorBoxHtml(err.message);
      }
    }

    btn.addEventListener("click", () => {
      executePdf();
    });
  }

  document.querySelectorAll("[data-seo-tool]").forEach((form) => {
    const input = form.querySelector("[data-seo-file]");
    const label = form.querySelector("[data-seo-file-label]");
    const button = form.querySelector("[data-seo-submit]");
    const status = form.querySelector("[data-seo-status]");
    const slug = form.dataset.seoTool;
    const fileLimit = slug === "mp4-to-mp3" ? 180 * 1024 * 1024 : 25 * 1024 * 1024;
    input?.addEventListener("change", () => {
      const files = Array.from(input.files || []);
      label.textContent = files.length ? files.map((f) => `${f.name} (${formatBytes(f.size)})`).join(", ") : label.dataset.defaultText;
      status.replaceChildren();
    });
    if (label) label.dataset.defaultText = label.textContent;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (document.getElementById("api-health-status")?.dataset.state !== "online") {
        status.textContent = "Coming soon. This tool is currently unavailable.";
        return;
      }
      const files = Array.from(input?.files || []);
      const total = files.reduce((sum, file) => sum + file.size, 0);
      const multi = slug === "jpg-to-pdf" || slug === "merge-pdf";
      if (!files.length) { status.innerHTML = errorBoxHtml("Choose a file to continue."); return; }
      if (!multi && files.length !== 1) { status.innerHTML = errorBoxHtml("Choose one file."); return; }
      if (multi && (files.length > 25 || total > 100 * 1024 * 1024)) {
        status.innerHTML = errorBoxHtml("Select no more than 25 files with a combined size under 100 MB."); return;
      }
      if (files.some((file) => file.size > fileLimit)) {
        status.innerHTML = errorBoxHtml(`Each file must be ${slug === "mp4-to-mp3" ? "180" : "25"} MB or less.`); return;
      }
      status.innerHTML = loadingSpinnerHtml(`Uploading and processing ${files.length > 1 ? `${files.length} files` : "your file"}…`);
      button.disabled = true;
      try {
        ensureBackendUrlConfigured();
        const formData = new FormData();
        const action = form.dataset.action;
        const endpoint = slug === "mp4-to-mp3" ? "/api/video-convert" :
          slug === "jpg-to-pdf" || slug === "merge-pdf" ? "/api/pdf-process" : "/api/image-process";
        files.forEach((file) => formData.append(endpoint === "/api/pdf-process" ? "files" : "file", file));
        formData.append("action", action);
        if (slug === "compress-image") formData.append("quality", form.querySelector("[data-seo-quality]").value);
        if (slug === "resize-image") formData.append("width", form.querySelector("[data-seo-width]").value);
        if (slug === "mp4-to-mp3") formData.append("bitrate", form.querySelector("[data-seo-bitrate]").value);
        const response = await fetch(apiEndpoint(endpoint), { method: "POST", body: formData });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.detail || `Processing failed (${response.status}).`);
        }
        const blob = await response.blob();
        const fallback = slug === "mp4-to-mp3" ? "audio.mp3" : slug === "merge-pdf" || slug === "jpg-to-pdf" ? "document.pdf" : slug === "compress-image" ? "compressed.webp" : slug === "resize-image" ? "resized.webp" : "converted.jpg";
        const filename = parseDispositionFilename(response, fallback);
        const preview = blob.type.startsWith("image/") ? URL.createObjectURL(blob) : null;
        status.innerHTML = downloadResultCardHtml(blob, filename, total, preview);
      } catch (error) {
        status.innerHTML = errorBoxHtml(error.message);
      } finally {
        button.disabled = false;
      }
    });
  });

  // Initial render
  renderPopularStrip();
  renderToolsGrid();
  refreshApiHealth();
  window.__ALLMEDIA_BOOTED__ = true;
})();
