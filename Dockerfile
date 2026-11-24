FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 appuser
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=appuser:appuser backend/ .
COPY --chown=appuser:appuser web/ ./web/
USER appuser
ENV HOME=/home/appuser PYTHONUNBUFFERED=1 WORK_TMP_DIR=/tmp/allmedia_work
EXPOSE 10000
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000} --limit-concurrency 4 --timeout-keep-alive 5"]
