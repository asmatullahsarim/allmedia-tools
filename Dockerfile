FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 ca-certificates curl unzip tesseract-ocr tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 ca-certificates curl unzip && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh -s -- -y
RUN useradd -m -u 1000 appuser
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=appuser:appuser backend/ .
COPY --chown=appuser:appuser web/ ./web/
USER appuser
ENV HOME=/home/appuser DENO_DIR=/home/appuser/.cache/deno PYTHONUNBUFFERED=1 WORK_TMP_DIR=/tmp/allmedia_work
EXPOSE 10000
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000} --limit-concurrency 12 --timeout-keep-alive 5"]
