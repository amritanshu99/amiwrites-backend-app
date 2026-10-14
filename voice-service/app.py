"""Private Chatterbox + Whisper worker. Only the Express backend may call it."""
import hmac
import io
import logging
import os
import re
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from typing import Literal
from starlette.concurrency import run_in_threadpool

ROOT = Path(__file__).resolve().parent
os.environ.setdefault("PKUSEG_HOME", str(ROOT / ".cache" / "pkuseg"))
REFERENCE = Path(os.getenv("AMIBOT_VOICE_REFERENCE", str(ROOT / "data" / "reference.wav")))
TOKEN = os.getenv("AMIBOT_VOICE_TOKEN", "")
MAX_BYTES = 10 * 1024 * 1024
logger = logging.getLogger("amibot.voice")
model_lock = threading.Lock()
models = {}
model_error = None


def load_models():
    global model_error
    try:
        from speech_model import load_speech_model
        import torch
        from faster_whisper import WhisperModel
        device = os.getenv("AMIBOT_VOICE_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
        # Keep transcription on CPU by default to leave GPU memory for Chatterbox.
        stt = WhisperModel(os.getenv("AMIBOT_WHISPER_MODEL", "small"), device="cpu", compute_type="int8")
        tts = load_speech_model(device)
        with model_lock:
            if REFERENCE.is_file():
                tts.prepare_conditionals(str(REFERENCE))
            models.update(stt=stt, tts=tts)
        logger.info("Voice models ready on %s", device)
    except Exception:
        model_error = "Voice models failed to load. Check the worker logs and restart."
        logger.exception("Unable to load voice models")


@asynccontextmanager
async def lifespan(app):
    if len(TOKEN) < 24:
        raise RuntimeError("Set AMIBOT_VOICE_TOKEN to a random secret of at least 24 characters.")
    REFERENCE.parent.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=load_models, daemon=True).start()
    yield


async def authorize(authorization: str = Header(default="")):
    if not TOKEN or not hmac.compare_digest(authorization, f"Bearer {TOKEN}"):
        raise HTTPException(401, "Unauthorized")


app = FastAPI(lifespan=lifespan, dependencies=[Depends(authorize)], docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def limit_body(request, call_next):
    # Bound chunked requests as well as Content-Length before multipart parsing.
    total = 0
    receive = request._receive

    async def bounded_receive():
        nonlocal total
        message = await receive()
        total += len(message.get("body", b""))
        if total > MAX_BYTES + 65536:
            raise HTTPException(413, "Audio must be smaller than 10 MB.")
        return message

    request._receive = bounded_receive
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response


def require_models():
    if not models:
        raise HTTPException(503, model_error or "Voice models are warming up. Try again shortly.")


@app.get("/health")
def health():
    return {"ready": bool(models) and REFERENCE.is_file(), "modelReady": bool(models), "referenceReady": REFERENCE.is_file(), "modelError": bool(model_error)}


async def read_audio(upload: UploadFile, maximum_seconds=60):
    """Decode with PyAV, stopping at the duration limit, including compressed inputs."""
    raw = await upload.read(MAX_BYTES + 1)
    await upload.close()
    if not raw or len(raw) > MAX_BYTES:
        raise HTTPException(413, "Audio must be between 1 byte and 10 MB.")

    def decode():
        import av
        frames = []
        count = 0
        try:
            with av.open(io.BytesIO(raw)) as container:
                resampler = av.AudioResampler(format="fltp", layout="mono", rate=24000)
                for frame in container.decode(audio=0):
                    for converted in resampler.resample(frame):
                        chunk = converted.to_ndarray().reshape(-1)
                        count += chunk.size
                        if count > maximum_seconds * 24000:
                            raise HTTPException(422, f"Please keep recordings under {maximum_seconds} seconds.")
                        frames.append(chunk)
                for converted in resampler.resample(None):
                    frames.append(converted.to_ndarray().reshape(-1))
            samples = np.concatenate(frames) if frames else np.array([], dtype=np.float32)
            if not samples.size or not np.isfinite(samples).all():
                raise ValueError("Empty audio")
            if samples.size > maximum_seconds * 24000:
                raise HTTPException(422, f"Please keep recordings under {maximum_seconds} seconds.")
            return samples
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(422, "This recording could not be decoded. Try a WAV, MP3, M4A, or browser recording.") from error

    return await run_in_threadpool(decode)


def exclusive(work):
    # Avoid an unbounded queue of GPU work. A model's voice conditionals are mutable.
    if not model_lock.acquire(blocking=False):
        raise HTTPException(429, "The voice service is busy. Please try again in a moment.")
    try:
        return work()
    finally:
        model_lock.release()


@app.post("/reference")
async def reference(audio: UploadFile = File(...)):
    samples = await read_audio(audio, maximum_seconds=30)
    duration = samples.size / 24000
    if duration < 5:
        raise HTTPException(422, "Record at least 5 seconds of your natural speaking voice (15–30 seconds recommended).")
    if float(np.sqrt(np.mean(samples ** 2))) < 0.003:
        raise HTTPException(422, "The recording is too quiet. Move closer to the microphone and try again.")

    def save():
        temporary = REFERENCE.with_suffix(".new.wav")
        try:
            sf.write(str(temporary), samples, 24000, subtype="PCM_16")
            if models:
                models["tts"].prepare_conditionals(str(temporary))
            os.replace(temporary, REFERENCE)
        finally:
            temporary.unlink(missing_ok=True)
        return {"referenceReady": True, "duration": round(duration, 1)}

    return await run_in_threadpool(exclusive, save)


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...), language: Literal["auto", "en", "hi"] = Form("auto")):
    require_models()
    samples = await read_audio(audio)

    def recognize():
        import librosa
        waveform = librosa.resample(samples, orig_sr=24000, target_sr=16000)
        segments, info = models["stt"].transcribe(waveform, language=None if language == "auto" else language,
                                                beam_size=3, vad_filter=True, condition_on_previous_text=False)
        text = " ".join(segment.text.strip() for segment in segments if segment.no_speech_prob < 0.7).strip()
        return {"text": text[:2000], "language": info.language}

    return await run_in_threadpool(exclusive, recognize)


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=600)
    language: Literal["en", "hi"] = "en"
    tone: Literal["natural", "calm", "expressive"] = "natural"


@app.post("/speech")
async def speech(body: SpeechRequest):
    require_models()
    if not REFERENCE.is_file():
        raise HTTPException(503, "The admin needs to add a voice recording before AmiBot can speak.")
    text = re.sub(r"[`*_#]", "", body.text).strip()
    if not text:
        raise HTTPException(400, "Speech text is empty.")

    def synthesize():
        tts = models["tts"]
        exaggeration, cfg = {"natural": (0.5, 0.5), "calm": (0.3, 0.3), "expressive": (0.7, 0.3)}[body.tone]
        waveform = tts.generate(text, language_id=body.language, exaggeration=exaggeration, cfg_weight=cfg)
        output = io.BytesIO()
        sf.write(output, waveform.detach().cpu().numpy().reshape(-1), tts.sr, format="WAV", subtype="PCM_16")
        # Chatterbox's built-in watermark remains intact.
        return Response(output.getvalue(), media_type="audio/wav")

    return await run_in_threadpool(exclusive, synthesize)
