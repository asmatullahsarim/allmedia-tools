import ast
import asyncio
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException, FastAPI, UploadFile
from fastapi.responses import Response
from fastapi.testclient import TestClient
from PIL import Image, ImageOps, ImageEnhance, ImageFilter
try:
    import requests
except ModuleNotFoundError:
    import pip._vendor.requests as requests
    sys.modules["requests"] = requests
from security import validate_public_url, read_upload, read_remote_image, UploadLimitMiddleware


class Boundaries(unittest.TestCase):
    def test_public_url(self):
        with patch('socket.getaddrinfo', return_value=[(2, 1, 6, '', ('93.184.216.34', 443))]):
            self.assertEqual(validate_public_url('https://example.com/a'), 'https://example.com/a')

    def test_private_destinations(self):
        for address in ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1']:
            with self.subTest(address=address), patch('socket.getaddrinfo', return_value=[(2, 1, 6, '', (address, 443))]):
                with self.assertRaises(HTTPException): validate_public_url('https://example.com')

    def test_bad_url_forms(self):
        for url in ['file:///etc/passwd', 'https://user:pass@example.com', 'http://example.com:8080', 'https://']:
            with self.subTest(url=url), self.assertRaises(HTTPException): validate_public_url(url)

    def test_upload_limit(self):
        file = UploadFile(filename='a', file=io.BytesIO(b'12345'))
        with self.assertRaises(HTTPException): asyncio.run(read_upload(file, limit=4))

    def test_small_upload(self):
        file = UploadFile(filename='a', file=io.BytesIO(b'123'))
        self.assertEqual(asyncio.run(read_upload(file, limit=4)), b'123')

    def test_body_limit_before_parsing(self):
        app = FastAPI()
        app.add_middleware(UploadLimitMiddleware, max_bytes=4)
        @app.post('/')
        def ok(): return {'ok': True}
        with TestClient(app) as client:
            self.assertEqual(client.post('/', content=b'12345').status_code, 413)
            self.assertEqual(client.post('/', content=b'123').status_code, 200)

    def test_chunked_body_limit(self):
        seen = []
        async def app(scope, receive, send): seen.append('called')
        messages = iter([{'type': 'http.request', 'body': b'123', 'more_body': True}, {'type': 'http.request', 'body': b'45', 'more_body': False}])
        sent = []
        async def receive(): return next(messages)
        async def send(message): sent.append(message)
        asyncio.run(UploadLimitMiddleware(app, 4)({'type':'http', 'method':'POST', 'headers':[]}, receive, send))
        self.assertEqual(sent[0]['status'], 413)
        self.assertEqual(seen, [])


# Execute the real image/compress functions without loading unrelated ML models.
# These are unit tests, not a full deployed-server integration test.
def load_functions():
    import os, re
    from fastapi import File, Form, BackgroundTasks
    tree = ast.parse((Path(__file__).resolve().parents[1] / 'main.py').read_text())
    wanted = {'sanitize_filename', 'process_image', 'unified_compress', '_parse_page_indices', 'process_pdf'}
    nodes = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in wanted]
    for node in nodes: node.decorator_list = []
    import zipfile, time, fitz
    from pypdf import PdfReader, PdfWriter
    from reportlab.pdfgen import canvas
    from reportlab.lib.colors import Color
    env = dict(globals(), os=os, re=re, File=File, Form=Form, BackgroundTasks=BackgroundTasks, zipfile=zipfile, time=time, fitz=fitz, PdfReader=PdfReader, PdfWriter=PdfWriter, canvas=canvas, Color=Color)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'main.py', 'exec'), env)
    return env


class ImageRegressions(unittest.TestCase):
    def test_real_image_conversion(self):
        env = load_functions()
        for action, fmt in [('png_to_jpg', 'JPEG'), ('jpg_to_png', 'PNG'), ('png_to_webp', 'WEBP'), ('resize', 'WEBP')]:
            with self.subTest(action=action):
                buf = io.BytesIO(); Image.new('RGBA', (80, 60), (255, 0, 0, 128)).save(buf, 'PNG')
                file = UploadFile(filename='sample.png', file=io.BytesIO(buf.getvalue()))
                response = asyncio.run(env['process_image'](file=file, action=action, quality=75, output_format='webp', width=100, height=50, scale=2.0))
                result = Image.open(io.BytesIO(response.body))
                self.assertEqual(result.format, fmt)
                if action == 'resize': self.assertEqual(result.size, (100, 50))

    def test_pdf_merge_and_rotate(self):
        from pypdf import PdfWriter, PdfReader
        env = load_functions()
        buf = io.BytesIO(); writer = PdfWriter(); writer.add_blank_page(width=200, height=300); writer.write(buf)
        for action, count in [('merge', 2), ('rotate', 1)]:
            files = [UploadFile(filename='test.pdf', file=io.BytesIO(buf.getvalue())) for _ in range(2 if action == 'merge' else 1)]
            response = asyncio.run(env['process_pdf'](files=files, action=action, pages='', angle=90, password='', watermark_text='TEST', text_content=''))
            result = PdfReader(io.BytesIO(response.body))
            self.assertEqual(len(result.pages), count)
            if action == 'rotate': self.assertEqual(result.pages[0].rotation, 90)

    def test_unified_compress_passes_plain_defaults(self):
        env = load_functions()
        async def video_convert(**kwargs):
            self.assertIsNone(kwargs['url'])
            self.assertEqual(kwargs['bitrate'], '192k')
            self.assertEqual(kwargs['width'], 1280)
            return 'ok'
        env['video_convert'] = video_convert
        file = UploadFile(filename='clip.mp4', file=io.BytesIO(b'video'))
        from fastapi import BackgroundTasks
        self.assertEqual(asyncio.run(env['unified_compress'](background_tasks=BackgroundTasks(), file=file, mode='video', quality=75, output_format='webp', preset='balanced')), 'ok')


if __name__ == '__main__': unittest.main()
