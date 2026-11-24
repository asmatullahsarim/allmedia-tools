import http.cookiejar
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.parse
import zipfile
from typing import Any, Literal

import cv2
import fitz  # PyMuPDF
import numpy as np
import requests
import yt_dlp
from bs4 import BeautifulSoup
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from security import PublicSession, validate_public_url, read_upload, read_remote_image, UploadLimitMiddleware
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from pillow_heif import register_heif_opener
from pypdf import PdfReader, PdfWriter
from pydantic import BaseModel, Field
from rembg import new_session, remove
from reportlab.lib.colors import Color
from reportlab.pdfgen import canvas

# Register HEIC/HEIF support in Pillow
register_heif_opener()

app = FastAPI(
    title="All Media Tools API",
    version="4.0.0",
    description="FastAPI backend and static website for All Media Tools.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "").split(",") if origin.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "Content-Disposition",
        "X-Original-Size",
        "X-Compressed-Size",
        "X-Savings-Percent",
    ],
)

app.add_middleware(UploadLimitMiddleware)

class AiMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class AiChatRequest(BaseModel):
    messages: list[AiMessage] = Field(min_length=1, max_length=12)


class AiImageRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=1000)


def pollinations_request(method: str, path: str, **kwargs):
    key = os.getenv("POLLINATIONS_API_KEY", "").strip()
    if not key:
        raise HTTPException(503, "AI generation is temporarily unavailable.")
    try:
        response = requests.request(
            method,
            f"https://gen.pollinations.ai{path}",
            headers={"Authorization": f"Bearer {key}"},
            timeout=(5, 95),
            allow_redirects=False,
            **kwargs,
        )
    except requests.RequestException:
        raise HTTPException(502, "The AI provider did not respond. Try again shortly.") from None
    if response.status_code in (401, 402, 403):
        raise HTTPException(503, "AI generation is temporarily unavailable.")
    if response.status_code == 429:
        raise HTTPException(429, "AI generation is busy. Try again shortly.")
    if not 200 <= response.status_code < 300:
        raise HTTPException(502, "The AI provider could not complete this request.")
    return response


@app.post("/api/ai/chat")
def ai_chat(payload: AiChatRequest):
    key = os.getenv("GROQ_API_KEY", "").strip()
    if not key:
        raise HTTPException(503, "AI chat is temporarily unavailable.")
    try:
        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": "qwen/qwen3.8-27b",
                "max_completion_tokens": 600,
                "messages": [
                    {"role": "system", "content": "You are a helpful, concise assistant inside All Media Tools."},
                    *[message.model_dump() for message in payload.messages],
                ],
            },
            timeout=(5, 25),
            allow_redirects=False,
        )
    except requests.RequestException:
        raise HTTPException(502, "The AI provider did not respond.") from None
    if response.status_code == 429:
        raise HTTPException(429, "AI chat is busy. Try again shortly.")
    if not response.ok:
        raise HTTPException(502, "The AI provider could not complete this request.")
    try:
        answer = response.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        raise HTTPException(502, "The AI provider returned an invalid reply.") from None
    if not isinstance(answer, str) or not answer.strip():
        raise HTTPException(502, "The AI provider returned an empty reply.")
    return {"answer": answer}


@app.post("/api/ai/image")
def ai_image(payload: AiImageRequest):
    prompt = urllib.parse.quote(payload.prompt, safe="")
    response = pollinations_request(
        "GET", f"/image/{prompt}",
        params={"model": "flux", "width": 768, "height": 768, "nologo": "true"},
    )
    content_type = response.headers.get("Content-Type", "").split(";")[0]
    if content_type not in {"image/jpeg", "image/png", "image/webp"} or not response.content:
        raise HTTPException(502, "The AI provider did not return an image.")
    return Response(response.content, media_type=content_type, headers={"Cache-Control": "no-store"})


DESKTOP_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
COOKIES_PATH = os.getenv("COOKIES_PATH", "/app/cookies.txt")
WORK_TMP_DIR = os.getenv("WORK_TMP_DIR", os.path.join(tempfile.gettempdir(), "allmedia_work"))
Image.MAX_IMAGE_PIXELS = 20_000_000
TEMP_TTL_SECONDS = 3600  # Auto-delete abandoned temporary files after one hour

os.makedirs(WORK_TMP_DIR, exist_ok=True)

_u2netp_lock = threading.Lock()
_u2netp_session = None


def get_u2netp_session():
    """Lazy-load lightweight u2netp ONNX session once to keep RAM low on free tier."""
    global _u2netp_session
    if _u2netp_session is None:
        with _u2netp_lock:
            if _u2netp_session is None:
                _u2netp_session = new_session("u2netp")
    return _u2netp_session


def create_temp_dir(prefix: str = "job_") -> str:
    os.makedirs(WORK_TMP_DIR, exist_ok=True)
    return tempfile.mkdtemp(prefix=prefix, dir=WORK_TMP_DIR)


def cleanup_dir(path: str) -> None:
    shutil.rmtree(path, ignore_errors=True)


def _temp_reaper_loop() -> None:
    """Background thread ensuring abandoned temporary files expire after one hour."""
    while True:
        now = time.time()
        try:
            if os.path.isdir(WORK_TMP_DIR):
                for entry in os.scandir(WORK_TMP_DIR):
                    try:
                        age = now - entry.stat().st_mtime
                        if age > TEMP_TTL_SECONDS:
                            if entry.is_dir():
                                shutil.rmtree(entry.path, ignore_errors=True)
                            else:
                                os.remove(entry.path)
                    except Exception:
                        pass
        except Exception:
            pass
        time.sleep(60)


@app.on_event("startup")
def start_background_reaper() -> None:
    t = threading.Thread(target=_temp_reaper_loop, daemon=True)
    t.start()


def get_cookies_file() -> str | None:
    if os.path.isfile(COOKIES_PATH) and os.path.getsize(COOKIES_PATH) > 0:
        return COOKIES_PATH
    return None


def build_requests_session() -> requests.Session:
    session = PublicSession()
    session.headers.update({"User-Agent": DESKTOP_UA, "Accept-Language": "en-US,en;q=0.9"})
    cookies_file = get_cookies_file()
    if cookies_file:
        try:
            jar = http.cookiejar.MozillaCookieJar(cookies_file)
            jar.load(ignore_discard=True, ignore_expires=True)
            session.cookies = jar
        except Exception:
            pass
    return session


def sanitize_filename(name: str, default: str = "media") -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "_", (name or "").strip()).strip("_")
    return cleaned[:64] if cleaned else default


def validate_http_url(url: str) -> str:
    return validate_public_url(url)


def format_duration(seconds: int | float | None) -> str:
    if not seconds:
        return "Ready"
    total = int(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def pick_progressive_url(formats: list[dict[str, Any]], max_height: int) -> str | None:
    progressive = [
        f
        for f in formats
        if f.get("url")
        and f.get("vcodec") not in (None, "none")
        and f.get("acodec") not in (None, "none")
        and (f.get("height") or 0) <= max_height
    ]
    if progressive:
        best = max(progressive, key=lambda f: (f.get("height") or 0, f.get("tbr") or 0))
        return best["url"]
    return None


def parse_hex_color(hex_str: str) -> tuple[int, int, int]:
    cleaned = (hex_str or "#ffffff").strip().lstrip("#")
    if len(cleaned) == 3:
        cleaned = "".join(c * 2 for c in cleaned)
    if len(cleaned) != 6:
        return (255, 255, 255)
    try:
        return (int(cleaned[0:2], 16), int(cleaned[2:4], 16), int(cleaned[4:6], 16))
    except ValueError:
        return (255, 255, 255)


class UrlPayload(BaseModel):
    url: str
    max_resolution: str = "1080p"


class ZipImagesPayload(BaseModel):
    urls: list[str]
    archive_name: str = "gallery_album"


# ==============================================================================
# HEALTH CHECK
# ==============================================================================


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "engine": "yt-dlp + gallery-dl + ffmpeg + rembg(u2netp) + opencv + pillow-heif + pypdf + fitz",
        "cookies_loaded": get_cookies_file() is not None,
        "temp_ttl_seconds": TEMP_TTL_SECONDS,
    }


# ==============================================================================
# 1. VIDEO DOWNLOADER (/api/video-download + /api/video/download)
# ==============================================================================


@app.post("/api/video-download")
@app.post("/download-video")
@app.post("/api/fetch-info")
def fetch_video_info(req: UrlPayload, request: Request):
    url = validate_http_url(req.url)
    ydl_opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
    }
    cookies = get_cookies_file()
    if cookies:
        ydl_opts["cookiefile"] = cookies

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Video extraction failed: {exc}")

    if "entries" in info and info["entries"]:
        info = info["entries"][0]

    formats = info.get("formats") or []
    encoded = urllib.parse.quote(url, safe="")
    base_url = str(request.base_url).rstrip("/")

    std_url = pick_progressive_url(formats, 480) or info.get("url")
    hd_url = pick_progressive_url(formats, 720) or std_url

    return {
        "title": info.get("title") or "Video",
        "platform": info.get("extractor_key") or "Web",
        "thumbnail": info.get("thumbnail"),
        "duration": format_duration(info.get("duration")),
        "standard_url": f"{base_url}/api/video/download?url={encoded}&quality=480",
        "clean_hd_url": f"{base_url}/api/video/download?url={encoded}&quality=720",
        "full_hd_url": f"{base_url}/api/video/download?url={encoded}&quality=1080",
        "direct_480p_preview": std_url,
        "direct_720p_preview": hd_url,
    }


def _merge_and_stream_video(url: str, max_height: int, background_tasks: BackgroundTasks) -> FileResponse:
    url = validate_http_url(url)
    tmp_dir = create_temp_dir("vid_")
    out_tpl = os.path.join(tmp_dir, "video.%(ext)s")
    ydl_opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "format": f"bestvideo[height<={max_height}]+bestaudio/best[height<={max_height}]/best",
        "merge_output_format": "mp4",
        "outtmpl": out_tpl,
    }
    cookies = get_cookies_file()
    if cookies:
        ydl_opts["cookiefile"] = cookies

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            if "entries" in info and info["entries"]:
                info = info["entries"][0]
            file_path = ydl.prepare_filename(info)
            mp4_path = os.path.splitext(file_path)[0] + ".mp4"
            final_path = mp4_path if os.path.exists(mp4_path) else file_path
            if not os.path.exists(final_path):
                candidates = [
                    os.path.join(tmp_dir, fn)
                    for fn in os.listdir(tmp_dir)
                    if not fn.endswith(".part") and not fn.endswith(".ytdl")
                ]
                if candidates:
                    final_path = max(candidates, key=os.path.getsize)
            safe_title = sanitize_filename(info.get("title") or "video")
    except Exception as exc:
        cleanup_dir(tmp_dir)
        raise HTTPException(status_code=400, detail=f"Video download failed: {exc}")

    if not os.path.exists(final_path):
        cleanup_dir(tmp_dir)
        raise HTTPException(status_code=500, detail="Merged video output not produced.")

    media_mime = "video/webm" if final_path.lower().endswith(".webm") else "video/mp4"
    out_ext = "webm" if final_path.lower().endswith(".webm") else "mp4"
    background_tasks.add_task(cleanup_dir, tmp_dir)
    return FileResponse(final_path, media_type=media_mime, filename=f"{safe_title}_{max_height}p.{out_ext}")


@app.get("/api/video/download")
def download_video_quality(
    background_tasks: BackgroundTasks,
    url: str = Query(...),
    quality: int = Query(720, ge=240, le=2160),
):
    return _merge_and_stream_video(url, quality, background_tasks)


@app.get("/api/download-1080p")
def download_1080p(background_tasks: BackgroundTasks, url: str = Query(...)):
    return _merge_and_stream_video(url, 1080, background_tasks)


# ==============================================================================
# 2. SOCIAL & STOCK IMAGE DOWNLOADER (/api/image-download)
# ==============================================================================


def _extract_images_gallery_dl(url: str) -> list[dict[str, Any]]:
    cmd = ["gallery-dl", "--dump-json", "--no-download", "--range", "1-30"]
    cookies = get_cookies_file()
    if cookies:
        cmd.extend(["--cookies", cookies])
    cmd.append(url)

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=25)
    except Exception:
        return []

    if not proc.stdout:
        return []

    results: list[dict[str, Any]] = []
    seen: set[str] = set()
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, list) and len(item) >= 2 and isinstance(item[1], str) and item[1].startswith("http"):
            media_url = item[1]
            meta = item[2] if len(item) >= 3 and isinstance(item[2], dict) else {}
            ext = (meta.get("extension") or "").lower()
            if ext in ("mp4", "webm", "mov", "m4v") or ".m3u8" in media_url.lower():
                continue
            if media_url not in seen:
                seen.add(media_url)
                results.append(
                    {
                        "url": media_url,
                        "width": meta.get("width"),
                        "height": meta.get("height"),
                        "filename": f"{sanitize_filename(meta.get('filename') or f'image_{len(results)+1}')}.{ext or 'jpg'}",
                    }
                )
    return results


def _extract_images_bs4(url: str) -> tuple[str, list[dict[str, Any]]]:
    session = build_requests_session()
    try:
        resp = session.get(url, stream=True, timeout=15)
        resp.raise_for_status()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not load URL: {exc}")

    try:
        page_url = resp.url
        content_type = resp.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type.startswith("image/"):
            path_name = os.path.basename(urllib.parse.urlsplit(page_url).path)
            filename = sanitize_filename(path_name or "image.jpg", "image.jpg")
            if "." not in filename:
                suffix = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
                          "image/gif": ".gif", "image/avif": ".avif"}.get(content_type, ".img")
                filename += suffix
            if int(resp.headers.get("Content-Length", "0") or 0) > 25 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="Remote image exceeds 25 MB.")
            return os.path.splitext(filename)[0][:120], [
                {"url": page_url, "width": None, "height": None, "filename": filename}
            ]
        if content_type and content_type not in ("text/html", "application/xhtml+xml", "text/plain"):
            raise HTTPException(status_code=415, detail="URL is not an image or an image page.")

        page = bytearray()
        for chunk in resp.iter_content(65536):
            page.extend(chunk)
            if len(page) > 8 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="Image page exceeds the 8 MB limit.")
        soup = BeautifulSoup(bytes(page), "html.parser")
        title = (soup.title.string.strip() if soup.title and soup.title.string else "Extracted Photos")[:120]

        candidates: list[str] = []
        for prop in ("og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"):
            tag = soup.find("meta", attrs={"property": prop}) or soup.find("meta", attrs={"name": prop})
            if tag and tag.get("content"):
                candidates.append(urllib.parse.urljoin(page_url, tag["content"].strip()))

        for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
            raw_json = script.string or ""
            for match in re.findall(r'"(?:contentUrl|url|image)"\s*:\s*"(https?:[^"]+)"', raw_json):
                candidates.append(match.replace("\\/", "/"))

        for img in soup.find_all("img"):
            srcset = img.get("srcset")
            if srcset:
                parts = [p.strip().split(" ")[0] for p in srcset.split(",") if p.strip()]
                if parts:
                    candidates.append(urllib.parse.urljoin(page_url, parts[-1]))
            for attr in ("data-src", "data-original", "src"):
                val = img.get(attr)
                if val and not val.startswith("data:"):
                    candidates.append(urllib.parse.urljoin(page_url, val.strip()))

        seen: set[str] = set()
        cleaned: list[dict[str, Any]] = []
        skip_words = ("favicon", "sprite", "logo", "1x1", "pixel", "blank", "avatar_default")
        for idx, c_url in enumerate(candidates, start=1):
            lower = c_url.lower()
            if any(w in lower for w in skip_words) or lower.endswith(".svg"):
                continue
            if c_url not in seen:
                seen.add(c_url)
                ext = "png" if ".png" in lower else ("webp" if ".webp" in lower else "jpg")
                cleaned.append(
                    {"url": c_url, "width": None, "height": None, "filename": f"photo_{idx}.{ext}"}
                )
            if len(cleaned) >= 24:
                break
        return title, cleaned
    finally:
        resp.close()


@app.post("/api/image-download")
@app.post("/download-image")
@app.post("/api/images/extract")
def extract_images(req: UrlPayload, request: Request):
    url = validate_http_url(req.url)
    base_url = str(request.base_url).rstrip("/")

    path_ext = os.path.splitext(urllib.parse.urlsplit(url).path.lower())[1]
    if path_ext in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic", ".heif"}:
        filename = sanitize_filename(os.path.basename(urllib.parse.urlsplit(url).path) or "image.jpg", "image.jpg")
        title = os.path.splitext(filename)[0][:120]
        images = [{"url": url, "width": None, "height": None, "filename": filename}]
    else:
        images = _extract_images_gallery_dl(url)
        title = "Extracted Album"
        if not images:
            title, images = _extract_images_bs4(url)
    if not images:
        raise HTTPException(status_code=404, detail="No HD images found at this URL.")

    enriched = []
    for item in images:
        encoded = urllib.parse.quote(item["url"], safe="")
        fname = urllib.parse.quote(item["filename"], safe="")
        enriched.append(
            {**item, "download_url": f"{base_url}/api/images/proxy?url={encoded}&filename={fname}"}
        )

    host = urllib.parse.urlparse(url).netloc.replace("www.", "")
    return {"title": title, "platform": host, "count": len(enriched), "images": enriched}


@app.get("/api/images/proxy")
def proxy_image_download(url: str = Query(...), filename: str = Query("image.jpg")):
    target = validate_http_url(url)
    session = build_requests_session()
    parsed = urllib.parse.urlparse(target)
    try:
        resp = session.get(target, headers={"Referer": f"{parsed.scheme}://{parsed.netloc}/"}, stream=True, timeout=20)
        resp.raise_for_status()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Image fetch failed: {exc}")

    content_type = resp.headers.get("Content-Type", "image/jpeg").split(";")[0]
    data = read_remote_image(resp)
    safe_name = sanitize_filename(filename, "photo.jpg")
    return Response(data, media_type=content_type,
                    headers={"Content-Disposition": f'attachment; filename="{safe_name}"'})



@app.post("/api/images/download-zip")
def download_images_zip(payload: ZipImagesPayload):
    if not payload.urls:
        raise HTTPException(status_code=400, detail="No image URLs provided.")

    session = build_requests_session()
    buf = io.BytesIO()
    added = 0
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for idx, raw_url in enumerate(payload.urls[:25], start=1):
            try:
                target = validate_http_url(raw_url)
                r = session.get(target, timeout=15, stream=True)
                image_data = read_remote_image(r, limit=4 * 1024 * 1024)
                if image_data:
                    ctype = r.headers.get("Content-Type", "")
                    ext = "png" if "png" in ctype else ("webp" if "webp" in ctype else "jpg")
                    zf.writestr(f"image_{idx:02d}.{ext}", image_data)
                    added += 1
            except Exception:
                continue
    if added == 0:
        raise HTTPException(status_code=400, detail="Failed to download album images.")
    buf.seek(0)
    archive = sanitize_filename(payload.archive_name, "gallery_album")
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{archive}.zip"'},
    )


# ==============================================================================
# 3. AUDIO EXTRACTOR & VIDEO CONVERTER (/api/video-convert)
# ==============================================================================


@app.post("/api/video-convert")
@app.post("/extract-mp3")
@app.post("/api/audio/extract-mp3")
async def video_convert(
    background_tasks: BackgroundTasks,
    action: str = Form("mp4_to_mp3"),
    url: str | None = Form(None),
    bitrate: str = Form("192k"),
    preset: str = Form("balanced"),
    start_sec: float = Form(0.0),
    end_sec: float = Form(10.0),
    width: int = Form(1280),
    file: UploadFile | None = File(None),
):
    tmp_dir = create_temp_dir("vconv_")
    act = (action or "mp4_to_mp3").lower().strip()

    try:
        # Handle URL-only MP3 extraction quickly via yt-dlp
        if url and (file is None or not file.filename) and act in ("mp4_to_mp3", "extract_audio"):
            target = validate_http_url(url)
            safe_kbps = bitrate.rstrip("k") if bitrate in ("128k", "192k", "320k") else "192"
            out_tpl = os.path.join(tmp_dir, "%(title).45s.%(ext)s")
            ydl_opts: dict[str, Any] = {
                "quiet": True,
                "no_warnings": True,
                "noplaylist": True,
                "format": "bestaudio/best",
                "outtmpl": out_tpl,
                "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": safe_kbps}],
            }
            cookies = get_cookies_file()
            if cookies:
                ydl_opts["cookiefile"] = cookies
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(target, download=True)
                if "entries" in info and info["entries"]:
                    info = info["entries"][0]
                safe_title = sanitize_filename(info.get("title") or "audio")
            mp3s = [f for f in os.listdir(tmp_dir) if f.lower().endswith(".mp3")]
            if not mp3s:
                raise HTTPException(status_code=500, detail="MP3 extraction failed.")
            out_mp3 = os.path.join(tmp_dir, mp3s[0])
            background_tasks.add_task(cleanup_dir, tmp_dir)
            return FileResponse(out_mp3, media_type="audio/mpeg", filename=f"{safe_title}.mp3")

        if file is None or not file.filename:
            raise HTTPException(status_code=400, detail="Please upload a video file.")

        in_ext = os.path.splitext(os.path.basename(file.filename))[1].lower()
        if in_ext not in (".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mpeg", ".mpg"):
            raise HTTPException(400, detail="Unsupported video format.")
        in_path = os.path.join(tmp_dir, f"input{in_ext}")
        orig_size = 0
        max_bytes = 180 * 1024 * 1024
        with open(in_path, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                orig_size += len(chunk)
                if orig_size > max_bytes:
                    raise HTTPException(status_code=413, detail="Video exceeds 180 MB upload limit.")
                f.write(chunk)

        base = sanitize_filename(os.path.splitext(file.filename)[0], "video")
        safe_bitrate = bitrate if bitrate in ("128k", "192k", "320k") else "192k"

        if act in ("mp4_to_mp3", "extract_audio"):
            out_path = os.path.join(tmp_dir, f"{base}.mp3")
            cmd = ["ffmpeg", "-y", "-i", in_path, "-vn", "-acodec", "libmp3lame", "-ab", safe_bitrate, out_path]
            mime = "audio/mpeg"
        elif act == "compress_video":
            out_path = os.path.join(tmp_dir, f"{base}_compressed.mp4")
            crf = {"light": "23", "balanced": "28", "max": "33"}.get(preset, "28")
            vf = "scale='min(1280,iw)':-2" if preset in ("balanced", "max") else "scale='min(1920,iw)':-2"
            cmd = ["ffmpeg", "-y", "-i", in_path, "-c:v", "libx264", "-crf", crf, "-preset", "veryfast", "-vf", vf, "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out_path]
            mime = "video/mp4"
        elif act == "trim_video":
            s_t = max(0.0, float(start_sec))
            e_t = max(s_t + 0.5, float(end_sec))
            out_path = os.path.join(tmp_dir, f"{base}_trimmed.mp4")
            cmd = ["ffmpeg", "-y", "-ss", str(s_t), "-to", str(e_t), "-i", in_path, "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart", out_path]
            mime = "video/mp4"
        elif act == "resize_video":
            w_val = max(240, min(1920, int(width)))
            w_val = w_val - (w_val % 2)
            out_path = os.path.join(tmp_dir, f"{base}_{w_val}w.mp4")
            cmd = ["ffmpeg", "-y", "-i", in_path, "-vf", f"scale={w_val}:-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-c:a", "aac", "-movflags", "+faststart", out_path]
            mime = "video/mp4"
        elif act in ("mov_to_mp4", "webm_to_mp4", "mkv_to_mp4"):
            out_path = os.path.join(tmp_dir, f"{base}.mp4")
            cmd = ["ffmpeg", "-y", "-i", in_path, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-movflags", "+faststart", out_path]
            mime = "video/mp4"
        elif act == "mp4_to_avi":
            out_path = os.path.join(tmp_dir, f"{base}.avi")
            cmd = ["ffmpeg", "-y", "-i", in_path, "-c:v", "mpeg4", "-q:v", "5", "-c:a", "libmp3lame", "-q:a", "4", out_path]
            mime = "video/x-msvideo"
        elif act == "video_to_gif":
            out_path = os.path.join(tmp_dir, f"{base}.gif")
            cmd = [
                "ffmpeg", "-y", "-i", in_path, "-t", "12",
                "-vf", "fps=12,scale='min(480,iw)':-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
                out_path,
            ]
            mime = "image/gif"
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported video action: {act}")

        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=240)
        if proc.returncode != 0 or not os.path.exists(out_path):
            raise HTTPException(status_code=400, detail=f"FFmpeg conversion failed ({act}).")

        comp_size = os.path.getsize(out_path)
        savings = max(0, round((1 - (comp_size / max(orig_size, 1))) * 100))
        background_tasks.add_task(cleanup_dir, tmp_dir)
        return FileResponse(
            out_path,
            media_type=mime,
            filename=os.path.basename(out_path),
            headers={
                "X-Original-Size": str(orig_size),
                "X-Compressed-Size": str(comp_size),
                "X-Savings-Percent": str(savings),
            },
        )
    except HTTPException:
        cleanup_dir(tmp_dir)
        raise
    except Exception as exc:
        cleanup_dir(tmp_dir)
        raise HTTPException(status_code=500, detail=f"Conversion error: {exc}")


# ==============================================================================
# 4. AI BACKGROUND TOOLS (/api/bg-remove - rembg u2netp)
# ==============================================================================


@app.post("/api/bg-remove")
@app.post("/remove-bg")
@app.post("/api/ai/remove-bg")
async def process_background(
    file: UploadFile = File(...),
    action: str = Form("remove"),
    bg_color: str = Form("#2563eb"),
    blur_radius: int = Form(14),
):
    raw = await read_upload(file)
    if not raw or len(raw) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Upload an image under 20 MB.")

    try:
        orig = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGBA")
        orig.thumbnail((2200, 2200), Image.Resampling.LANCZOS)
        session = get_u2netp_session()
        fg_cutout = remove(orig, session=session).convert("RGBA")

        act = (action or "remove").lower().strip()
        if act == "change_color":
            rgb = parse_hex_color(bg_color)
            bg_layer = Image.new("RGBA", fg_cutout.size, (*rgb, 255))
            result_img = Image.alpha_composite(bg_layer, fg_cutout).convert("RGB")
            fmt, mime, ext = "PNG", "image/png", "png"
        elif act == "blur":
            safe_blur = max(3, min(35, int(blur_radius)))
            blurred_bg = orig.filter(ImageFilter.GaussianBlur(radius=safe_blur))
            result_img = Image.alpha_composite(blurred_bg, fg_cutout)
            fmt, mime, ext = "PNG", "image/png", "png"
        else:
            result_img = fg_cutout
            fmt, mime, ext = "PNG", "image/png", "png"

        out_buf = io.BytesIO()
        result_img.save(out_buf, format=fmt)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI background processing failed: {exc}")

    base = sanitize_filename(os.path.splitext(file.filename or "photo")[0], "photo")
    return Response(
        content=out_buf.getvalue(),
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{base}_{act}.{ext}"'},
    )


# ==============================================================================
# 5. WATERMARK & OBJECT REMOVER (/api/watermark-remove - OpenCV cv2.inpaint)
# ==============================================================================


@app.post("/api/watermark-remove")
@app.post("/remove-watermark")
@app.post("/api/ai/remove-watermark")
async def remove_watermark(
    image: UploadFile = File(...),
    mask: UploadFile = File(...),
    radius: int = Form(5),
):
    img_bytes = await read_upload(image)
    mask_bytes = await read_upload(mask)
    if not img_bytes or not mask_bytes:
        raise HTTPException(status_code=400, detail="Both image and brush mask are required.")

    src = cv2.imdecode(np.frombuffer(img_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    msk = cv2.imdecode(np.frombuffer(mask_bytes, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    if src is None or msk is None:
        raise HTTPException(status_code=400, detail="Invalid image or mask format.")

    h, w = src.shape[:2]
    if msk.shape[:2] != (h, w):
        msk = cv2.resize(msk, (w, h), interpolation=cv2.INTER_NEAREST)

    _, binary_mask = cv2.threshold(msk, 15, 255, cv2.THRESH_BINARY)
    binary_mask = cv2.dilate(binary_mask, np.ones((3, 3), np.uint8), iterations=1)
    cleaned = cv2.inpaint(src, binary_mask, max(2, min(15, radius)), cv2.INPAINT_TELEA)

    ok, encoded = cv2.imencode(".png", cleaned)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to encode cleaned PNG.")

    base = sanitize_filename(os.path.splitext(image.filename or "photo")[0], "photo")
    return Response(
        content=encoded.tobytes(),
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="{base}_clean.png"'},
    )


# ==============================================================================
# 6. IMAGE FORMAT & COMPRESSION (/api/image-process - Pillow + pillow-heif)
# ==============================================================================


@app.post("/api/image-process")
@app.post("/api/compress/image")
async def process_image(
    file: UploadFile = File(...),
    action: str = Form("compress"),
    quality: int = Form(75),
    output_format: str = Form("webp"),
    width: int = Form(1280),
    height: int = Form(0),
    scale: float = Form(2.0),
):
    raw = await read_upload(file)
    if not raw or len(raw) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Upload an image under 25 MB.")

    orig_size = len(raw)
    act = (action or "compress").lower().strip()
    safe_q = max(15, min(95, quality))

    try:
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))

        if act == "resize":
            target_w = max(64, min(4096, int(width)))
            target_h = int(height) if height > 0 else max(64, int(img.height * (target_w / float(img.width))))
            img = img.resize((target_w, min(4096, target_h)), Image.Resampling.LANCZOS)
        elif act == "upscale":
            factor = max(1.5, min(3.0, float(scale)))
            nw = min(4096, int(img.width * factor))
            nh = min(4096, int(img.height * factor))
            img = img.resize((nw, nh), Image.Resampling.LANCZOS)
            img = img.filter(ImageFilter.UnsharpMask(radius=1.5, percent=135, threshold=3))
        elif act == "colorize":
            rgb = img.convert("RGB")
            rgb = ImageOps.autocontrast(rgb, cutoff=1)
            rgb = ImageEnhance.Color(rgb).enhance(1.35)
            img = ImageEnhance.Contrast(rgb).enhance(1.12)
        elif act == "compress" and img.width > 1920:
            ratio = 1920 / float(img.width)
            img = img.resize((1920, int(img.height * ratio)), Image.Resampling.LANCZOS)

        fmt_map = {
            "png_to_jpg": "jpeg",
            "webp_to_jpg": "jpeg",
            "heic_to_jpg": "jpeg",
            "jpg_to_png": "png",
            "webp_to_png": "png",
            "heic_to_png": "png",
            "svg_to_png": "png",
            "jpg_to_webp": "webp",
            "png_to_webp": "webp",
            "jpg_to_pdf": "pdf",
        }
        target_fmt = fmt_map.get(act, (output_format or "webp").lower().strip())
        out_buf = io.BytesIO()

        if target_fmt == "pdf":
            img.convert("RGB").save(out_buf, format="PDF", resolution=150.0)
            mime, ext = "application/pdf", "pdf"
        elif target_fmt in ("jpg", "jpeg"):
            if img.mode in ("RGBA", "P", "LA"):
                bg = Image.new("RGB", img.size, (255, 255, 255))
                if img.mode == "RGBA":
                    bg.paste(img, mask=img.split()[3])
                else:
                    bg.paste(img.convert("RGB"))
                img = bg
            else:
                img = img.convert("RGB")
            img.save(out_buf, format="JPEG", quality=safe_q, optimize=True)
            mime, ext = "image/jpeg", "jpg"
        elif target_fmt == "png":
            img.save(out_buf, format="PNG", optimize=True)
            mime, ext = "image/png", "png"
        else:
            img.save(out_buf, format="WEBP", quality=safe_q, method=6)
            mime, ext = "image/webp", "webp"
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Image processing failed: {exc}")

    out_bytes = out_buf.getvalue()
    comp_size = len(out_bytes)
    savings = max(0, round((1 - (comp_size / max(orig_size, 1))) * 100))
    base = sanitize_filename(os.path.splitext(file.filename or "image")[0], "image")
    return Response(
        content=out_bytes,
        media_type=mime,
        headers={
            "Content-Disposition": f'attachment; filename="{base}_{act}.{ext}"',
            "X-Original-Size": str(orig_size),
            "X-Compressed-Size": str(comp_size),
            "X-Savings-Percent": str(savings),
        },
    )


# Unified /compress route for convenience
@app.post("/compress")
async def unified_compress(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    mode: str | None = Form(None),
    quality: int = Form(75),
    output_format: str = Form("webp"),
    preset: str = Form("balanced"),
):
    ctype = (file.content_type or "").lower()
    fname = (file.filename or "").lower()
    is_vid = (mode or "").lower() == "video" or ctype.startswith("video/") or fname.endswith((".mp4", ".mov", ".mkv", ".webm", ".avi"))
    if is_vid:
        return await video_convert(background_tasks=background_tasks, action="compress_video", preset=preset, file=file, url=None, bitrate="192k", start_sec=0.0, end_sec=10.0, width=1280)
    return await process_image(file=file, action="compress", quality=quality, output_format=output_format, width=1280, height=0, scale=2.0)


# ==============================================================================
# 7. REAL PDF TOOLS (/api/pdf-process - pypdf, PyMuPDF/fitz, reportlab)
# ==============================================================================


def _parse_page_indices(spec: str, total_pages: int) -> list[int]:
    indices: list[int] = []
    for part in (spec or "").split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            if a.strip().isdigit() and b.strip().isdigit():
                start_i = max(1, int(a.strip()))
                end_i = min(total_pages, int(b.strip()))
                indices.extend(range(start_i - 1, end_i))
        elif part.isdigit():
            idx = int(part) - 1
            if 0 <= idx < total_pages:
                indices.append(idx)
    return indices


@app.post("/api/pdf-process")
async def process_pdf(
    files: list[UploadFile] | None = File(None),
    action: str = Form("compress"),
    pages: str = Form(""),
    angle: int = Form(90),
    password: str = Form(""),
    watermark_text: str = Form("CONFIDENTIAL"),
    text_content: str = Form(""),
):
    act = (action or "compress").lower().strip()
    raw_items: list[tuple[str, bytes]] = []
    total_orig = 0
    if files:
        if len(files) > 25:
            raise HTTPException(413, detail="Upload at most 25 PDF/image files.")
        for f in files:
            b = await read_upload(f)
            if b:
                raw_items.append((f.filename or "doc.pdf", b))
                total_orig += len(b)
                if total_orig > 100 * 1024 * 1024:
                    raise HTTPException(413, detail="Combined files exceed 100 MB.")

    if act == "text_to_pdf":
        plain_text = (text_content or "").strip()
        if not plain_text and raw_items:
            plain_text = raw_items[0][1].decode("utf-8", errors="replace").strip()
            total_orig = len(raw_items[0][1])
        if not plain_text:
            raise HTTPException(status_code=400, detail="Enter text or upload a .txt file to convert to PDF.")
        base = sanitize_filename(os.path.splitext(raw_items[0][0])[0], "document") if raw_items else "text_document"
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=(595.27, 841.89))  # A4
        c.setFont("Helvetica", 11)
        y = 795.0
        for paragraph in plain_text.splitlines():
            words = paragraph.split(" ")
            line = ""
            for word in words:
                test = f"{line} {word}".strip()
                if len(test) > 85:
                    c.drawString(48, y, line)
                    y -= 16
                    line = word
                    if y < 52:
                        c.showPage()
                        c.setFont("Helvetica", 11)
                        y = 795.0
                else:
                    line = test
            c.drawString(48, y, line)
            y -= 18
            if y < 52:
                c.showPage()
                c.setFont("Helvetica", 11)
                y = 795.0
        c.save()
        out_bytes = buf.getvalue()
        return Response(
            content=out_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{base}.pdf"',
                "X-Original-Size": str(max(total_orig, len(plain_text.encode("utf-8")))),
                "X-Compressed-Size": str(len(out_bytes)),
                "X-Savings-Percent": "0",
            },
        )

    if not raw_items:
        raise HTTPException(status_code=400, detail="Please upload at least one PDF or image file.")

    first_name, first_bytes = raw_items[0]
    base = sanitize_filename(os.path.splitext(first_name)[0], "document")

    try:
        if act == "merge":
            writer = PdfWriter()
            for _, data in raw_items:
                reader = PdfReader(io.BytesIO(data))
                for page in reader.pages:
                    writer.add_page(page)
            out_buf = io.BytesIO()
            writer.write(out_buf)
            out_bytes = out_buf.getvalue()
            mime, ext = "application/pdf", "pdf"

        elif act == "jpg_to_pdf":
            pil_images = [ImageOps.exif_transpose(Image.open(io.BytesIO(d))).convert("RGB") for _, d in raw_items]
            out_buf = io.BytesIO()
            pil_images[0].save(out_buf, format="PDF", save_all=True, append_images=pil_images[1:], resolution=150.0)
            out_bytes = out_buf.getvalue()
            mime, ext = "application/pdf", "pdf"

        elif act == "compress":
            doc = fitz.open(stream=first_bytes, filetype="pdf")
            out_bytes = doc.tobytes(garbage=4, deflate=True, clean=True)
            doc.close()
            mime, ext = "application/pdf", "pdf"

        elif act == "grayscale":
            src_doc = fitz.open(stream=first_bytes, filetype="pdf")
            out_doc = fitz.open()
            for page in src_doc:
                pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), colorspace=fitz.csGRAY, alpha=False)
                new_page = out_doc.new_page(width=page.rect.width, height=page.rect.height)
                new_page.insert_image(page.rect, stream=pix.tobytes("jpeg", jpg_quality=85))
            out_bytes = out_doc.tobytes(deflate=True)
            src_doc.close()
            out_doc.close()
            mime, ext = "application/pdf", "pdf"

        elif act == "split":
            reader = PdfReader(io.BytesIO(first_bytes))
            zbuf = io.BytesIO()
            with zipfile.ZipFile(zbuf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                for idx, page in enumerate(reader.pages, start=1):
                    w = PdfWriter()
                    w.add_page(page)
                    pbuf = io.BytesIO()
                    w.write(pbuf)
                    zf.writestr(f"{base}_page_{idx:03d}.pdf", pbuf.getvalue())
            out_bytes = zbuf.getvalue()
            mime, ext = "application/zip", "zip"

        elif act == "pdf_to_jpg":
            doc = fitz.open(stream=first_bytes, filetype="pdf")
            zbuf = io.BytesIO()
            with zipfile.ZipFile(zbuf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                for idx, page in enumerate(doc, start=1):
                    pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
                    zf.writestr(f"{base}_page_{idx:03d}.jpg", pix.tobytes("jpeg", jpg_quality=90))
            doc.close()
            out_bytes = zbuf.getvalue()
            mime, ext = "application/zip", "zip"

        elif act == "extract_images":
            doc = fitz.open(stream=first_bytes, filetype="pdf")
            zbuf = io.BytesIO()
            count = 0
            with zipfile.ZipFile(zbuf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                for pno in range(len(doc)):
                    for img_info in doc.get_page_images(pno, full=True):
                        xref = img_info[0]
                        extracted = doc.extract_image(xref)
                        if extracted and extracted.get("image"):
                            count += 1
                            iext = extracted.get("ext", "png")
                            zf.writestr(f"pdf_img_{count:03d}.{iext}", extracted["image"])
            doc.close()
            if count == 0:
                raise HTTPException(status_code=404, detail="No embedded images found in this PDF.")
            out_bytes = zbuf.getvalue()
            mime, ext = "application/zip", "zip"

        elif act == "rotate":
            reader = PdfReader(io.BytesIO(first_bytes))
            writer = PdfWriter()
            deg = int(angle) % 360
            for page in reader.pages:
                page.rotate(deg)
                writer.add_page(page)
            out_buf = io.BytesIO()
            writer.write(out_buf)
            out_bytes = out_buf.getvalue()
            mime, ext = "application/pdf", "pdf"

        elif act == "rearrange":
            reader = PdfReader(io.BytesIO(first_bytes))
            order = _parse_page_indices(pages, len(reader.pages))
            if not order:
                raise HTTPException(status_code=400, detail="Provide page order like 3,1,2.")
            writer = PdfWriter()
            for idx in order:
                writer.add_page(reader.pages[idx])
            out_buf = io.BytesIO()
            writer.write(out_buf)
            out_bytes = out_buf.getvalue()
            mime, ext = "application/pdf", "pdf"

        elif act == "reverse_pages":
            reader = PdfReader(io.BytesIO(first_bytes))
            writer = PdfWriter()
            for page in reversed(reader.pages):
                writer.add_page(page)
            out_buf = io.BytesIO()
            writer.write(out_buf)
            out_bytes = out_buf.getvalue()
            mime, ext = "application/pdf", "pdf"

        elif act == "delete_pages":
            reader = PdfReader(io.BytesIO(first_bytes))
            to_delete = set(_parse_page_indices(pages, len(reader.pages)))
            writer = PdfWriter()
            for idx, page in enumerate(reader.pages):
                if idx not in to_delete:
                    writer.add_page(page)
            if len(writer.pages) == 0:
                raise HTTPException(status_code=400, detail="Cannot delete all pages from PDF.")
            out_buf = io.BytesIO()
            writer.write(out_buf)
            out_bytes = out_buf.getvalue()
            mime, ext = "application/pdf", "pdf"

        elif act == "unlock":
            reader = PdfReader(io.BytesIO(first_bytes))
            if reader.is_encrypted:
                res = reader.decrypt(password or "")
                if res == 0:
                    raise HTTPException(status_code=400, detail="Incorrect PDF password.")
            writer = PdfWriter()
            for page in reader.pages:
                writer.add_page(page)
            out_buf = io.BytesIO()
            writer.write(out_buf)
            out_bytes = out_buf.getvalue()
            mime, ext = "application/pdf", "pdf"

        elif act == "protect":
            if not (password or "").strip():
                raise HTTPException(status_code=400, detail="Please enter a password to lock this PDF.")
            reader = PdfReader(io.BytesIO(first_bytes))
            writer = PdfWriter()
            for page in reader.pages:
                writer.add_page(page)
            writer.encrypt(password.strip())
            out_buf = io.BytesIO()
            writer.write(out_buf)
            out_bytes = out_buf.getvalue()
            mime, ext = "application/pdf", "pdf"

        elif act == "add_page_numbers":
            reader = PdfReader(io.BytesIO(first_bytes))
            writer = PdfWriter()
            total = len(reader.pages)
            for idx, page in enumerate(reader.pages, start=1):
                w = float(page.mediabox.width)
                h = float(page.mediabox.height)
                overlay_buf = io.BytesIO()
                c = canvas.Canvas(overlay_buf, pagesize=(w, h))
                c.setFont("Helvetica-Bold", 10)
                c.setFillColor(Color(0.2, 0.2, 0.2, alpha=0.85))
                c.drawCentredString(w / 2.0, 20, f"Page {idx} of {total}")
                c.save()
                overlay_buf.seek(0)
                page.merge_page(PdfReader(overlay_buf).pages[0])
                writer.add_page(page)
            out_buf = io.BytesIO()
            writer.write(out_buf)
            out_bytes = out_buf.getvalue()
            mime, ext = "application/pdf", "pdf"

        elif act == "header_footer":
            reader = PdfReader(io.BytesIO(first_bytes))
            writer = PdfWriter()
            hf_str = (watermark_text or "All Media Tools Document").strip()[:60]
            for page in reader.pages:
                w = float(page.mediabox.width)
                h = float(page.mediabox.height)
                overlay_buf = io.BytesIO()
                c = canvas.Canvas(overlay_buf, pagesize=(w, h))
                c.setFont("Helvetica-Bold", 9)
                c.setFillColor(Color(0.35, 0.35, 0.4, alpha=0.85))
                c.drawCentredString(w / 2.0, h - 22, hf_str)
                c.drawCentredString(w / 2.0, 18, hf_str)
                c.save()
                overlay_buf.seek(0)
                page.merge_page(PdfReader(overlay_buf).pages[0])
                writer.add_page(page)
            out_buf = io.BytesIO()
            writer.write(out_buf)
            out_bytes = out_buf.getvalue()
            mime, ext = "application/pdf", "pdf"

        elif act == "esign":
            reader = PdfReader(io.BytesIO(first_bytes))
            writer = PdfWriter()
            sig_str = (watermark_text or "Signed Digitally").strip()[:40]
            total = len(reader.pages)
            for idx, page in enumerate(reader.pages, start=1):
                if idx == total:
                    w = float(page.mediabox.width)
                    h = float(page.mediabox.height)
                    overlay_buf = io.BytesIO()
                    c = canvas.Canvas(overlay_buf, pagesize=(w, h))
                    c.setStrokeColor(Color(0.15, 0.39, 0.92, alpha=0.8))
                    c.rect(w - 190, 26, 155, 42, fill=0, stroke=1)
                    c.setFont("Times-BoldItalic", 15)
                    c.setFillColor(Color(0.1, 0.25, 0.65, alpha=0.95))
                    c.drawString(w - 180, 48, sig_str)
                    c.setFont("Helvetica", 7)
                    c.drawString(w - 180, 33, f"Signed {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}")
                    c.save()
                    overlay_buf.seek(0)
                    page.merge_page(PdfReader(overlay_buf).pages[0])
                writer.add_page(page)
            out_buf = io.BytesIO()
            writer.write(out_buf)
            out_bytes = out_buf.getvalue()
            mime, ext = "application/pdf", "pdf"

        elif act == "watermark":
            reader = PdfReader(io.BytesIO(first_bytes))
            writer = PdfWriter()
            wm_str = (watermark_text or "ALLMEDIA TOOLS").strip()[:45]
            for page in reader.pages:
                w = float(page.mediabox.width)
                h = float(page.mediabox.height)
                overlay_buf = io.BytesIO()
                c = canvas.Canvas(overlay_buf, pagesize=(w, h))
                c.saveState()
                c.translate(w / 2.0, h / 2.0)
                c.rotate(40)
                c.setFont("Helvetica-Bold", 38)
                c.setFillColor(Color(0.15, 0.39, 0.92, alpha=0.22))
                c.drawCentredString(0, 0, wm_str)
                c.restoreState()
                c.save()
                overlay_buf.seek(0)
                page.merge_page(PdfReader(overlay_buf).pages[0])
                writer.add_page(page)
            out_buf = io.BytesIO()
            writer.write(out_buf)
            out_bytes = out_buf.getvalue()
            mime, ext = "application/pdf", "pdf"

        elif act == "crop":
            reader = PdfReader(io.BytesIO(first_bytes))
            writer = PdfWriter()
            for page in reader.pages:
                llx, lly = page.mediabox.lower_left
                urx, ury = page.mediabox.upper_right
                mx = (float(urx) - float(llx)) * 0.08
                my = (float(ury) - float(lly)) * 0.08
                page.cropbox.lower_left = (float(llx) + mx, float(lly) + my)
                page.cropbox.upper_right = (float(urx) - mx, float(ury) - my)
                writer.add_page(page)
            out_buf = io.BytesIO()
            writer.write(out_buf)
            out_bytes = out_buf.getvalue()
            mime, ext = "application/pdf", "pdf"

        elif act == "pdf_to_word":
            doc = fitz.open(stream=first_bytes, filetype="pdf")
            extracted_pages = [page.get_text("text") for page in doc]
            doc.close()
            full_text = "\n\n--- Page Break ---\n\n".join(extracted_pages)
            out_bytes = full_text.encode("utf-8")
            mime, ext = "text/plain; charset=utf-8", "txt"

        else:
            raise HTTPException(status_code=400, detail=f"Unsupported PDF action: {act}")

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"PDF processing failed: {exc}")

    comp_size = len(out_bytes)
    savings = max(0, round((1 - (comp_size / max(total_orig, 1))) * 100))
    return Response(
        content=out_bytes,
        media_type=mime,
        headers={
            "Content-Disposition": f'attachment; filename="{base}_{act}.{ext}"',
            "X-Original-Size": str(total_orig),
            "X-Compressed-Size": str(comp_size),
            "X-Savings-Percent": str(savings),
        },
    )


# ==============================================================================
# 8. YOUTUBE TRANSCRIPT + THUMBNAIL & INSTA DP SAVER
# ==============================================================================


@app.post("/api/youtube-transcript")
def extract_youtube_transcript(req: UrlPayload):
    url = validate_http_url(req.url)
    tmp_dir = create_temp_dir("yt_sub_")
    try:
        ydl_opts: dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "writesubtitles": True,
            "writeautomaticsub": True,
            "subtitleslangs": ["en", "ur", "hi"],
            "subtitlesformat": "vtt",
            "outtmpl": os.path.join(tmp_dir, "subs"),
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = info.get("title") or "YouTube Video"

        vtt_files = [os.path.join(tmp_dir, f) for f in os.listdir(tmp_dir) if f.endswith(".vtt")]
        if not vtt_files:
            raise HTTPException(status_code=404, detail="No captions/transcript found for this video.")

        lines: list[str] = []
        seen: set[str] = set()
        with open(vtt_files[0], "r", encoding="utf-8", errors="ignore") as f:
            for raw in f:
                s = re.sub(r"<[^>]+>", "", raw).strip()
                if not s or s.startswith("WEBVTT") or s.startswith("Kind:") or s.startswith("Language:") or "-->" in s:
                    continue
                if s not in seen:
                    seen.add(s)
                    lines.append(s)
        return {"title": title, "transcript": " ".join(lines)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Transcript extraction failed: {exc}")
    finally:
        cleanup_dir(tmp_dir)


@app.post("/thumbnail-dp")
@app.post("/api/tools/thumbnail-dp")
def extract_thumbnail_or_dp(req: UrlPayload, request: Request):
    raw_input = (req.url or "").strip()
    if raw_input.startswith("@"):
        raw_input = f"https://www.instagram.com/{raw_input.lstrip('@').strip('/')}/"
    url = validate_http_url(raw_input)
    base_url = str(request.base_url).rstrip("/")
    session = build_requests_session()

    yt_match = re.search(
        r"(?:youtube\.com/watch\?.*?v=|youtu\.be/|youtube\.com/shorts/|youtube\.com/embed/|youtube\.com/live/)([a-zA-Z0-9_-]{11})",
        url,
    )
    if yt_match:
        vid = yt_match.group(1)
        variants = [
            ("Max Resolution HD (1280x720)", f"https://i.ytimg.com/vi/{vid}/maxresdefault.jpg", f"yt_{vid}_maxres.jpg"),
            ("Standard Definition (640x480)", f"https://i.ytimg.com/vi/{vid}/sddefault.jpg", f"yt_{vid}_sd.jpg"),
            ("High Quality (480x360)", f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg", f"yt_{vid}_hq.jpg"),
        ]
        items = [
            {
                "label": lbl,
                "url": img_u,
                "download_url": f"{base_url}/api/images/proxy?url={urllib.parse.quote(img_u, safe='')}&filename={fname}",
            }
            for lbl, img_u, fname in variants
        ]
        return {"type": "youtube_thumbnail", "title": f"YouTube Video ({vid})", "items": items}

    if "instagram.com" in url.lower():
        prof_match = re.match(r"^https?://(?:www\.)?instagram\.com/([a-zA-Z0-9._]+)/?(?:\?.*)?$", url)
        if prof_match and prof_match.group(1) not in ("p", "reel", "reels", "tv", "stories", "explore"):
            username = prof_match.group(1)
            try:
                api_res = session.get(
                    f"https://www.instagram.com/api/v1/users/web_profile_info/?username={username}",
                    headers={"X-IG-App-ID": "936619743392459", "User-Agent": DESKTOP_UA},
                    timeout=12,
                )
                if api_res.ok:
                    user_data = api_res.json().get("data", {}).get("user", {})
                    hd_pic = user_data.get("profile_pic_url_hd") or user_data.get("profile_pic_url")
                    if hd_pic:
                        return {
                            "type": "instagram_dp",
                            "title": f"@{username} HD DP",
                            "items": [
                                {
                                    "label": "Original Full-Size DP",
                                    "url": hd_pic,
                                    "download_url": f"{base_url}/api/images/proxy?url={urllib.parse.quote(hd_pic, safe='')}&filename={username}_dp.jpg",
                                }
                            ],
                        }
            except Exception:
                pass

    title, bs_imgs = _extract_images_bs4(url)
    if not bs_imgs:
        raise HTTPException(status_code=404, detail="Could not extract thumbnail or DP.")
    top = bs_imgs[0]
    return {
        "type": "generic_thumbnail",
        "title": title,
        "items": [
            {
                "label": "Extracted HD Thumbnail",
                "url": top["url"],
                "download_url": f"{base_url}/api/images/proxy?url={urllib.parse.quote(top['url'], safe='')}&filename={top['filename']}",
            }
        ],
    }


# Mount after API routes so the homepage and tools are served from the domain root.
_web_dir = os.path.join(os.path.dirname(__file__), "web")
if os.path.isdir(_web_dir):
    @app.get("/robots.txt", include_in_schema=False)
    def robots_txt():
        return FileResponse(os.path.join(_web_dir, "robots.txt"), media_type="text/plain")

    @app.get("/sitemap.xml", include_in_schema=False)
    def sitemap_xml():
        sitemap_path = os.path.join(_web_dir, "sitemap.xml")
        if not os.path.isfile(sitemap_path):
            raise HTTPException(status_code=404, detail="Sitemap is generated after the public HTTPS URL is configured.")
        return FileResponse(sitemap_path, media_type="application/xml")

    @app.middleware("http")
    async def normalize_public_page_urls(request: Request, call_next):
        path = request.url.path
        public_pages = {
            "/",
            "/compress-image/",
            "/resize-image/",
            "/png-to-jpg/",
            "/jpg-to-pdf/",
            "/merge-pdf/",
            "/mp4-to-mp3/",
        }
        tool_slugs = {page.strip("/") for page in public_pages if page != "/"}
        if path in {"/index.html", "/tools", "/tools/index.html"}:
            target = "/" if path == "/index.html" else "/tools/"
        elif path.endswith("/index.html") and path[:-len("index.html")] in public_pages - {"/"}:
            target = path[:-len("index.html")]
        elif path in {f"/{slug}" for slug in tool_slugs}:
            target = f"{path}/"
        elif path.startswith("/tools/") and path.endswith("/index.html"):
            target = path[:-len("index.html")]
        elif path.startswith("/tools/") and not path.endswith("/") and "." not in path.rsplit("/", 1)[-1]:
            target = f"{path}/"
        else:
            target = None
        if target:
            return RedirectResponse(request.url.replace(path=target), status_code=308)
        return await call_next(request)

    app.mount("/tools", StaticFiles(directory=_web_dir, html=True), name="tools")
    app.mount("/", StaticFiles(directory=_web_dir, html=True), name="homepage")
