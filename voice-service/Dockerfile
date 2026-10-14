FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    AMIBOT_VOICE_DEVICE=cpu \
    AMIBOT_VOICE_REFERENCE=/data/reference.wav \
    HF_HOME=/data/cache/huggingface \
    TORCH_HOME=/data/cache/torch \
    PKUSEG_HOME=/data/cache/pkuseg \
    OMP_NUM_THREADS=4 \
    MKL_NUM_THREADS=4 \
    PORT=8001

RUN apt-get update \
    && apt-get install -y --no-install-recommends libsndfile1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./

# Install CPU wheels first so Chatterbox does not pull CUDA dependencies on Render.
RUN python -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.6.0 torchaudio==2.6.0 \
    && python -m pip install -r requirements.txt \
    && python -m pip check

# Never copy recordings, local secrets, downloaded models, or the local venv.
COPY app.py speech_model.py ./
RUN mkdir -p /data

EXPOSE 8001
CMD ["sh", "-c", "exec python -m uvicorn app:app --host 0.0.0.0 --port ${PORT:-8001} --workers 1"]
