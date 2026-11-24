# All Media Tools

Website and FastAPI backend. Deploy the root Dockerfile on Render.

Website: /
Health: /api/health

The six SEO tool pages are served from the domain root. Display ads are enabled in `web/ads-config.js`; ad delivery depends on the Adsterra account and publisher approval.


## Search metadata

The homepage and six tool pages are generated for both Render (`web/`) and the static Sites package (`dist/`). Run `node scripts/build-seo.mjs` after editing the homepage template, shared scripts, or tool page copy.

Pass the approved public HTTPS homepage URL to the generator to write canonical URLs, absolute sitemap entries, and the sitemap directive in robots.txt. For a domain-root homepage, the generator also includes Google site-name markup on the homepage.

```sh
node scripts/build-seo.mjs https://allmediatool.online/
```

Publish using the same homepage URL, verify `/robots.txt` at the site origin, and submit the sitemap to Google Search Console. A static-only deployment requires a separate HTTPS API for server-powered tools. For the bundled application and API, use the Render Docker service.
