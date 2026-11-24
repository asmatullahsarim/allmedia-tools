import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = join(root, "web");
const distribution = join(root, "dist");
const template = readFileSync(join(source, "index.html"), "utf8");
const configuredPublicUrl = process.argv[2] || process.env.PUBLIC_SITE_URL || "";
const publicUrl = configuredPublicUrl ? new URL(configuredPublicUrl) : null;

if (publicUrl && (
  publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password ||
  publicUrl.search || publicUrl.hash || !publicUrl.pathname.endsWith("/")
)) {
  throw new Error("Use the public HTTPS homepage URL with a trailing slash.");
}

const tools = [
  {
    slug: "compress-image", name: "Compress Image", heading: "Compress Images Online",
    description: "Compress JPEG, PNG, WebP, HEIC, or HEIF images up to 25 MB per file. Adjust image quality, process the image, and download the smaller result.",
    formats: "JPEG, PNG, WebP, HEIC, HEIF",
    limit: "25 MB per image",
    steps: ["Choose the image you want to compress.", "Set the quality and run the compressor.", "Download the result and compare its size with the original."],
    related: ["resize-image", "png-to-jpg"],
  },
  {
    slug: "resize-image", name: "Resize Image", heading: "Resize Images Online by Pixel Width",
    description: "Resize JPEG, PNG, WebP, HEIC, or HEIF images up to 25 MB per file. Set a target pixel width while preserving the original proportions.",
    formats: "JPEG, PNG, WebP, HEIC, HEIF",
    limit: "25 MB per image",
    steps: ["Choose an image.", "Enter the target width in pixels and run the resize.", "Download the resized image."],
    related: ["compress-image", "png-to-jpg"],
  },
  {
    slug: "png-to-jpg", name: "PNG to JPG", heading: "Convert PNG to JPG Online",
    description: "Convert PNG images up to 25 MB each into JPEG files for sharing, uploading, or printing. Transparent areas are flattened during conversion.",
    formats: "PNG input; JPEG output",
    limit: "25 MB per image",
    steps: ["Choose a PNG image.", "Run the conversion.", "Download the JPG file."],
    related: ["compress-image", "jpg-to-pdf"],
  },
  {
    slug: "jpg-to-pdf", name: "JPG to PDF", heading: "Convert JPG to PDF Online",
    description: "Convert JPEG images into one PDF. Upload up to 25 images with a combined size of 100 MB; images are added in the order selected.",
    formats: "JPEG input; PDF output",
    limit: "25 MB per file; up to 25 files and 100 MB combined",
    steps: ["Select one or more JPG images.", "Check the selection and run the conversion.", "Download the PDF."],
    related: ["merge-pdf", "png-to-jpg"],
  },
  {
    slug: "merge-pdf", name: "Merge PDF", heading: "Merge PDF Files Online",
    description: "Merge up to 25 PDF files into one document. The combined upload limit is 100 MB, and pages follow the order you select.",
    formats: "PDF",
    limit: "25 MB per file; up to 25 files and 100 MB combined",
    steps: ["Choose the PDFs in the order you want them combined.", "Run the PDF merger.", "Download the combined document and check the page order."],
    related: ["jpg-to-pdf", "compress-image"],
  },
  {
    slug: "mp4-to-mp3", name: "MP4 to MP3", heading: "Convert MP4 to MP3 Online",
    description: "Extract MP3 audio from MP4 videos up to 180 MB. Choose a bitrate, convert the video, and download the audio file.",
    formats: "MP4 video with an audio track; MP3 output",
    limit: "180 MB per video",
    steps: ["Choose an MP4 video containing audio.", "Select the MP3 bitrate and run the converter.", "Download the MP3 audio file."],
    related: ["compress-image", "resize-image"],
  },
];

const escapeHtml = (value) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);

function navigation(items, prefix, heading) {
  const featured = heading === "Popular file tools";
  const extraTools = [
    ["QR Code Generator", "Create a QR code from text or a link."],
    ["Lorem Ipsum Generator", "Generate placeholder text."],
    ["Epoch Converter", "Convert a Unix timestamp to a date."],
  ];
  const links = featured ? "" : items.map(({ slug, name }) =>
    `<li><a class="skin-text underline underline-offset-2" href="${prefix}${slug}/">${escapeHtml(name)}</a></li>`
  ).join("\n          ");
  return `<nav dir="ltr" aria-label="${heading}" class="mx-3.5 my-4 rounded-2xl bg-white p-4 dark:bg-slate-800">
        <h2 class="mb-2 text-base font-bold text-slate-900 dark:text-white">${heading}</h2>
        <ul class="${featured ? "featured-tools-grid" : "grid grid-cols-2 gap-2 text-sm"}">
${links}
${featured ? extraTools.map(([name, description]) => `<li><button type="button" class="featured-tool" data-featured-tool="${escapeHtml(name)}">${escapeHtml(name)}<span>${escapeHtml(description)}</span></button></li>`).join("\n          ") : ""}
        </ul>
      </nav>`;
}

function metadata(pageUrl) {
  if (!pageUrl) return "";
  const url = escapeHtml(pageUrl.href);
  const lines = [
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:url" content="${url}" />`,
  ];
  if (pageUrl.pathname === "/") {
    const website = { "@context": "https://schema.org", "@type": "WebSite", name: "All Media Tools", url: pageUrl.href };
    lines.push(`<script type="application/ld+json">${JSON.stringify(website).replaceAll("<", "\\u003c")}</script>`);
  }
  return lines.join("\n  ");
}

function render(tool) {
  const pageUrl = publicUrl && new URL(tool ? `${tool.slug}/` : "./", publicUrl);
  let html = template
    .replace(/<!-- Public SEO metadata -->[\s\S]*?<!-- End public SEO metadata -->/, () =>
      `<!-- Public SEO metadata -->${pageUrl ? `\n  ${metadata(pageUrl)}` : ""}\n  <!-- End public SEO metadata -->`
    )
    .replace(/^ +<meta property="og:(?:title|description)"[^>]+>\n/gm, "");
  if (tool) {
    const title = `${tool.heading} | All Media Tools`;
    const steps = tool.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("");
    const accept = tool.slug === "merge-pdf" ? ".pdf,application/pdf" :
      tool.slug === "jpg-to-pdf" ? ".jpg,.jpeg,image/jpeg" :
      tool.slug === "png-to-jpg" ? ".png,image/png" :
      tool.slug === "mp4-to-mp3" ? ".mp4,video/mp4" :
      ".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif";
    const multiple = tool.slug === "merge-pdf" || tool.slug === "jpg-to-pdf";
    const action = tool.slug === "compress-image" ? "compress" :
      tool.slug === "resize-image" ? "resize" :
      tool.slug === "png-to-jpg" ? "png_to_jpg" :
      tool.slug === "jpg-to-pdf" ? "jpg_to_pdf" :
      tool.slug === "merge-pdf" ? "merge" : "mp4_to_mp3";
    const intro = `<section dir="ltr" class="mb-4 rounded-2xl bg-white p-4 text-slate-900 dark:bg-slate-800 dark:text-white">
          <h1 class="text-xl font-extrabold">${escapeHtml(tool.heading)}</h1>
          <form data-seo-tool="${escapeHtml(tool.slug)}" data-action="${action}" class="mt-3 space-y-3" aria-label="${escapeHtml(tool.name)} upload">
            <label class="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center dark:border-slate-700 dark:bg-slate-900/50">
              <span class="text-sm font-bold">Choose ${multiple ? "files" : "a file"}</span>
              <span data-seo-file-label class="mt-1 text-xs text-slate-500">${escapeHtml(tool.formats)} · ${escapeHtml(tool.limit)}</span>
              <input data-seo-file type="file" accept="${accept}" ${multiple ? "multiple" : ""} class="sr-only" required />
            </label>
            ${tool.slug === "compress-image" ? `<label class="block text-xs font-semibold">Quality <input data-seo-quality type="range" min="20" max="95" value="75" class="ms-2 align-middle" /></label>` : ""}
            ${tool.slug === "resize-image" ? `<label class="block text-xs font-semibold">Width in pixels <input data-seo-width type="number" min="1" max="12000" value="1080" class="ms-2 w-28 rounded-lg border p-2 text-slate-900" required /></label>` : ""}
            ${tool.slug === "mp4-to-mp3" ? `<label class="block text-xs font-semibold">MP3 bitrate <select data-seo-bitrate class="ms-2 rounded-lg border p-2 text-slate-900"><option>128k</option><option selected>192k</option><option>320k</option></select></label>` : ""}
            <button type="submit" data-seo-submit class="w-full rounded-xl skin-bg px-4 py-3 text-sm font-bold text-white">${escapeHtml(tool.name)}</button>
            <div data-seo-status role="status" aria-live="polite"></div>
          </form>
          <p class="mt-3 text-sm text-slate-600 dark:text-slate-300">${escapeHtml(tool.description)}</p>
          <p class="mt-2 text-xs text-slate-500 dark:text-slate-400"><strong>Supported formats:</strong> ${escapeHtml(tool.formats)}. <strong>File limit:</strong> ${escapeHtml(tool.limit)}.</p>
          <h2 class="mt-4 text-base font-bold">How to use this tool</h2>
          <ol class="mt-2 list-decimal space-y-1 ps-5 text-sm text-slate-600 dark:text-slate-300">${steps}</ol>
        </section>`;
    html = html
      .replace(/<title>.*?<\/title>/, () => `<title>${escapeHtml(title)}</title>`)
      .replace(/<meta name="description" content="[^"]*" \/>/, () => `<meta name="description" content="${escapeHtml(tool.description)}" />`)
      .replace(/<!-- SEO intro -->[\s\S]*?<!-- End SEO intro -->/, () => intro)
      .replace('href="./"', 'href="../"')
      .replace(/(href|src)="(style\.css|config\.js|ads-config\.js|ads\.js(?:\?v=2)?|app\.js|all-media-tools-logo\.webp)"/g, '$1="../$2"');
    const related = tool.related.map((slug) => tools.find((entry) => entry.slug === slug));
    html = html.replace(/<!-- SEO navigation -->[\s\S]*?<!-- End SEO navigation -->/, () => navigation(related, "../", "Related tools"));
  } else {
    html = html
      .replace(/<title>.*?<\/title>/, () => `<title>All Media Tools - PDF Image converter - MP4 to MP3 &amp; Free Online All Video Downloader</title>`)
      .replace(/<meta name="description" content="[^"]*" \/>/, () => `<meta name="description" content="Find free online tools to compress and resize images, merge PDFs, convert JPG to PDF or MP4 to MP3, and download videos from supported links." />`);
    html = html.replace(/<!-- SEO navigation -->[\s\S]*?<!-- End SEO navigation -->/, () =>
      `<!-- SEO navigation -->
      ${navigation(tools, "./", "Popular file tools")}
      <!-- End SEO navigation -->`
    );
  }

  const title = html.match(/<title>(.*?)<\/title>/)[1];
  const description = html.match(/<meta name="description" content="([^"]*)"/)[1];
  return html.replace('  <meta property="og:type"', () =>
    `  <meta property="og:title" content="${title}" />\n  <meta property="og:description" content="${description}" />\n  <meta property="og:type"`
  );
}

for (const output of [source, distribution]) {
  if (output === distribution) {
    for (const asset of ["app.js", "ads.js", "ads-config.js", "style.css", "config.js", "all-media-tools-logo.webp"]) copyFileSync(join(source, asset), join(output, asset));
  }
  writeFileSync(join(output, "index.html"), render());
  for (const tool of tools) {
    const directory = join(output, tool.slug);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "index.html"), render(tool));
  }
  const sitemap = join(output, "sitemap.xml");
  if (publicUrl) {
    const entries = ["./", ...tools.map(({ slug }) => `${slug}/`)].map((path) =>
      `  <url><loc>${escapeHtml(new URL(path, publicUrl).href)}</loc></url>`
    );
    writeFileSync(sitemap, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`);
  } else {
    rmSync(sitemap, { force: true });
  }
  const sitemapRule = publicUrl ? `Sitemap: ${new URL("sitemap.xml", publicUrl).href}\n` : "";
  writeFileSync(join(output, "robots.txt"), `User-agent: *\nAllow: /\n${sitemapRule}`);
  const redirects = ["/index.html / 308", ...tools.flatMap(({ slug }) => [
    `/${slug} /${slug}/ 308`,
    `/${slug}/index.html /${slug}/ 308`,
  ])];
  writeFileSync(join(output, "_redirects"), `${redirects.join("\n")}\n`);
}

