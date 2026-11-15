"""URL and upload boundaries. Also deploy with outbound private-network blocking."""
import ipaddress
import socket
from urllib.parse import urlsplit

import requests
from fastapi import HTTPException

MAX_UPLOAD_BYTES = 180 * 1024 * 1024
MAX_REMOTE_BYTES = 25 * 1024 * 1024


def validate_public_url(url: str) -> str:
    value = (url or "").strip()
    try:
        parsed = urlsplit(value)
        if parsed.scheme.lower() not in ("http", "https") or not parsed.hostname:
            raise ValueError()
        if parsed.username is not None or parsed.password is not None:
            raise ValueError()
        if parsed.port not in (None, 80, 443):
            raise ValueError()
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
            raise ValueError()
    except (ValueError, OSError):
        raise HTTPException(400, "Use a public HTTP(S) URL on port 80 or 443.")
    return value


class PublicSession(requests.Session):
    """Requests calls, including redirect hops, must target public addresses."""
    def send(self, request, **kwargs):
        validate_public_url(request.url)
        return super().send(request, **kwargs)


async def read_upload(file, limit=25 * 1024 * 1024):
    chunks = []
    size = 0
    while chunk := await file.read(1024 * 1024):
        size += len(chunk)
        if size > limit:
            raise HTTPException(413, "Upload exceeds the allowed file size.")
        chunks.append(chunk)
    return b"".join(chunks)


def read_remote_image(response, limit=MAX_REMOTE_BYTES):
    with response:
        response.raise_for_status()
        if not response.headers.get("Content-Type", "").lower().startswith("image/"):
            raise HTTPException(400, "Remote resource is not an image.")
        data = bytearray()
        for chunk in response.iter_content(65536):
            data.extend(chunk)
            if len(data) > limit:
                raise HTTPException(413, "Remote image exceeds 25 MB.")
        return bytes(data)

class UploadLimitMiddleware:
    """Bound the request before multipart parsing, including chunked requests.

    Spool to disk so an accepted large video does not require a second RAM copy.
    """
    def __init__(self, app, max_bytes=MAX_UPLOAD_BYTES + 1024 * 1024):
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope.get('method') not in ('POST', 'PUT', 'PATCH'):
            return await self.app(scope, receive, send)
        from tempfile import SpooledTemporaryFile
        from starlette.responses import JSONResponse
        headers = dict(scope.get('headers', []))
        try:
            declared = int(headers.get(b'content-length', b'0'))
        except ValueError:
            return await JSONResponse({'detail': 'Invalid Content-Length'}, status_code=400)(scope, receive, send)
        if declared < 0 or declared > self.max_bytes:
            return await JSONResponse({'detail': 'Request too large'}, status_code=413)(scope, receive, send)
        with SpooledTemporaryFile(max_size=1024 * 1024) as body:
            size = 0
            while True:
                message = await receive()
                if message['type'] == 'http.disconnect':
                    return
                chunk = message.get('body', b'')
                size += len(chunk)
                if size > self.max_bytes:
                    return await JSONResponse({'detail': 'Request too large'}, status_code=413)(scope, receive, send)
                body.write(chunk)
                if not message.get('more_body', False):
                    break
            body.seek(0)
            finished = False
            async def replay():
                nonlocal finished
                if finished:
                    return await receive()
                chunk = body.read(65536)
                more = body.tell() < size
                finished = not more
                return {'type': 'http.request', 'body': chunk, 'more_body': more}
            await self.app(scope, replay, send)
