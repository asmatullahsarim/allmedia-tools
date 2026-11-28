import { execFile } from "node:child_process";
import crypto from "node:crypto";
import dns from "node:dns";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { GoogleGenAI } from "@google/genai";
import { AutoModel, AutoProcessor, RawImage, env as hfEnv } from "@huggingface/transformers";
import * as cheerio from "cheerio";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import JSZip from "jszip";
import multer from "multer";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import sharp from "sharp";
import Tesseract from "tesseract.js";
import { extractImages as extractPdfImages, extractText as extractPdfText } from "unpdf";

hfEnv.cacheDir = path.join(os.tmpdir(), "allmedia_models");
hfEnv.allowLocalModels = true;

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";
const WEB_DIR = path.join(__dirname, "web");
const WORK_TMP_DIR = process.env.WORK_TMP_DIR || path.join(os.tmpdir(), "allmedia_work");
const TEMP_TTL_MS = 3600 * 1000;
const MAX_UPLOAD_BYTES = 180 * 1024 * 1024;
const MAX_REMOTE_BYTES = 25 * 1024 * 1024;
const BG_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const VIDEO_MAX_DURATION_SECONDS = 10 * 60;
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

fs.mkdirSync(WORK_TMP_DIR, { recursive: true });

// Background temp directory reaper
setInterval(async () => {
  try {
    const entries = await fsp.readdir(WORK_TMP_DIR, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      const full = path.join(WORK_TMP_DIR, entry.name);
      try {
        const st = await fsp.stat(full);
        if (now - st.mtimeMs > TEMP_TTL_MS) {
          await fsp.rm(full, { recursive: true, force: true });
        }
      } catch (_) {}
    }
  } catch (_) {}
}, 60_000).unref();

// ============================================================================
// GEMINI & RATE LIMITING HELPERS
// ============================================================================

function getGeminiClient() {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function getCloudflareAiConfig() {
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const token = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
  if (!accountId || !token) return null;
  return { accountId, token };
}

const GUEST_IMAGE_LIMIT_MINUTE = 2;
const GUEST_IMAGE_LIMIT_DAY = 10;
const MEMBER_IMAGE_LIMIT_MINUTE = 5;
const MEMBER_IMAGE_LIMIT_DAY = 25;
const GUEST_CHAT_LIMIT_MINUTE = 8;
const GUEST_CHAT_LIMIT_DAY = 20;
const MEMBER_CHAT_LIMIT_MINUTE = 15;
const MEMBER_CHAT_LIMIT_DAY = 50;

const rateState = new Map();
const feedbackStore = [];

function getRequestIp(req) {
  const cfIp = (req.headers["cf-connecting-ip"] || "").toString().trim();
  if (cfIp && net.isIP(cfIp)) return cfIp;
  const xff = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
  if (xff && net.isIP(xff)) return xff;
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function checkRateLimit(identity, kind, limitMinute, limitDay, label) {
  const now = Date.now();
  const minuteKey = Math.floor(now / 60_000);
  const dayKey = new Date(now).toISOString().slice(0, 10);
  const key = `${identity}|${kind}`;
  let state = rateState.get(key);
  if (!state) {
    state = { minute: minuteKey, minuteCount: 0, day: dayKey, dayCount: 0 };
  }
  if (state.minute !== minuteKey) {
    state.minute = minuteKey;
    state.minuteCount = 0;
  }
  if (state.day !== dayKey) {
    state.day = dayKey;
    state.dayCount = 0;
  }
  if (state.minuteCount >= limitMinute) {
    const err = new Error(`${label} limit reached for this minute. Try again shortly.`);
    err.status = 429;
    throw err;
  }
  if (state.dayCount >= limitDay) {
    const err = new Error(`${label} daily limit reached. Try again tomorrow.`);
    err.status = 429;
    throw err;
  }
  state.minuteCount += 1;
  state.dayCount += 1;
  rateState.set(key, state);
  if (rateState.size > 4096) {
    const oldest = rateState.keys().next().value;
    rateState.delete(oldest);
  }
}

function decodeJwtUidUnverified(req) {
  const auth = (req.headers.authorization || "").toString();
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token || token.length > 8192) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const uid = payload.user_id || payload.sub;
    return typeof uid === "string" && uid ? uid : null;
  } catch (_) {
    return null;
  }
}

function getUsageSnapshot(identity, authenticated) {
  const today = new Date().toISOString().slice(0, 10);
  const limits = {
    image: [
      authenticated ? MEMBER_IMAGE_LIMIT_DAY : GUEST_IMAGE_LIMIT_DAY,
      authenticated ? MEMBER_IMAGE_LIMIT_MINUTE : GUEST_IMAGE_LIMIT_MINUTE,
    ],
    chat: [
      authenticated ? MEMBER_CHAT_LIMIT_DAY : GUEST_CHAT_LIMIT_DAY,
      authenticated ? MEMBER_CHAT_LIMIT_MINUTE : GUEST_CHAT_LIMIT_MINUTE,
    ],
  };
  const result = { authenticated };
  for (const [kind, [limit, minuteLimit]] of Object.entries(limits)) {
    const st = rateState.get(`${identity}|${kind}`);
    const used = st && st.day === today ? st.dayCount : 0;
    result[kind] = { used, limit, minute_limit: minuteLimit };
  }
  return result;
}

// ============================================================================
// URL VALIDATION & SSRF PROTECTION
// ============================================================================

function isGlobalIp(ip) {
  if (!net.isIP(ip)) return false;
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return false;
    if (p[0] === 169 && p[1] === 254) return false;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;
    if (p[0] === 192 && p[1] === 168) return false;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return false;
    if (p[0] >= 224) return false;
    return true;
  }
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return false;
  if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80")) return false;
  if (lower.startsWith("::ffff:")) {
    return isGlobalIp(lower.slice(7));
  }
  return true;
}

async function validatePublicUrl(rawUrl) {
  const value = (rawUrl || "").trim();
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    const err = new Error("Use a public HTTP(S) URL on port 80 or 443.");
    err.status = 400;
    throw err;
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
    const err = new Error("Use a public HTTP(S) URL on port 80 or 443.");
    err.status = 400;
    throw err;
  }
  if (parsed.username || parsed.password) {
    const err = new Error("Use a public HTTP(S) URL without credentials.");
    err.status = 400;
    throw err;
  }
  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
    const err = new Error("Use a public HTTP(S) URL on port 80 or 443.");
    err.status = 400;
    throw err;
  }
  if (net.isIP(parsed.hostname)) {
    if (!isGlobalIp(parsed.hostname)) {
      const err = new Error("Private or local addresses are not allowed.");
      err.status = 400;
      throw err;
    }
    return parsed.href;
  }
  let records;
  try {
    records = await dns.promises.lookup(parsed.hostname, { all: true });
  } catch (_) {
    const err = new Error("Could not resolve URL hostname.");
    err.status = 400;
    throw err;
  }
  if (!records.length || records.some((r) => !isGlobalIp(r.address))) {
    const err = new Error("Use a public HTTP(S) URL on port 80 or 443.");
    err.status = 400;
    throw err;
  }
  return parsed.href;
}

async function fetchPublic(rawUrl, options = {}, maxRedirects = 5) {
  let currentUrl = await validatePublicUrl(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs || 15000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(currentUrl, {
        ...options,
        headers: {
          "User-Agent": DESKTOP_UA,
          "Accept-Language": "en-US,en;q=0.9",
          ...(options.headers || {}),
        },
        redirect: "manual",
        signal: controller.signal,
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        const nextUrl = new URL(res.headers.get("location"), currentUrl).href;
        currentUrl = await validatePublicUrl(nextUrl);
        continue;
      }
      return { response: res, finalUrl: currentUrl };
    } finally {
      clearTimeout(timer);
    }
  }
  const err = new Error("Too many redirects.");
  err.status = 400;
  throw err;
}

async function readStreamLimited(response, maxBytes) {
  const contentLen = Number(response.headers.get("content-length") || 0);
  if (contentLen > maxBytes) {
    const err = new Error(`Remote resource exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit.`);
    err.status = 413;
    throw err;
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > maxBytes) {
      const err = new Error(`Remote resource exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit.`);
      err.status = 413;
      throw err;
    }
    return buf;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      const err = new Error(`Remote resource exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit.`);
      err.status = 413;
      throw err;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

// ============================================================================
// GENERAL UTILITIES
// ============================================================================

function sanitizeFilename(name, fallback = "media") {
  const cleaned = String(name || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned ? cleaned.slice(0, 64) : fallback;
}

function parseHexColor(hexStr) {
  let cleaned = String(hexStr || "#ffffff").trim().replace(/^#/, "");
  if (cleaned.length === 3) {
    cleaned = cleaned.split("").map((c) => c + c).join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return { r: 255, g: 255, b: 255 };
  }
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16),
  };
}

function formatDuration(seconds) {
  if (!seconds || !Number.isFinite(Number(seconds))) return "Ready";
  const total = Math.floor(Number(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

async function createJobTempDir(prefix = "job_") {
  await fsp.mkdir(WORK_TMP_DIR, { recursive: true });
  return fsp.mkdtemp(path.join(WORK_TMP_DIR, prefix));
}

function getBaseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http").toString().split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] || req.get("host") || `localhost:${PORT}`).toString().split(",")[0].trim();
  return `${proto}://${host}`;
}

function parsePageIndices(spec, totalPages) {
  const indices = [];
  for (const rawPart of String(spec || "").split(",")) {
    const part = rawPart.trim();
    if (!part) continue;
    if (part.includes("-")) {
      const [aStr, bStr] = part.split("-", 2);
      const a = parseInt(aStr.trim(), 10);
      const b = parseInt(bStr.trim(), 10);
      if (Number.isInteger(a) && Number.isInteger(b)) {
        const start = Math.max(1, a);
        const end = Math.min(totalPages, b);
        for (let i = start - 1; i < end; i += 1) indices.push(i);
      }
    } else if (/^\d+$/.test(part)) {
      const idx = parseInt(part, 10) - 1;
      if (idx >= 0 && idx < totalPages) indices.push(idx);
    }
  }
  return indices;
}

// ============================================================================
// EXPRESS APP & MIDDLEWARE
// ============================================================================

const app = express();
app.set("trust proxy", true);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: false,
    exposedHeaders: [
      "Content-Disposition",
      "X-Original-Size",
      "X-Compressed-Size",
      "X-Savings-Percent",
      "X-Output-Width",
      "X-Output-Height",
      "X-Processed-Count",
      "X-Error-Count",
    ],
  })
);
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));

// Security headers (preserve iframe embed compatibility for AI Studio preview)
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

// Optional Turnstile verification gate when TURNSTILE_SECRET_KEY is configured
function verificationCookieValid(cookie, secret) {
  if (!cookie || !secret) return false;
  try {
    const [version, expires, signature] = cookie.split(".", 3);
    if (version !== "v1" || Number(expires) <= Math.floor(Date.now() / 1000)) return false;
    const payload = `${version}.${expires}`;
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch (_) {
    return false;
  }
}

app.use((req, res, next) => {
  const captchaSecret = (process.env.TURNSTILE_SECRET_KEY || "").trim();
  if (
    captchaSecret &&
    req.path.startsWith("/api/") &&
    req.path !== "/api/health" &&
    req.path !== "/api/captcha/verify" &&
    !verificationCookieValid(req.cookies?.amt_human, captchaSecret)
  ) {
    return res.status(403).json({ detail: "Please verify you are human before using the tools." });
  }
  next();
});

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024, files: 25 },
});

const uploadDisk = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        if (!req._jobTmpDir) {
          req._jobTmpDir = await createJobTempDir("upload_");
        }
        cb(null, req._jobTmpDir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase().replace(/[^a-z0-9.]/g, "");
      cb(null, `input_${Date.now()}${ext || ".bin"}`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 2 },
});

// ============================================================================
// HEALTH, CAPTCHA, USAGE, FEEDBACK
// ============================================================================

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    engine: "node-express + sharp + pdf-lib + ffmpeg + rmbg-1.4 + gemini-4-hydrogen + tesseract.js",
    bg_model: "briaai/RMBG-1.4",
    cookies_loaded: false,
    temp_ttl_seconds: 3600,
    gemini_configured: Boolean((process.env.GEMINI_API_KEY || "").trim()),
  });
});

app.post("/api/captcha/verify", async (req, res) => {
  const secret = (process.env.TURNSTILE_SECRET_KEY || "").trim();
  if (!secret) {
    return res.status(503).json({ detail: "Website verification is not configured yet." });
  }
  const token = String(req.body?.token || "").trim();
  if (!token) {
    return res.status(400).json({ detail: "Missing verification token." });
  }
  try {
    const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(10000),
    });
    if (!verifyRes.ok) throw new Error("Verification service returned error.");
    const verification = await verifyRes.json();
    if (
      verification?.success !== true ||
      !["allmediatool.online", "www.allmediatool.online"].includes(verification?.hostname) ||
      verification?.action !== "site_access"
    ) {
      return res.status(403).json({ detail: "Verification failed. Please try again." });
    }
    const expires = Math.floor(Date.now() / 1000) + 12 * 3600;
    const payloadText = `v1.${expires}`;
    const signature = crypto.createHmac("sha256", secret).update(payloadText).digest("hex");
    res.cookie("amt_human", `${payloadText}.${signature}`, {
      maxAge: 12 * 3600 * 1000,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
    return res.json({ verified: true });
  } catch (_) {
    return res.status(502).json({ detail: "Verification could not be checked. Please try again." });
  }
});

app.get("/api/usage", (req, res) => {
  const uid = decodeJwtUidUnverified(req);
  const identity = uid ? `uid:${uid}` : `ip:${getRequestIp(req)}`;
  res.json(getUsageSnapshot(identity, Boolean(uid)));
});

app.post("/api/feedback", (req, res) => {
  const ip = getRequestIp(req);
  try {
    checkRateLimit(`ip:${ip}`, "feedback", 2, 10, "Feedback");
  } catch (err) {
    return res.status(err.status || 429).json({ detail: err.message });
  }
  const message = String(req.body?.message || "").trim();
  const rating = req.body?.rating != null ? Number(req.body.rating) : null;
  if (message.length < 3 || message.length > 2000) {
    return res.status(400).json({ detail: "Feedback message must be 3 to 2000 characters." });
  }
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return res.status(400).json({ detail: "Rating must be between 1 and 5." });
  }
  feedbackStore.push({
    message,
    rating,
    uid: decodeJwtUidUnverified(req),
    createdAt: new Date().toISOString(),
  });
  if (feedbackStore.length > 500) feedbackStore.shift();
  return res.json({ received: true });
});

// ============================================================================
// AI CHAT, AI IMAGE GENERATOR, OCR (GEMINI FREE TIER + CLOUDFLARE / TESSERACT)
// ============================================================================

function mapGeminiError(err) {
  const status = Number(err?.status || err?.code || 502);
  const msg = String(err?.message || "AI provider error");
  if (status === 429 || /RESOURCE_EXHAUSTED/i.test(msg)) {
    return { status: 429, detail: "AI quota limit reached temporarily. Please wait a moment and try again." };
  }
  if (status === 403 || status === 400 || /API_KEY_INVALID|PERMISSION_DENIED/i.test(msg)) {
    return { status: 503, detail: "Check your GEMINI_API_KEY configuration in Settings > Secrets." };
  }
  return { status: 502, detail: "The AI provider could not complete this request. Please try again." };
}

app.post("/api/ai/chat", async (req, res) => {
  const uid = decodeJwtUidUnverified(req);
  const identity = uid ? `uid:${uid}` : `ip:${getRequestIp(req)}`;
  try {
    checkRateLimit(
      identity,
      "chat",
      uid ? MEMBER_CHAT_LIMIT_MINUTE : GUEST_CHAT_LIMIT_MINUTE,
      uid ? MEMBER_CHAT_LIMIT_DAY : GUEST_CHAT_LIMIT_DAY,
      "Chat"
    );
  } catch (err) {
    return res.status(err.status || 429).json({ detail: err.message });
  }

  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (!messages.length || messages.length > 12) {
    return res.status(400).json({ detail: "Provide between 1 and 12 chat messages." });
  }
  let totalChars = 0;
  for (const m of messages) {
    if (!m || !["user", "assistant"].includes(m.role) || typeof m.content !== "string" || !m.content.trim()) {
      return res.status(400).json({ detail: "Invalid message format." });
    }
    totalChars += m.content.length;
  }
  if (totalChars > 12000) {
    return res.status(413).json({ detail: "Keep the total chat input under 12,000 characters." });
  }

  const gemini = getGeminiClient();
  if (gemini) {
    try {
      const contents = messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
      const response = await gemini.models.generateContent({
        model: "gemini-4-hydrogen",
        contents,
        config: {
          systemInstruction: "You are a helpful, concise assistant inside All Media Tools. Answer clearly and directly.",
        },
      });
      const answer = (response.text || "").trim();
      if (!answer) {
        return res.status(502).json({ detail: "The AI provider returned an empty reply." });
      }
      return res.json({ answer });
    } catch (err) {
      const mapped = mapGeminiError(err);
      return res.status(mapped.status).json({ detail: mapped.detail });
    }
  }

  const cf = getCloudflareAiConfig();
  if (cf) {
    try {
      const cfRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/ai/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cf.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
            max_tokens: 512,
            messages: [
              { role: "system", content: "You are a helpful, concise assistant inside All Media Tools." },
              ...messages,
            ],
          }),
          signal: AbortSignal.timeout(30000),
        }
      );
      if (cfRes.status === 429 || cfRes.status === 503) {
        return res.status(429).json({ detail: "AI chat is busy. Try again shortly." });
      }
      if (!cfRes.ok) {
        return res.status(502).json({ detail: "The AI provider could not complete this request." });
      }
      const json = await cfRes.json();
      const answer = json?.choices?.[0]?.message?.content;
      if (typeof answer !== "string" || !answer.trim()) {
        return res.status(502).json({ detail: "The AI provider returned an empty reply." });
      }
      return res.json({ answer });
    } catch (_) {
      return res.status(502).json({ detail: "The AI provider did not respond." });
    }
  }

  return res.status(503).json({ detail: "AI chat is not configured yet. Add GEMINI_API_KEY in Settings > Secrets." });
});

app.post("/api/ai/image", async (req, res) => {
  const uid = decodeJwtUidUnverified(req);
  const identity = uid ? `uid:${uid}` : `ip:${getRequestIp(req)}`;
  try {
    checkRateLimit(
      identity,
      "image",
      uid ? MEMBER_IMAGE_LIMIT_MINUTE : GUEST_IMAGE_LIMIT_MINUTE,
      uid ? MEMBER_IMAGE_LIMIT_DAY : GUEST_IMAGE_LIMIT_DAY,
      "Image"
    );
  } catch (err) {
    return res.status(err.status || 429).json({ detail: err.message });
  }

  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt || prompt.length > 1000) {
    return res.status(400).json({ detail: "Provide an image prompt between 1 and 1000 characters." });
  }

  // Prefer Cloudflare Flux if configured
  const cf = getCloudflareAiConfig();
  if (cf) {
    try {
      const cfRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cf.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ prompt, steps: 4 }),
          signal: AbortSignal.timeout(90000),
        }
      );
      if (cfRes.status === 429 || cfRes.status === 503) {
        return res.status(429).json({ detail: "AI image generation is busy or the free daily allowance is used." });
      }
      if (cfRes.ok) {
        const ctype = (cfRes.headers.get("content-type") || "").split(";")[0];
        let imgBuf = ctype.startsWith("image/") ? Buffer.from(await cfRes.arrayBuffer()) : null;
        let outMime = ctype;
        if (!imgBuf) {
          const j = await cfRes.json().catch(() => null);
          if (j?.result?.image) {
            imgBuf = Buffer.from(j.result.image, "base64");
            outMime = "image/jpeg";
          }
        }
        if (imgBuf?.length && ["image/jpeg", "image/png", "image/webp"].includes(outMime)) {
          res.setHeader("Cache-Control", "no-store");
          res.type(outMime);
          return res.send(imgBuf);
        }
      }
    } catch (_) {}
  }

  // Free Gemini tier: use gemini-4-hydrogen to craft rich SVG artwork and rasterize to PNG via sharp
  const gemini = getGeminiClient();
  if (gemini) {
    try {
      const response = await gemini.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: `Create a visually rich, detailed 1024x1024 SVG illustration for this prompt: "${prompt}".
Use gradients, layered shapes, lighting highlights, shadows, and clean composition filling the entire 1024x1024 viewBox="0 0 1024 1024".
Output ONLY valid raw <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">...</svg> markup with NO markdown fences, NO script tags, and NO external image hrefs.`,
        config: {
          systemInstruction:
            "You are a senior SVG vector illustrator. Return only valid, self-contained SVG XML starting with <svg and ending with </svg>. Never include <script>, <foreignObject>, or external URLs.",
        },
      });
      let svgText = (response.text || "").trim();
      svgText = svgText.replace(/^```(?:svg|xml)?/i, "").replace(/```$/i, "").trim();
      const svgMatch = svgText.match(/<svg[\s\S]*<\/svg>/i);
      if (!svgMatch) {
        return res.status(502).json({ detail: "The AI provider did not return valid artwork." });
      }
      // Strip any potentially unsafe tags before rasterizing
      const cleanSvg = svgMatch[0]
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");
      const pngBuffer = await sharp(Buffer.from(cleanSvg, "utf8")).png().toBuffer();
      res.setHeader("Cache-Control", "no-store");
      res.type("image/png");
      return res.send(pngBuffer);
    } catch (err) {
      const mapped = mapGeminiError(err);
      return res.status(mapped.status).json({ detail: mapped.detail });
    }
  }

  return res.status(503).json({
    detail: "AI image generation is not configured yet. Add GEMINI_API_KEY in Settings > Secrets.",
  });
});

app.post("/api/ocr", uploadMemory.single("file"), async (req, res) => {
  if (!req.file || !req.file.buffer?.length) {
    return res.status(400).json({ detail: "Upload an image under 20 MB." });
  }
  if (req.file.buffer.length > 20 * 1024 * 1024) {
    return res.status(400).json({ detail: "Upload an image under 20 MB." });
  }

  try {
    // Normalize orientation and bound size to stay well within low-RAM hosting limits
    const normalizedPng = await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();

    const gemini = getGeminiClient();
    if (gemini) {
      try {
        const response = await gemini.models.generateContent({
          model: "gemini-4-hydrogen",
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: normalizedPng.toString("base64"),
                },
              },
              {
                text: "Extract all visible text from this image verbatim. Preserve line breaks. Do not add commentary. If there is no text, reply with NO_TEXT_FOUND.",
              },
            ],
          },
        });
        const rawText = (response.text || "").trim();
        const text = rawText === "NO_TEXT_FOUND" ? "" : rawText;
        if (!text) {
          return res.json({ text: "", message: "No text found in this image." });
        }
        return res.json({
          text,
          char_count: text.length,
          word_count: text.split(/\s+/).filter(Boolean).length,
        });
      } catch (err) {
        // If Gemini fails with auth/quota, fall through to local Tesseract if possible, otherwise report error
        console.warn("Gemini OCR fallback to Tesseract:", err?.message || err);
      }
    }

    const result = await Tesseract.recognize(normalizedPng, "eng");
    const text = (result?.data?.text || "").trim();
    if (!text) {
      return res.json({ text: "", message: "No text found in this image." });
    }
    return res.json({
      text,
      char_count: text.length,
      word_count: text.split(/\s+/).filter(Boolean).length,
    });
  } catch (err) {
    return res.status(500).json({ detail: `OCR failed: ${err?.message || "Invalid image"}` });
  }
});

// ============================================================================
// VIDEO DOWNLOADER & YOUTUBE TRANSCRIPT
// ============================================================================

async function resolveVideoMetadata(url) {
  const parsed = new URL(url);
  const pathLower = parsed.pathname.toLowerCase();

  // Direct video URL
  if (/\.(mp4|m4v|mov|webm|mkv)(\?|$)/i.test(pathLower)) {
    const filename = path.basename(parsed.pathname) || "video.mp4";
    return {
      title: filename.replace(/\.[^.]+$/, ""),
      platform: "Direct Video",
      thumbnail: null,
      duration: "Ready",
      direct_downloads: true,
      standard_quality: 480,
      hd_quality: 720,
      direct_480p_url: url,
      direct_720p_url: url,
    };
  }

  // TikTok via TikWM
  if (/tiktok\.com/i.test(parsed.hostname)) {
    const r = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`, {
      headers: { "User-Agent": DESKTOP_UA },
      signal: AbortSignal.timeout(15000),
    });
    if (r.ok) {
      const j = await r.json();
      if (j.code === 0 && j.data) {
        const abs = (p) => (!p ? null : p.startsWith("http") ? p : `https://www.tikwm.com${p}`);
        return {
          title: j.data.title || "TikTok Video",
          platform: "TikTok (No Watermark)",
          thumbnail: abs(j.data.cover),
          duration: formatDuration(j.data.duration),
          direct_downloads: Boolean(j.data.play || j.data.hdplay),
          standard_quality: 480,
          hd_quality: 720,
          direct_480p_url: abs(j.data.wmplay) || abs(j.data.play),
          direct_720p_url: abs(j.data.hdplay) || abs(j.data.play),
        };
      }
    }
  }

  // X / Twitter via FxTwitter
  const xMatch = url.match(/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/i) || url.match(/(?:twitter\.com|x\.com)\/.*\/status\/(\d+)/i);
  if (xMatch) {
    const r = await fetch(`https://api.fxtwitter.com/i/status/${xMatch[1]}`, {
      headers: { "User-Agent": DESKTOP_UA },
      signal: AbortSignal.timeout(15000),
    });
    if (r.ok) {
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
          duration: formatDuration(v.duration),
          direct_downloads: Boolean(best),
          standard_quality: 480,
          hd_quality: 720,
          direct_480p_url: mp4s[0] || best,
          direct_720p_url: best,
        };
      }
    }
  }

  // YouTube via Piped APIs + YouTube oEmbed
  const ytMatch = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) {
    const videoId = ytMatch[1];
    for (const host of [
      "https://pipedapi.kavin.rocks",
      "https://pipedapi.adminforge.de",
      "https://api.piped.private.coffee",
    ]) {
      try {
        const r = await fetch(`${host}/streams/${videoId}`, {
          headers: { "User-Agent": DESKTOP_UA },
          signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) continue;
        const j = await r.json();
        if (j.duration && j.duration > VIDEO_MAX_DURATION_SECONDS) {
          const err = new Error("Free downloads are limited to videos up to 10 minutes.");
          err.status = 413;
          throw err;
        }
        const muxed = (j.videoStreams || [])
          .filter((s) => s.url && !s.videoOnly && (s.mimeType || "").includes("mp4"))
          .sort((a, b) => (a.height || 0) - (b.height || 0));
        if (muxed.length > 0) {
          const under720 = muxed.filter((s) => (s.height || 0) <= 720);
          const pool = under720.length ? under720 : muxed;
          const std = pool[0];
          const hd = pool[pool.length - 1];
          return {
            title: j.title || "YouTube Video",
            platform: "YouTube",
            thumbnail: j.thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            duration: formatDuration(j.duration),
            direct_downloads: true,
            standard_quality: std.height || 360,
            hd_quality: hd.height || 720,
            direct_480p_url: std.url,
            direct_720p_url: hd.url !== std.url ? hd.url : null,
          };
        }
      } catch (err) {
        if (err.status === 413) throw err;
      }
    }
  }

  // Generic HTML page video extraction (og:video / <video> / <source>)
  try {
    const { response, finalUrl } = await fetchPublic(url, { timeoutMs: 12000 });
    const ctype = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
    if (ctype.startsWith("video/")) {
      return {
        title: sanitizeFilename(path.basename(new URL(finalUrl).pathname) || "video"),
        platform: parsed.hostname.replace(/^www\./, ""),
        thumbnail: null,
        duration: "Ready",
        direct_downloads: true,
        standard_quality: 480,
        hd_quality: 720,
        direct_480p_url: finalUrl,
        direct_720p_url: finalUrl,
      };
    }
    if (ctype.includes("html")) {
      const htmlBuf = await readStreamLimited(response, 4 * 1024 * 1024);
      const $ = cheerio.load(htmlBuf.toString("utf8"));
      const videoCandidates = [
        $('meta[property="og:video:secure_url"]').attr("content"),
        $('meta[property="og:video:url"]').attr("content"),
        $('meta[property="og:video"]').attr("content"),
        $('meta[name="twitter:player:stream"]').attr("content"),
        $("video source[src]").first().attr("src"),
        $("video[src]").first().attr("src"),
      ]
        .map((v) => {
          if (!v) return null;
          try {
            return new URL(v.trim(), finalUrl).href;
          } catch (_) {
            return null;
          }
        })
        .filter((v) => v && /\.(mp4|m4v|webm|mov)(\?|$)/i.test(v));

      if (videoCandidates.length) {
        const title =
          $('meta[property="og:title"]').attr("content") ||
          $("title").text().trim() ||
          "Video";
        const thumb = $('meta[property="og:image"]').attr("content") || null;
        return {
          title: title.slice(0, 120),
          platform: parsed.hostname.replace(/^www\./, ""),
          thumbnail: thumb,
          duration: "Ready",
          direct_downloads: true,
          standard_quality: 480,
          hd_quality: 720,
          direct_480p_url: videoCandidates[0],
          direct_720p_url: videoCandidates[0],
        };
      }
    }
  } catch (_) {}

  return null;
}

async function handleVideoDownloadInfo(req, res) {
  try {
    const url = await validatePublicUrl(req.body?.url);
    const info = await resolveVideoMetadata(url);
    if (!info) {
      return res.status(400).json({
        detail:
          "Video source could not be fetched directly. It may be private, DRM-protected, or blocking automated requests.",
      });
    }
    const baseUrl = getBaseUrl(req);
    const encoded = encodeURIComponent(url);
    return res.json({
      max_size_mb: 100,
      max_quality: "720p",
      standard_url: `${baseUrl}/api/video/download?url=${encoded}&quality=480`,
      clean_hd_url: `${baseUrl}/api/video/download?url=${encoded}&quality=720`,
      ...info,
    });
  } catch (err) {
    return res.status(err.status || 400).json({ detail: err.message });
  }
}

app.post("/api/video-download", handleVideoDownloadInfo);
app.post("/download-video", handleVideoDownloadInfo);
app.post("/api/fetch-info", handleVideoDownloadInfo);

app.get("/api/video/download", async (req, res) => {
  try {
    const rawUrl = String(req.query.url || "");
    const quality = Math.min(720, Math.max(240, Number(req.query.quality || 720)));
    const url = await validatePublicUrl(rawUrl);
    const info = await resolveVideoMetadata(url);
    const streamUrl =
      quality <= 480
        ? info?.direct_480p_url || info?.direct_720p_url
        : info?.direct_720p_url || info?.direct_480p_url;
    if (!streamUrl) {
      return res.status(400).json({ detail: "Could not resolve a downloadable video stream." });
    }
    const { response } = await fetchPublic(streamUrl, { timeoutMs: 30000 });
    if (!response.ok) {
      return res.status(502).json({ detail: "Upstream video host declined the download." });
    }
    const ctype = (response.headers.get("content-type") || "video/mp4").split(";")[0];
    const ext = ctype.includes("webm") ? "webm" : "mp4";
    const safeTitle = sanitizeFilename(info?.title || "video");
    res.setHeader("Content-Type", ctype);
    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}_${quality}p.${ext}"`);
    const buf = await readStreamLimited(response, 100 * 1024 * 1024);
    return res.send(buf);
  } catch (err) {
    return res.status(err.status || 400).json({ detail: err.message });
  }
});

app.get("/api/download-1080p", (req, res) => {
  res.status(410).json({ detail: "1080p downloads are disabled on the free worker. Choose 720p or lower." });
});

app.post("/api/youtube-transcript", async (req, res) => {
  try {
    const url = await validatePublicUrl(req.body?.url);
    const ytMatch = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([a-zA-Z0-9_-]{11})/);
    if (!ytMatch) {
      return res.status(400).json({ detail: "Enter a valid YouTube video URL." });
    }
    const videoId = ytMatch[1];
    const { response } = await fetchPublic(`https://www.youtube.com/watch?v=${videoId}`, {
      timeoutMs: 15000,
    });
    const html = (await readStreamLimited(response, 6 * 1024 * 1024)).toString("utf8");
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    const title = (titleMatch?.[1] || "YouTube Video").replace(/\s*-\s*YouTube$/i, "").trim();

    const tracksMatch = html.match(/"captionTracks"\s*:\s*(\[[\s\S]*?\])/);
    if (!tracksMatch) {
      return res.status(404).json({ detail: "No captions/transcript found for this video." });
    }
    let tracks = [];
    try {
      tracks = JSON.parse(tracksMatch[1]);
    } catch (_) {
      return res.status(404).json({ detail: "Captions could not be parsed for this video." });
    }
    if (!tracks.length) {
      return res.status(404).json({ detail: "No captions/transcript found for this video." });
    }
    const preferred =
      tracks.find((t) => /^en/i.test(t.languageCode || "")) ||
      tracks.find((t) => /^(ur|hi)/i.test(t.languageCode || "")) ||
      tracks[0];
    const captionUrl = String(preferred.baseUrl || "").replace(/\\u0026/g, "&");
    if (!captionUrl) {
      return res.status(404).json({ detail: "No caption track URL available." });
    }
    const { response: capRes } = await fetchPublic(captionUrl, { timeoutMs: 12000 });
    const xml = (await readStreamLimited(capRes, 4 * 1024 * 1024)).toString("utf8");
    const $ = cheerio.load(xml, { xmlMode: true });
    const seen = new Set();
    const lines = [];
    $("text").each((_, el) => {
      const txt = $(el).text().replace(/\s+/g, " ").trim();
      if (txt && !seen.has(txt)) {
        seen.add(txt);
        lines.push(txt);
      }
    });
    if (!lines.length) {
      return res.status(404).json({ detail: "No transcript text found for this video." });
    }
    return res.json({ title, transcript: lines.join(" ") });
  } catch (err) {
    return res.status(err.status || 400).json({ detail: `Transcript extraction failed: ${err.message}` });
  }
});

// ============================================================================
// SOCIAL & STOCK IMAGE DOWNLOADER + THUMBNAIL / DP SAVER
// ============================================================================

async function extractImagesFromPage(url) {
  const { response, finalUrl } = await fetchPublic(url, { timeoutMs: 15000 });
  if (!response.ok) {
    const err = new Error(`Could not load URL (HTTP ${response.status}).`);
    err.status = 400;
    throw err;
  }
  const ctype = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (ctype.startsWith("image/")) {
    const pathName = path.basename(new URL(finalUrl).pathname) || "image.jpg";
    let filename = sanitizeFilename(pathName, "image.jpg");
    if (!filename.includes(".")) {
      const extMap = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/avif": ".avif",
      };
      filename += extMap[ctype] || ".jpg";
    }
    return {
      title: filename.replace(/\.[^.]+$/, "").slice(0, 120),
      images: [{ url: finalUrl, width: null, height: null, filename }],
    };
  }
  if (ctype && !["text/html", "application/xhtml+xml", "text/plain"].includes(ctype)) {
    const err = new Error("URL is not an image or an image page.");
    err.status = 415;
    throw err;
  }
  const pageBuf = await readStreamLimited(response, 8 * 1024 * 1024);
  const $ = cheerio.load(pageBuf.toString("utf8"));
  const title = ($("title").text().trim() || "Extracted Photos").slice(0, 120);
  const candidates = [];

  for (const prop of ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]) {
    const val = $(`meta[property="${prop}"]`).attr("content") || $(`meta[name="${prop}"]`).attr("content");
    if (val) {
      try {
        candidates.push(new URL(val.trim(), finalUrl).href);
      } catch (_) {}
    }
  }
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text() || "";
    const matches = raw.matchAll(/"(?:contentUrl|url|image)"\s*:\s*"(https?:[^"]+)"/g);
    for (const m of matches) {
      candidates.push(m[1].replace(/\\\//g, "/"));
    }
  });
  $("img").each((_, el) => {
    const srcset = $(el).attr("srcset");
    if (srcset) {
      const parts = srcset.split(",").map((p) => p.trim().split(" ")[0]).filter(Boolean);
      if (parts.length) {
        try {
          candidates.push(new URL(parts[parts.length - 1], finalUrl).href);
        } catch (_) {}
      }
    }
    for (const attr of ["data-src", "data-original", "src"]) {
      const v = $(el).attr(attr);
      if (v && !v.startsWith("data:")) {
        try {
          candidates.push(new URL(v.trim(), finalUrl).href);
        } catch (_) {}
      }
    }
  });

  const seen = new Set();
  const skipWords = ["favicon", "sprite", "logo", "1x1", "pixel", "blank", "avatar_default"];
  const cleaned = [];
  for (const cUrl of candidates) {
    const lower = cUrl.toLowerCase();
    if (skipWords.some((w) => lower.includes(w)) || lower.endsWith(".svg")) continue;
    if (!seen.has(cUrl)) {
      seen.add(cUrl);
      const ext = lower.includes(".png") ? "png" : lower.includes(".webp") ? "webp" : "jpg";
      cleaned.push({ url: cUrl, width: null, height: null, filename: `photo_${cleaned.length + 1}.${ext}` });
    }
    if (cleaned.length >= 24) break;
  }
  return { title, images: cleaned };
}

async function handleImageExtract(req, res) {
  try {
    const url = await validatePublicUrl(req.body?.url);
    const baseUrl = getBaseUrl(req);
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    let title = "Extracted Album";
    let images = [];
    if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic", ".heif"].includes(ext)) {
      const filename = sanitizeFilename(path.basename(new URL(url).pathname) || "image.jpg", "image.jpg");
      title = filename.replace(/\.[^.]+$/, "").slice(0, 120);
      images = [{ url, width: null, height: null, filename }];
    } else {
      ({ title, images } = await extractImagesFromPage(url));
    }
    if (!images.length) {
      return res.status(404).json({ detail: "No HD images found at this URL." });
    }
    const enriched = images.map((item) => ({
      ...item,
      download_url: `${baseUrl}/api/images/proxy?url=${encodeURIComponent(item.url)}&filename=${encodeURIComponent(item.filename)}`,
    }));
    const host = new URL(url).hostname.replace(/^www\./, "");
    return res.json({ title, platform: host, count: enriched.length, images: enriched });
  } catch (err) {
    return res.status(err.status || 400).json({ detail: err.message });
  }
}

app.post("/api/image-download", handleImageExtract);
app.post("/download-image", handleImageExtract);
app.post("/api/images/extract", handleImageExtract);

app.get("/api/images/proxy", async (req, res) => {
  try {
    const target = await validatePublicUrl(String(req.query.url || ""));
    const filename = sanitizeFilename(String(req.query.filename || "photo.jpg"), "photo.jpg");
    const parsed = new URL(target);
    const { response } = await fetchPublic(target, {
      headers: { Referer: `${parsed.protocol}//${parsed.host}/` },
      timeoutMs: 20000,
    });
    if (!response.ok) {
      return res.status(400).json({ detail: `Image fetch failed (HTTP ${response.status}).` });
    }
    const ctype = (response.headers.get("content-type") || "image/jpeg").split(";")[0].toLowerCase();
    if (!ctype.startsWith("image/")) {
      return res.status(400).json({ detail: "Remote resource is not an image." });
    }
    const data = await readStreamLimited(response, MAX_REMOTE_BYTES);
    res.setHeader("Content-Type", ctype);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(data);
  } catch (err) {
    return res.status(err.status || 400).json({ detail: err.message });
  }
});

app.post("/api/images/download-zip", async (req, res) => {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
  if (!urls.length) {
    return res.status(400).json({ detail: "No image URLs provided." });
  }
  const zip = new JSZip();
  let added = 0;
  for (let i = 0; i < Math.min(25, urls.length); i += 1) {
    try {
      const target = await validatePublicUrl(urls[i]);
      const { response } = await fetchPublic(target, { timeoutMs: 15000 });
      if (!response.ok) continue;
      const ctype = (response.headers.get("content-type") || "").toLowerCase();
      if (!ctype.startsWith("image/")) continue;
      const data = await readStreamLimited(response, 4 * 1024 * 1024);
      const ext = ctype.includes("png") ? "png" : ctype.includes("webp") ? "webp" : "jpg";
      zip.file(`image_${String(i + 1).padStart(2, "0")}.${ext}`, data);
      added += 1;
    } catch (_) {}
  }
  if (added === 0) {
    return res.status(400).json({ detail: "Failed to download album images." });
  }
  const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const archive = sanitizeFilename(req.body?.archive_name, "gallery_album");
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${archive}.zip"`);
  return res.send(zipBuf);
});

async function handleThumbnailDp(req, res) {
  try {
    let rawInput = String(req.body?.url || "").trim();
    if (rawInput.startsWith("@")) {
      rawInput = `https://www.instagram.com/${rawInput.replace(/^@+/, "").replace(/^\/+|\/+$/g, "")}/`;
    }
    const url = await validatePublicUrl(rawInput);
    const baseUrl = getBaseUrl(req);
    const ytMatch = url.match(
      /(?:youtube\.com\/watch\?.*?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/
    );
    if (ytMatch) {
      const vid = ytMatch[1];
      const variants = [
        ["Max Resolution HD (1280x720)", `https://i.ytimg.com/vi/${vid}/maxresdefault.jpg`, `yt_${vid}_maxres.jpg`],
        ["Standard Definition (640x480)", `https://i.ytimg.com/vi/${vid}/sddefault.jpg`, `yt_${vid}_sd.jpg`],
        ["High Quality (480x360)", `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`, `yt_${vid}_hq.jpg`],
      ];
      return res.json({
        type: "youtube_thumbnail",
        title: `YouTube Video (${vid})`,
        items: variants.map(([label, imgU, fname]) => ({
          label,
          url: imgU,
          download_url: `${baseUrl}/api/images/proxy?url=${encodeURIComponent(imgU)}&filename=${fname}`,
        })),
      });
    }

    if (url.toLowerCase().includes("instagram.com")) {
      const profMatch = url.match(/^https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)\/?(?:\?.*)?$/);
      if (profMatch && !["p", "reel", "reels", "tv", "stories", "explore"].includes(profMatch[1])) {
        const username = profMatch[1];
        try {
          const { response } = await fetchPublic(
            `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
            { headers: { "X-IG-App-ID": "936619743392459" }, timeoutMs: 12000 }
          );
          if (response.ok) {
            const json = await response.json();
            const userData = json?.data?.user || {};
            const hdPic = userData.profile_pic_url_hd || userData.profile_pic_url;
            if (hdPic) {
              return res.json({
                type: "instagram_dp",
                title: `@${username} HD DP`,
                items: [
                  {
                    label: "Original Full-Size DP",
                    url: hdPic,
                    download_url: `${baseUrl}/api/images/proxy?url=${encodeURIComponent(hdPic)}&filename=${username}_dp.jpg`,
                  },
                ],
              });
            }
          }
        } catch (_) {}
      }
    }

    const { title, images } = await extractImagesFromPage(url);
    if (!images.length) {
      return res.status(404).json({ detail: "Could not extract thumbnail or DP." });
    }
    const top = images[0];
    return res.json({
      type: "generic_thumbnail",
      title,
      items: [
        {
          label: "Extracted HD Thumbnail",
          url: top.url,
          download_url: `${baseUrl}/api/images/proxy?url=${encodeURIComponent(top.url)}&filename=${top.filename}`,
        },
      ],
    });
  } catch (err) {
    return res.status(err.status || 400).json({ detail: err.message });
  }
}

app.post("/thumbnail-dp", handleThumbnailDp);
app.post("/api/tools/thumbnail-dp", handleThumbnailDp);

// ============================================================================
// VIDEO CONVERTER & AUDIO EXTRACTOR (FFMPEG)
// ============================================================================

async function handleVideoConvert(req, res) {
  const tmpDir = req._jobTmpDir || (await createJobTempDir("vconv_"));
  const cleanup = () => fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  res.on("finish", cleanup);
  res.on("close", cleanup);

  try {
    const act = String(req.body?.action || "mp4_to_mp3").toLowerCase().trim();
    const url = String(req.body?.url || "").trim();
    const bitrate = ["128k", "192k", "320k"].includes(req.body?.bitrate) ? req.body.bitrate : "192k";
    const preset = String(req.body?.preset || "balanced");
    const startSec = Math.max(0, Number(req.body?.start_sec || 0));
    const endSec = Math.max(startSec + 0.5, Number(req.body?.end_sec || 10));
    const widthVal = Math.max(240, Math.min(1920, parseInt(req.body?.width || "1280", 10) || 1280));
    const evenWidth = widthVal - (widthVal % 2);

    let inPath = req.file?.path;
    let origName = req.file?.originalname || "video";
    let origSize = req.file?.size || 0;

    if (!inPath && url && (act === "mp4_to_mp3" || act === "extract_audio")) {
      const target = await validatePublicUrl(url);
      const resolved = await resolveVideoMetadata(target);
      const streamUrl = resolved?.direct_480p_url || resolved?.direct_720p_url || target;
      const { response } = await fetchPublic(streamUrl, { timeoutMs: 30000 });
      if (!response.ok) {
        return res.status(400).json({ detail: "Could not download remote video for audio extraction." });
      }
      const vidBuf = await readStreamLimited(response, 80 * 1024 * 1024);
      inPath = path.join(tmpDir, "remote_input.mp4");
      await fsp.writeFile(inPath, vidBuf);
      origName = resolved?.title || "audio";
      origSize = vidBuf.length;
    }

    if (!inPath) {
      return res.status(400).json({ detail: "Please upload a video file." });
    }

    const inExt = path.extname(origName).toLowerCase();
    if (req.file && ![".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mpeg", ".mpg"].includes(inExt)) {
      return res.status(400).json({ detail: "Unsupported video format." });
    }

    const base = sanitizeFilename(origName.replace(/\.[^.]+$/, ""), "video");
    let outPath;
    let mime;
    let args;

    if (act === "mp4_to_mp3" || act === "extract_audio") {
      outPath = path.join(tmpDir, `${base}.mp3`);
      mime = "audio/mpeg";
      args = ["-y", "-i", inPath, "-vn", "-acodec", "libmp3lame", "-ab", bitrate, outPath];
    } else if (act === "compress_video") {
      outPath = path.join(tmpDir, `${base}_compressed.mp4`);
      mime = "video/mp4";
      const crf = { light: "23", balanced: "28", max: "33" }[preset] || "28";
      const vf = preset === "light" ? "scale='min(1920,iw)':-2" : "scale='min(1280,iw)':-2";
      args = [
        "-y", "-i", inPath, "-c:v", "libx264", "-crf", crf, "-preset", "veryfast",
        "-vf", vf, "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outPath,
      ];
    } else if (act === "trim_video") {
      outPath = path.join(tmpDir, `${base}_trimmed.mp4`);
      mime = "video/mp4";
      args = [
        "-y", "-ss", String(startSec), "-to", String(endSec), "-i", inPath,
        "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart", outPath,
      ];
    } else if (act === "resize_video") {
      outPath = path.join(tmpDir, `${base}_${evenWidth}w.mp4`);
      mime = "video/mp4";
      args = [
        "-y", "-i", inPath, "-vf", `scale=${evenWidth}:-2`, "-c:v", "libx264",
        "-preset", "veryfast", "-crf", "24", "-c:a", "aac", "-movflags", "+faststart", outPath,
      ];
    } else if (["mov_to_mp4", "webm_to_mp4", "mkv_to_mp4"].includes(act)) {
      outPath = path.join(tmpDir, `${base}.mp4`);
      mime = "video/mp4";
      args = [
        "-y", "-i", inPath, "-c:v", "libx264", "-preset", "veryfast",
        "-crf", "23", "-c:a", "aac", "-movflags", "+faststart", outPath,
      ];
    } else if (act === "mp4_to_avi") {
      outPath = path.join(tmpDir, `${base}.avi`);
      mime = "video/x-msvideo";
      args = ["-y", "-i", inPath, "-c:v", "mpeg4", "-q:v", "5", "-c:a", "libmp3lame", "-q:a", "4", outPath];
    } else if (act === "video_to_gif") {
      outPath = path.join(tmpDir, `${base}.gif`);
      mime = "image/gif";
      args = [
        "-y", "-i", inPath, "-t", "12",
        "-vf", "fps=12,scale='min(480,iw)':-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
        outPath,
      ];
    } else {
      return res.status(400).json({ detail: `Unsupported video action: ${act}` });
    }

    await execFileAsync("ffmpeg", args, { timeout: 240_000, maxBuffer: 8 * 1024 * 1024 });
    const stat = await fsp.stat(outPath).catch(() => null);
    if (!stat) {
      return res.status(400).json({ detail: `FFmpeg conversion failed (${act}).` });
    }
    const compSize = stat.size;
    const savings = Math.max(0, Math.round((1 - compSize / Math.max(origSize, 1)) * 100));
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="${path.basename(outPath)}"`);
    res.setHeader("X-Original-Size", String(origSize));
    res.setHeader("X-Compressed-Size", String(compSize));
    res.setHeader("X-Savings-Percent", String(savings));
    return res.sendFile(outPath);
  } catch (err) {
    return res.status(err.status || 400).json({ detail: err.message || "FFmpeg conversion failed." });
  }
}

app.post("/api/video-convert", uploadDisk.single("file"), handleVideoConvert);
app.post("/extract-mp3", uploadDisk.single("file"), handleVideoConvert);
app.post("/api/audio/extract-mp3", uploadDisk.single("file"), handleVideoConvert);

// ============================================================================
// BACKGROUND REMOVER (NEURAL BRIA RMBG-1.4 MODEL + EDGE-FLOOD FALLBACK)
// ============================================================================

let bgModelPromise = null;

async function getBgModel() {
  if (!bgModelPromise) {
    bgModelPromise = Promise.all([
      AutoModel.from_pretrained("briaai/RMBG-1.4", {
        config: { model_type: "custom" },
        dtype: "q8",
        session_options: {
          intraOpNumThreads: 4,
          interOpNumThreads: 1,
          enableCpuMemArena: false,
          enableMemPattern: false,
        },
      }),
      AutoProcessor.from_pretrained("briaai/RMBG-1.4", {
        config: {
          do_normalize: true,
          do_pad: false,
          do_rescale: true,
          do_resize: true,
          image_mean: [0.5, 0.5, 0.5],
          image_std: [1, 1, 1],
          resample: 2,
          rescale_factor: 0.00392156862745098,
          size: { width: 1024, height: 1024 },
        },
      }),
    ])
      .then(([model, processor]) => ({ model, processor }))
      .catch((err) => {
        bgModelPromise = null;
        throw err;
      });
  }
  return bgModelPromise;
}

async function segmentBackgroundNeural(rawBuffer, maxSide = 1600) {
  const { model, processor } = await getBgModel();
  const baseSharp = sharp(rawBuffer)
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true });

  const { data: rgbData, info } = await baseSharp
    .clone()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;

  const inputImage = new RawImage(new Uint8ClampedArray(rgbData), width, height, 3);
  const { pixel_values } = await processor(inputImage);
  const { output } = await model({ input: pixel_values });

  const maskData = output.data;
  const maskH = output.dims?.[2] || 1024;
  const maskW = output.dims?.[3] || 1024;
  const totalMask = maskW * maskH;

  let minVal = Infinity;
  let maxVal = -Infinity;
  for (let i = 0; i < totalMask; i += 1) {
    const v = maskData[i];
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }

  const span = maxVal - minVal > 1e-4 ? maxVal - minVal : 1;
  const alphaSmall = Buffer.allocUnsafe(totalMask);
  for (let i = 0; i < totalMask; i += 1) {
    let norm = (maskData[i] - minVal) / span;
    if (norm <= 0.06) norm = 0;
    else if (norm >= 0.94) norm = 1;
    else norm = (norm - 0.06) / 0.88;
    alphaSmall[i] = Math.round(norm * 255);
  }

  if (typeof pixel_values?.dispose === "function") pixel_values.dispose();
  if (typeof output?.dispose === "function") output.dispose();

  const { data: alphaFull, info: alphaInfo } = await sharp(alphaSmall, {
    raw: { width: maskW, height: maskH, channels: 1 },
  })
    .resize(width, height, { kernel: sharp.kernel.cubic })
    .toColourspace("b-w")
    .raw()
    .toBuffer({ resolveWithObject: true });

  const alphaStride = alphaInfo.channels || 1;
  const outRgba = Buffer.allocUnsafe(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    outRgba[i * 4] = rgbData[i * 3];
    outRgba[i * 4 + 1] = rgbData[i * 3 + 1];
    outRgba[i * 4 + 2] = rgbData[i * 3 + 2];
    outRgba[i * 4 + 3] = alphaFull[i * alphaStride];
  }

  return { raw: outRgba, width, height };
}

async function segmentBackgroundRgba(rawBuffer, maxSide = 1200) {
  const { data, info } = await sharp(rawBuffer)
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const total = w * h;

  const borderSamples = [];
  for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 40))) {
    const topIdx = x * 4;
    const botIdx = ((h - 1) * w + x) * 4;
    borderSamples.push([data[topIdx], data[topIdx + 1], data[topIdx + 2]]);
    borderSamples.push([data[botIdx], data[botIdx + 1], data[botIdx + 2]]);
  }
  for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 40))) {
    const leftIdx = y * w * 4;
    const rightIdx = (y * w + (w - 1)) * 4;
    borderSamples.push([data[leftIdx], data[leftIdx + 1], data[leftIdx + 2]]);
    borderSamples.push([data[rightIdx], data[rightIdx + 1], data[rightIdx + 2]]);
  }

  let avgR = 0;
  let avgG = 0;
  let avgB = 0;
  for (const [r, g, b] of borderSamples) {
    avgR += r;
    avgG += g;
    avgB += b;
  }
  avgR /= borderSamples.length;
  avgG /= borderSamples.length;
  avgB /= borderSamples.length;

  let varSum = 0;
  for (const [r, g, b] of borderSamples) {
    const d = Math.hypot(r - avgR, g - avgG, b - avgB);
    varSum += d;
  }
  const meanSpread = varSum / borderSamples.length;
  const bgThreshold = Math.min(72, Math.max(32, meanSpread * 1.45 + 26));
  const edgeGradThreshold = 34;

  const visited = new Uint8Array(total);
  const bgMask = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const trySeed = (p) => {
    if (visited[p]) return;
    const i = p * 4;
    const dist = Math.hypot(data[i] - avgR, data[i + 1] - avgG, data[i + 2] - avgB);
    if (dist <= bgThreshold * 1.35) {
      visited[p] = 1;
      bgMask[p] = 1;
      queue[tail++] = p;
    }
  };

  for (let x = 0; x < w; x += 1) {
    trySeed(x);
    trySeed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y += 1) {
    trySeed(y * w);
    trySeed(y * w + (w - 1));
  }

  while (head < tail) {
    const p = queue[head++];
    const px = p % w;
    const py = (p - px) / w;
    const pi = p * 4;
    const pr = data[pi];
    const pg = data[pi + 1];
    const pb = data[pi + 2];

    const neighbors = [];
    if (px > 0) neighbors.push(p - 1);
    if (px + 1 < w) neighbors.push(p + 1);
    if (py > 0) neighbors.push(p - w);
    if (py + 1 < h) neighbors.push(p + w);

    for (const np of neighbors) {
      if (visited[np]) continue;
      visited[np] = 1;
      const ni = np * 4;
      const nr = data[ni];
      const ng = data[ni + 1];
      const nb = data[ni + 2];
      const distGlobal = Math.hypot(nr - avgR, ng - avgG, nb - avgB);
      const distLocal = Math.hypot(nr - pr, ng - pg, nb - pb);
      if (distGlobal <= bgThreshold || (distGlobal <= bgThreshold * 1.3 && distLocal <= edgeGradThreshold)) {
        bgMask[np] = 1;
        queue[tail++] = np;
      }
    }
  }

  const out = Buffer.from(data);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      if (bgMask[p] === 1) {
        out[p * 4 + 3] = 0;
        continue;
      }
      let bgNeighbors = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && bgMask[ny * w + nx] === 1) {
            bgNeighbors += 1;
          }
        }
      }
      if (bgNeighbors > 0) {
        const keepRatio = Math.max(0.2, 1 - bgNeighbors / 9);
        out[p * 4 + 3] = Math.round(out[p * 4 + 3] * keepRatio);
      }
    }
  }

  return { raw: out, width: w, height: h };
}

async function handleBgRemove(req, res) {
  if (!req.file || !req.file.buffer?.length) {
    return res.status(400).json({ detail: "Upload an image first." });
  }
  if (req.file.buffer.length > BG_MAX_UPLOAD_BYTES) {
    return res.status(413).json({ detail: "Background removal supports images up to 5 MB." });
  }

  const action = String(req.body?.action || "remove").toLowerCase().trim();
  const bgColor = String(req.body?.bg_color || "#2563eb");
  const blurRadius = Math.max(3, Math.min(35, parseInt(req.body?.blur_radius || "14", 10) || 14));

  try {
    let segmented;
    try {
      segmented = await segmentBackgroundNeural(req.file.buffer);
    } catch (neuralErr) {
      console.warn("Neural RMBG-1.4 failed, falling back to edge-flood:", neuralErr?.message || neuralErr);
      segmented = await segmentBackgroundRgba(req.file.buffer);
    }
    const { raw, width, height } = segmented;
    const cutoutPng = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();

    let outBuffer;
    if (action === "change_color") {
      const rgbColor = parseHexColor(bgColor);
      outBuffer = await sharp({
        create: { width, height, channels: 3, background: rgbColor },
      })
        .composite([{ input: cutoutPng }])
        .png()
        .toBuffer();
    } else if (action === "blur") {
      const blurredBg = await sharp(req.file.buffer)
        .rotate()
        .resize(width, height, { fit: "fill" })
        .blur(Math.max(1, blurRadius * 0.6))
        .png()
        .toBuffer();
      outBuffer = await sharp(blurredBg)
        .composite([{ input: cutoutPng }])
        .png()
        .toBuffer();
    } else {
      outBuffer = cutoutPng;
    }

    const base = sanitizeFilename((req.file.originalname || "photo").replace(/\.[^.]+$/, ""), "photo");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `attachment; filename=${base}_${action}.png`);
    return res.send(outBuffer);
  } catch (err) {
    return res.status(400).json({ detail: `Background processing failed: ${err.message}` });
  }
}

app.post("/api/bg-remove", uploadMemory.single("file"), handleBgRemove);
app.post("/remove-bg", uploadMemory.single("file"), handleBgRemove);
app.post("/api/ai/remove-bg", uploadMemory.single("file"), handleBgRemove);

// ============================================================================
// WATERMARK / OBJECT REMOVER (ISOTROPIC DIFFUSION INPAINTING)
// ============================================================================

async function handleWatermarkRemove(req, res) {
  const imageFile = req.files?.image?.[0];
  const maskFile = req.files?.mask?.[0];
  if (!imageFile?.buffer?.length || !maskFile?.buffer?.length) {
    return res.status(400).json({ detail: "Both image and brush mask are required." });
  }

  try {
    const { data: imgData, info } = await sharp(imageFile.buffer)
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { data: maskData } = await sharp(maskFile.buffer)
      .resize(info.width, info.height, { fit: "fill" })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = info.width;
    const h = info.height;
    const total = w * h;
    const mask = new Uint8Array(total);
    for (let i = 0; i < total; i += 1) {
      if (maskData[i] > 15) mask[i] = 1;
    }

    // Dilate mask by 1px for cleaner edges
    const dilated = new Uint8Array(mask);
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const p = y * w + x;
        if (mask[p]) {
          dilated[p - 1] = 1;
          dilated[p + 1] = 1;
          dilated[p - w] = 1;
          dilated[p + w] = 1;
        }
      }
    }

    const work = new Float32Array(total * 3);
    const maskedIndices = [];
    for (let i = 0; i < total; i += 1) {
      work[i * 3] = imgData[i * 4];
      work[i * 3 + 1] = imgData[i * 4 + 1];
      work[i * 3 + 2] = imgData[i * 4 + 2];
      if (dilated[i]) maskedIndices.push(i);
    }

    // Initialize masked pixels with mean of unmasked neighbors, then diffuse inward
    const filled = new Uint8Array(total);
    for (let i = 0; i < total; i += 1) {
      if (!dilated[i]) filled[i] = 1;
    }

    const passes = 60;
    for (let pass = 0; pass < passes; pass += 1) {
      for (const p of maskedIndices) {
        const x = p % w;
        const y = (p - x) / w;
        let r = 0;
        let g = 0;
        let b = 0;
        let cnt = 0;
        const nbs = [
          x > 0 ? p - 1 : -1,
          x + 1 < w ? p + 1 : -1,
          y > 0 ? p - w : -1,
          y + 1 < h ? p + w : -1,
        ];
        for (const np of nbs) {
          if (np >= 0 && (filled[np] || pass > 0)) {
            r += work[np * 3];
            g += work[np * 3 + 1];
            b += work[np * 3 + 2];
            cnt += 1;
          }
        }
        if (cnt > 0) {
          work[p * 3] = r / cnt;
          work[p * 3 + 1] = g / cnt;
          work[p * 3 + 2] = b / cnt;
          filled[p] = 1;
        }
      }
    }

    const outRgba = Buffer.from(imgData);
    for (const p of maskedIndices) {
      outRgba[p * 4] = Math.max(0, Math.min(255, Math.round(work[p * 3])));
      outRgba[p * 4 + 1] = Math.max(0, Math.min(255, Math.round(work[p * 3 + 1])));
      outRgba[p * 4 + 2] = Math.max(0, Math.min(255, Math.round(work[p * 3 + 2])));
    }

    const pngBuf = await sharp(outRgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
    const base = sanitizeFilename((imageFile.originalname || "photo").replace(/\.[^.]+$/, ""), "photo");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `attachment; filename="${base}_clean.png"`);
    return res.send(pngBuf);
  } catch (err) {
    return res.status(400).json({ detail: `Watermark removal failed: ${err.message}` });
  }
}

const watermarkUpload = uploadMemory.fields([
  { name: "image", maxCount: 1 },
  { name: "mask", maxCount: 1 },
]);
app.post("/api/watermark-remove", watermarkUpload, handleWatermarkRemove);
app.post("/remove-watermark", watermarkUpload, handleWatermarkRemove);
app.post("/api/ai/remove-watermark", watermarkUpload, handleWatermarkRemove);

// ============================================================================
// IMAGE PROCESSING, AI UPSCALER, BULK IMAGE
// ============================================================================

async function runImageProcess(buffer, origName, opts) {
  const act = String(opts.action || "compress").toLowerCase().trim();
  const safeQ = Math.max(15, Math.min(95, parseInt(opts.quality || "75", 10) || 75));
  let pipeline = sharp(buffer).rotate();
  const meta = await pipeline.metadata();
  const origW = meta.width || 1000;
  const origH = meta.height || 1000;

  if (act === "resize") {
    const targetW = Math.max(64, Math.min(4096, parseInt(opts.width || "1280", 10) || 1280));
    const parsedH = parseInt(opts.height || "0", 10) || 0;
    const targetH = parsedH > 0 ? Math.min(4096, parsedH) : Math.max(64, Math.round(origH * (targetW / origW)));
    pipeline = pipeline.resize(targetW, targetH, { kernel: sharp.kernel.lanczos3, fit: "fill" });
  } else if (act === "upscale") {
    const factor = Math.max(1.5, Math.min(3.0, Number(opts.scale || 2)));
    const nw = Math.min(4096, Math.round(origW * factor));
    const nh = Math.min(4096, Math.round(origH * factor));
    pipeline = pipeline.resize(nw, nh, { kernel: sharp.kernel.lanczos3 }).sharpen();
  } else if (act === "colorize") {
    pipeline = pipeline.modulate({ saturation: 1.35, brightness: 1.04 }).normalise();
  } else if (act === "compress" && origW > 1920) {
    pipeline = pipeline.resize({ width: 1920, withoutEnlargement: true });
  }

  const fmtMap = {
    png_to_jpg: "jpeg",
    webp_to_jpg: "jpeg",
    heic_to_jpg: "jpeg",
    jpg_to_png: "png",
    webp_to_png: "png",
    heic_to_png: "png",
    svg_to_png: "png",
    jpg_to_webp: "webp",
    png_to_webp: "webp",
    jpg_to_pdf: "pdf",
  };
  const targetFmt = fmtMap[act] || String(opts.output_format || "webp").toLowerCase().trim();

  let outBytes;
  let mime;
  let ext;
  if (targetFmt === "pdf") {
    const jpgBuf = await pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer();
    const pdfDoc = await PDFDocument.create();
    const embedded = await pdfDoc.embedJpg(jpgBuf);
    const page = pdfDoc.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
    outBytes = Buffer.from(await pdfDoc.save());
    mime = "application/pdf";
    ext = "pdf";
  } else if (targetFmt === "jpg" || targetFmt === "jpeg") {
    outBytes = await pipeline
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: safeQ, mozjpeg: true })
      .toBuffer();
    mime = "image/jpeg";
    ext = "jpg";
  } else if (targetFmt === "png") {
    outBytes = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    mime = "image/png";
    ext = "png";
  } else {
    outBytes = await pipeline.webp({ quality: safeQ }).toBuffer();
    mime = "image/webp";
    ext = "webp";
  }

  const base = sanitizeFilename((origName || "image").replace(/\.[^.]+$/, ""), "image");
  return { outBytes, mime, filename: `${base}_${act}.${ext}` };
}

async function handleImageProcess(req, res) {
  if (!req.file?.buffer?.length || req.file.buffer.length > 25 * 1024 * 1024) {
    return res.status(400).json({ detail: "Upload an image under 25 MB." });
  }
  const origSize = req.file.buffer.length;
  try {
    const { outBytes, mime, filename } = await runImageProcess(req.file.buffer, req.file.originalname, req.body || {});
    const compSize = outBytes.length;
    const savings = Math.max(0, Math.round((1 - compSize / Math.max(origSize, 1)) * 100));
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Original-Size", String(origSize));
    res.setHeader("X-Compressed-Size", String(compSize));
    res.setHeader("X-Savings-Percent", String(savings));
    return res.send(outBytes);
  } catch (err) {
    return res.status(400).json({ detail: `Image processing failed: ${err.message}` });
  }
}

app.post("/api/image-process", uploadMemory.single("file"), handleImageProcess);
app.post("/api/compress/image", uploadMemory.single("file"), handleImageProcess);

app.post("/compress", uploadDisk.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ detail: "Upload a file first." });
  }
  const ctype = (req.file.mimetype || "").toLowerCase();
  const fname = (req.file.originalname || "").toLowerCase();
  const isVid =
    String(req.body?.mode || "").toLowerCase() === "video" ||
    ctype.startsWith("video/") ||
    [".mp4", ".mov", ".mkv", ".webm", ".avi"].some((ext) => fname.endsWith(ext));
  if (isVid) {
    req.body = { ...(req.body || {}), action: "compress_video" };
    return handleVideoConvert(req, res);
  }
  try {
    const buf = await fsp.readFile(req.file.path);
    req.file.buffer = buf;
    return await handleImageProcess(req, res);
  } finally {
    if (req._jobTmpDir) fsp.rm(req._jobTmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

app.post("/api/upscale-ai", uploadMemory.single("file"), async (req, res) => {
  if (!req.file?.buffer?.length || req.file.buffer.length > 10 * 1024 * 1024) {
    return res.status(400).json({ detail: "Upload an image under 10 MB." });
  }
  const scale = parseInt(req.body?.scale || "2", 10);
  if (scale !== 2 && scale !== 4) {
    return res.status(400).json({ detail: "Scale must be 2 or 4." });
  }
  try {
    const baseImg = sharp(req.file.buffer).rotate();
    const meta = await baseImg.metadata();
    const maxPx = scale === 4 ? 800 : 1200;
    const w = meta.width || 512;
    const h = meta.height || 512;
    const clampRatio = Math.max(w, h) > maxPx ? maxPx / Math.max(w, h) : 1;
    const inW = Math.max(1, Math.round(w * clampRatio));
    const inH = Math.max(1, Math.round(h * clampRatio));
    const outW = inW * scale;
    const outH = inH * scale;
    const hasAlpha = Boolean(meta.hasAlpha);

    let pipeline = baseImg
      .resize(outW, outH, { kernel: sharp.kernel.lanczos3 })
      .sharpen({ sigma: 1.15, m1: 1.2, m2: 2.5 });

    const outBuf = hasAlpha
      ? await pipeline.png({ compressionLevel: 8 }).toBuffer()
      : await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    const mime = hasAlpha ? "image/png" : "image/jpeg";
    const ext = hasAlpha ? "png" : "jpg";

    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="upscaled_${scale}x.${ext}"`);
    res.setHeader("X-Output-Width", String(outW));
    res.setHeader("X-Output-Height", String(outH));
    return res.send(outBuf);
  } catch (err) {
    return res.status(500).json({ detail: `Upscaling failed: ${err.message}` });
  }
});

app.post("/api/bulk-image", uploadMemory.array("files", 10), async (req, res) => {
  const files = req.files || [];
  if (!files.length) {
    return res.status(400).json({ detail: "No files uploaded." });
  }
  const action = String(req.body?.action || "compress").toLowerCase().trim();
  const supported = [
    "compress", "resize", "png_to_jpg", "jpg_to_png",
    "jpg_to_webp", "webp_to_jpg", "webp_to_png", "png_to_webp",
  ];
  if (!supported.includes(action)) {
    return res.status(400).json({ detail: `Unsupported bulk action: ${action}` });
  }

  const zip = new JSZip();
  let processed = 0;
  let errors = 0;
  for (const upload of files.slice(0, 10)) {
    try {
      if (upload.buffer.length > 20 * 1024 * 1024) {
        errors += 1;
        continue;
      }
      const { outBytes, filename } = await runImageProcess(upload.buffer, upload.originalname, {
        action,
        quality: req.body?.quality || 75,
        width: req.body?.width || 1080,
        output_format: action === "compress" ? "jpg" : undefined,
      });
      zip.file(filename, outBytes);
      processed += 1;
    } catch (_) {
      errors += 1;
    }
  }
  if (processed === 0) {
    return res.status(422).json({ detail: "No images could be processed." });
  }
  const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="bulk_${action}.zip"`);
  res.setHeader("X-Processed-Count", String(processed));
  res.setHeader("X-Error-Count", String(errors));
  return res.send(zipBuf);
});

// ============================================================================
// PDF TOOLS (/api/pdf-process)
// ============================================================================

app.post("/api/pdf-process", uploadMemory.array("files", 25), async (req, res) => {
  const act = String(req.body?.action || "compress").toLowerCase().trim();
  const files = req.files || [];
  const totalOrig = files.reduce((sum, f) => sum + f.size, 0);
  if (totalOrig > 100 * 1024 * 1024) {
    return res.status(413).json({ detail: "Combined files exceed the 100 MB upload limit." });
  }

  try {
    if (act === "text_to_pdf") {
      let plainText = String(req.body?.text_content || "").trim();
      if (!plainText && files.length) {
        plainText = files[0].buffer.toString("utf8").trim();
      }
      if (!plainText) {
        return res.status(400).json({ detail: "Enter text or upload a .txt file to convert to PDF." });
      }
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pageW = 595.28;
      const pageH = 841.89;
      let page = pdfDoc.addPage([pageW, pageH]);
      let y = 795;
      for (const paragraph of plainText.split(/\r?\n/)) {
        const words = paragraph.split(" ");
        let line = "";
        for (const word of words) {
          const test = line ? `${line} ${word}` : word;
          if (test.length > 85) {
            page.drawText(line, { x: 48, y, size: 11, font });
            y -= 16;
            line = word;
            if (y < 52) {
              page = pdfDoc.addPage([pageW, pageH]);
              y = 795;
            }
          } else {
            line = test;
          }
        }
        page.drawText(line, { x: 48, y, size: 11, font });
        y -= 18;
        if (y < 52) {
          page = pdfDoc.addPage([pageW, pageH]);
          y = 795;
        }
      }
      const outBytes = Buffer.from(await pdfDoc.save());
      const base = files.length
        ? sanitizeFilename((files[0].originalname || "document").replace(/\.[^.]+$/, ""), "document")
        : "text_document";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${base}.pdf"`);
      res.setHeader("X-Original-Size", String(Math.max(totalOrig, Buffer.byteLength(plainText, "utf8"))));
      res.setHeader("X-Compressed-Size", String(outBytes.length));
      res.setHeader("X-Savings-Percent", "0");
      return res.send(outBytes);
    }

    if (!files.length) {
      return res.status(400).json({ detail: "Please upload at least one PDF or image file." });
    }

    const firstFile = files[0];
    const base = sanitizeFilename((firstFile.originalname || "document").replace(/\.[^.]+$/, ""), "document");
    let outBytes;
    let mime = "application/pdf";
    let ext = "pdf";

    if (act === "merge") {
      const merged = await PDFDocument.create();
      for (const f of files) {
        const src = await PDFDocument.load(f.buffer, { ignoreEncryption: true });
        const copied = await merged.copyPages(src, src.getPageIndices());
        copied.forEach((p) => merged.addPage(p));
      }
      outBytes = Buffer.from(await merged.save());
    } else if (act === "jpg_to_pdf") {
      const pdfDoc = await PDFDocument.create();
      for (const f of files) {
        const jpgBuf = await sharp(f.buffer).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer();
        const img = await pdfDoc.embedJpg(jpgBuf);
        const page = pdfDoc.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
      outBytes = Buffer.from(await pdfDoc.save());
    } else if (act === "compress") {
      const doc = await PDFDocument.load(firstFile.buffer, { ignoreEncryption: true });
      outBytes = Buffer.from(await doc.save({ useObjectStreams: true }));
    } else if (act === "split") {
      const src = await PDFDocument.load(firstFile.buffer, { ignoreEncryption: true });
      const zip = new JSZip();
      for (let i = 0; i < src.getPageCount(); i += 1) {
        const single = await PDFDocument.create();
        const [p] = await single.copyPages(src, [i]);
        single.addPage(p);
        zip.file(`${base}_page_${String(i + 1).padStart(3, "0")}.pdf`, await single.save());
      }
      outBytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
      mime = "application/zip";
      ext = "zip";
    } else if (act === "rotate") {
      const doc = await PDFDocument.load(firstFile.buffer, { ignoreEncryption: true });
      const deg = (parseInt(req.body?.angle || "90", 10) || 90) % 360;
      for (const page of doc.getPages()) {
        const cur = page.getRotation().angle;
        page.setRotation(degrees((cur + deg) % 360));
      }
      outBytes = Buffer.from(await doc.save());
    } else if (act === "rearrange") {
      const src = await PDFDocument.load(firstFile.buffer, { ignoreEncryption: true });
      const order = parsePageIndices(req.body?.pages, src.getPageCount());
      if (!order.length) {
        return res.status(400).json({ detail: "Provide page order like 3,1,2." });
      }
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, order);
      copied.forEach((p) => out.addPage(p));
      outBytes = Buffer.from(await out.save());
    } else if (act === "reverse_pages") {
      const src = await PDFDocument.load(firstFile.buffer, { ignoreEncryption: true });
      const indices = src.getPageIndices().reverse();
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, indices);
      copied.forEach((p) => out.addPage(p));
      outBytes = Buffer.from(await out.save());
    } else if (act === "delete_pages") {
      const src = await PDFDocument.load(firstFile.buffer, { ignoreEncryption: true });
      const toDelete = new Set(parsePageIndices(req.body?.pages, src.getPageCount()));
      const keep = src.getPageIndices().filter((idx) => !toDelete.has(idx));
      if (!keep.length) {
        return res.status(400).json({ detail: "Cannot delete all pages from PDF." });
      }
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, keep);
      copied.forEach((p) => out.addPage(p));
      outBytes = Buffer.from(await out.save());
    } else if (act === "crop") {
      const doc = await PDFDocument.load(firstFile.buffer, { ignoreEncryption: true });
      for (const page of doc.getPages()) {
        const { x, y, width, height } = page.getMediaBox();
        const mx = width * 0.08;
        const my = height * 0.08;
        page.setCropBox(x + mx, y + my, width - mx * 2, height - my * 2);
      }
      outBytes = Buffer.from(await doc.save());
    } else if (act === "add_page_numbers") {
      const doc = await PDFDocument.load(firstFile.buffer, { ignoreEncryption: true });
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const pages = doc.getPages();
      const total = pages.length;
      pages.forEach((page, idx) => {
        const { width } = page.getSize();
        const label = `Page ${idx + 1} of ${total}`;
        const tw = font.widthOfTextAtSize(label, 10);
        page.drawText(label, { x: (width - tw) / 2, y: 18, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
      });
      outBytes = Buffer.from(await doc.save());
    } else if (act === "header_footer") {
      const doc = await PDFDocument.load(firstFile.buffer, { ignoreEncryption: true });
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const hfStr = String(req.body?.watermark_text || "All Media Tools Document").trim().slice(0, 60) || "All Media Tools Document";
      for (const page of doc.getPages()) {
        const { width, height } = page.getSize();
        const tw = font.widthOfTextAtSize(hfStr, 9);
        page.drawText(hfStr, { x: (width - tw) / 2, y: height - 22, size: 9, font, color: rgb(0.35, 0.35, 0.4) });
        page.drawText(hfStr, { x: (width - tw) / 2, y: 18, size: 9, font, color: rgb(0.35, 0.35, 0.4) });
      }
      outBytes = Buffer.from(await doc.save());
    } else if (act === "esign") {
      const doc = await PDFDocument.load(firstFile.buffer, { ignoreEncryption: true });
      const font = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);
      const smallFont = await doc.embedFont(StandardFonts.Helvetica);
      const sigStr = String(req.body?.watermark_text || "Signed Digitally").trim().slice(0, 40) || "Signed Digitally";
      const pages = doc.getPages();
      const last = pages[pages.length - 1];
      if (last) {
        const { width } = last.getSize();
        last.drawRectangle({
          x: width - 190,
          y: 26,
          width: 155,
          height: 42,
          borderColor: rgb(0.15, 0.39, 0.92),
          borderWidth: 1,
        });
        last.drawText(sigStr, { x: width - 180, y: 48, size: 15, font, color: rgb(0.1, 0.25, 0.65) });
        last.drawText(`Signed ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, {
          x: width - 180,
          y: 33,
          size: 7,
          font: smallFont,
          color: rgb(0.1, 0.25, 0.65),
        });
      }
      outBytes = Buffer.from(await doc.save());
    } else if (act === "watermark") {
      const doc = await PDFDocument.load(firstFile.buffer, { ignoreEncryption: true });
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const wmStr = String(req.body?.watermark_text || "ALLMEDIA TOOLS").trim().slice(0, 45) || "ALLMEDIA TOOLS";
      for (const page of doc.getPages()) {
        const { width, height } = page.getSize();
        page.drawText(wmStr, {
          x: width * 0.22,
          y: height * 0.42,
          size: 36,
          font,
          color: rgb(0.15, 0.39, 0.92),
          opacity: 0.25,
          rotate: degrees(40),
        });
      }
      outBytes = Buffer.from(await doc.save());
    } else if (act === "pdf_to_word") {
      const parsed = await extractPdfText(new Uint8Array(firstFile.buffer), { mergePages: false });
      const pagesText = Array.isArray(parsed.text) ? parsed.text : [String(parsed.text || "")];
      const fullText = pagesText.join("\n\n--- Page Break ---\n\n");
      outBytes = Buffer.from(fullText, "utf8");
      mime = "text/plain; charset=utf-8";
      ext = "txt";
    } else if (act === "extract_images") {
      const doc = await PDFDocument.load(firstFile.buffer, { ignoreEncryption: true });
      const totalPages = doc.getPageCount();
      const zip = new JSZip();
      let count = 0;
      for (let p = 1; p <= totalPages; p += 1) {
        try {
          const imgs = await extractPdfImages(new Uint8Array(firstFile.buffer), p);
          for (const im of imgs) {
            if (im?.data && im.width && im.height) {
              count += 1;
              const png = await sharp(Buffer.from(im.data), {
                raw: { width: im.width, height: im.height, channels: im.channels || 4 },
              })
                .png()
                .toBuffer();
              zip.file(`pdf_img_${String(count).padStart(3, "0")}.png`, png);
            }
          }
        } catch (_) {}
      }
      if (count === 0) {
        return res.status(404).json({ detail: "No embedded images found in this PDF." });
      }
      outBytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
      mime = "application/zip";
      ext = "zip";
    } else if (act === "unlock") {
      const doc = await PDFDocument.load(firstFile.buffer, { ignoreEncryption: true });
      outBytes = Buffer.from(await doc.save());
    } else {
      return res.status(501).json({
        detail: `PDF action '${act}' requires native PDF rendering/encryption tools not available in this lightweight runtime.`,
      });
    }

    const compSize = outBytes.length;
    const savings = Math.max(0, Math.round((1 - compSize / Math.max(totalOrig, 1)) * 100));
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="${base}_${act}.${ext}"`);
    res.setHeader("X-Original-Size", String(totalOrig));
    res.setHeader("X-Compressed-Size", String(compSize));
    res.setHeader("X-Savings-Percent", String(savings));
    return res.send(outBytes);
  } catch (err) {
    return res.status(400).json({ detail: `PDF processing failed: ${err.message}` });
  }
});

// ============================================================================
// STATIC WEBSITE + SEO URL NORMALIZATION
// ============================================================================

app.get("/robots.txt", (req, res) => {
  res.sendFile(path.join(WEB_DIR, "robots.txt"));
});

app.get("/sitemap.xml", (req, res) => {
  const sitemapPath = path.join(WEB_DIR, "sitemap.xml");
  if (!fs.existsSync(sitemapPath)) {
    return res.status(404).json({ detail: "Sitemap not configured." });
  }
  return res.sendFile(sitemapPath);
});

const publicPages = new Set([
  "/",
  "/compress-image/",
  "/resize-image/",
  "/png-to-jpg/",
  "/jpg-to-pdf/",
  "/merge-pdf/",
  "/mp4-to-mp3/",
]);
const toolSlugs = new Set(
  Array.from(publicPages)
    .filter((p) => p !== "/")
    .map((p) => p.replace(/^\/|\/$/g, ""))
);

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const p = req.path;
  let target = null;
  if (p === "/index.html" || p === "/tools" || p === "/tools/index.html") {
    target = p === "/index.html" ? "/" : "/tools/";
  } else if (p.endsWith("/index.html") && publicPages.has(p.slice(0, -"index.html".length))) {
    target = p.slice(0, -"index.html".length);
  } else if (toolSlugs.has(p.replace(/^\//, ""))) {
    target = `${p}/`;
  } else if (p.startsWith("/tools/") && p.endsWith("/index.html")) {
    target = p.slice(0, -"index.html".length);
  } else if (p.startsWith("/tools/") && !p.endsWith("/") && !path.basename(p).includes(".")) {
    target = `${p}/`;
  }
  if (target) {
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    return res.redirect(308, `${target}${qs}`);
  }
  next();
});

app.use("/tools", express.static(WEB_DIR, { extensions: ["html"] }));
app.use("/", express.static(WEB_DIR, { extensions: ["html"] }));

// Global error handler (including multer file-size errors)
app.use((err, req, res, next) => {
  if (req._jobTmpDir) {
    fsp.rm(req._jobTmpDir, { recursive: true, force: true }).catch(() => {});
  }
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ detail: "Uploaded file exceeds the allowed size limit." });
  }
  return res.status(err?.status || 500).json({ detail: err?.message || "Server error." });
});

app.listen(PORT, HOST, () => {
  console.log(`All Media Tools server listening on http://${HOST}:${PORT}`);
  // Pre-warm neural background removal model in background without blocking port 3000
  setTimeout(() => {
    getBgModel()
      .then(() => console.log("Neural background model (briaai/RMBG-1.4) ready"))
      .catch((err) => console.warn("BG model prewarm skipped:", err?.message || err));
  }, 1500).unref();
});
