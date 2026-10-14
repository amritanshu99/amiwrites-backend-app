# AmiBot voice mode

The browser records a turn, Express sends it to faster-whisper, AmiBot answers using
its existing knowledge and history, and Chatterbox Multilingual speaks the answer
using the owner's reference recording. The browser plays sentence chunks and
prepares the next chunk during playback. Microphone capture pauses during replies;
the Interrupt button stops playback and starts a new turn. This is turn-based voice
conversation, not a full-duplex realtime model.

## Local setup (Windows PowerShell)

From the backend repository:

```powershell
python -m venv voice-service/.venv
voice-service/.venv/Scripts/python.exe -m pip install -r voice-service/requirements.txt
npm.cmd run voice:setup
npm.cmd run voice:start
```

Use Python 3.10 or 3.11. `voice:setup` adds only missing/empty voice settings to
the backend `.env`, with a randomly generated worker secret. `voice:start` loads
that same `.env`, starts the worker on `127.0.0.1:8001`, and keeps model downloads
inside the ignored `voice-service/.cache/` directory. First startup downloads the
models and may take several minutes. Run one worker per model instance.
The pinned 0.1.7 tokenizer eagerly loads a Chinese converter even for other
languages. `speech_model.py` defers that converter until Chinese is actually
requested; AmiBot exposes only English/Hindi. This avoids an unrelated auxiliary
download and a Windows cache-path issue without changing English/Hindi processing
or editing installed packages. Recheck this compatibility wrapper on upgrades.

Start/restart Express in another terminal (`npm.cmd start`) and the frontend in its
own repository (`npm.cmd start`). Sign in as the existing AmiBot admin and visit
`/amibot-admin`. Under **Your voice, in AmiBot**, record or upload 15–30 seconds of
clean speech, preview it, confirm ownership, and choose **Save AmiBot voice**.
Accepted recordings are 5–30 seconds, up to 10 MB. The worker decodes recordings,
checks duration and volume, and saves normalized WAV audio privately. Browser voice
turns are limited to 55 seconds. Conversation recordings are processed in memory.

Open `/amibot`, click the microphone beside the message field, and start a
conversation. A 1.05-second pause sends a detected utterance; **Send now** is also
available. **Pause**, **Interrupt**, **End**, closing voice mode, leaving the page,
or changing accounts release or disable microphone capture as appropriate. The orb
and waveform use measured microphone/playback amplitude; processing has a separate
animation. Reduced-motion preferences are respected. Text transcripts remain in
the same chat, with the same signed-in history behavior.

## Configuration

| Variable | Where | Purpose |
| --- | --- | --- |
| `AMIBOT_VOICE_URL` | Express | Private worker address, e.g. `http://127.0.0.1:8001` |
| `AMIBOT_VOICE_TOKEN` | Both | Shared secret, at least 24 characters; never put it in frontend variables |
| `AMIBOT_VOICE_DEVICE` | Worker | `cpu` or `cuda`; auto-detected by default |
| `AMIBOT_WHISPER_MODEL` | Worker | Defaults to multilingual `small` |
| `AMIBOT_VOICE_REFERENCE` | Worker | Optional private path; defaults to `data/reference.wav` |
| `HF_HOME`, `TORCH_HOME` | Worker | Optional model cache locations |

For GPU hosting, install the CUDA-enabled PyTorch build compatible with Chatterbox
and the host GPU. CPU mode works for development but can have long response times.
Measure latency with the target hardware and reference voice before promising
real-time speech. Natural, calm, and expressive modes adjust Chatterbox's
exaggeration and CFG settings. English and Hindi are supported; mixed-language
pronunciation and voice similarity require listening checks with the real sample.
No browser/system voice is substituted if the reference or worker is unavailable.

## Production

The existing frontend and Express host cannot run the model inside the browser.
Deploy this worker on a persistent Python/GPU host, mount private persistent
storage for the reference and model cache, and configure Express with its reachable
URL and matching secret. Use a private network or HTTPS between hosts. Bind uvicorn
to `0.0.0.0` only on a host whose ingress is configured for the worker. Start it with:

```sh
uvicorn app:app --host 0.0.0.0 --port 8001 --workers 1
```

Use HTTPS for the frontend. `vercel.json` permits same-origin microphone access.
Do not expose the reference directory as static files. Reference replacement is
admin-only in Express; all worker routes require the shared secret. Speech and
transcription share a per-IP rate limit. The worker serializes inference and
returns 429 when occupied, rather than queuing unlimited GPU jobs. Scaling to
multiple simultaneous conversations requires more worker capacity/routing.

Chatterbox's built-in audio watermark is preserved, and the UI labels the voice
as AI-generated. The worker deliberately reports unavailable until the models and
an owner reference are both ready.

## Deploy on Render

Use the **separate private service** in `voice-service/render.yaml`. It runs in
Oregon, alongside the existing Express backend. Render's free backend can send
requests to this service over the private network. The worker has no public URL.
The existing backend's plan and runtime are not changed by this Blueprint.

The proposed worker uses **4 CPU / 16 GB RAM** (`4c-16g`) plus a **10 GB persistent
disk**. As checked on October 14, 2026, this is **$225 + $2.50 = $227.50/month**,
before taxes and any usage charges. Review the current price in Render before
deploying. The local worker reached about 10.8 GiB of peak allocated process
memory during startup/transcription, so 8 GB is not a safe initial sizing target.
This is a CPU deployment: conversational latency still needs measurement on the
actual instance with the owner's recording. More RAM does not guarantee fast
speech synthesis.

1. In Render, create a **Blueprint** from this backend repository, branch `main`,
   and set **Blueprint Path** to `voice-service/render.yaml`.
2. Review the proposed `amibot-voice` private service and disk cost, then deploy.
   This step starts billing. The Dockerfile installs CPU-only PyTorch, and copies
   only the worker source and requirements. The shared token is generated by
   Render; it is never included in Git or the container image.
3. Allow the first startup to download Whisper and Chatterbox into `/data/cache`.
   The disk retains both the model cache and `/data/reference.wav` across deploys.
   Render uses TCP checks for private services; a live instance can still be
   warming up. Check its logs for `Voice models ready on cpu`.
4. In the existing `amiwrites-backend-app` service's **Environment**, add:
   - `AMIBOT_VOICE_URL`: `http://` followed by the worker's actual **Service Address**
     from Render, including port `8001`. Do not use localhost here.
   - `AMIBOT_VOICE_TOKEN`: the same generated secret from `amibot-voice`.
   Save and redeploy Express. These settings belong on Render, not the frontend.
5. Check `/api/amibot/voice/status` on the live backend. Expect `modelReady: true`
   and `referenceReady: false` until the admin saves a voice recording. Record or
   upload the owner's sample in the live `/amibot-admin` page, then verify
   `ready: true` and test a short English and Hindi conversation.

For manual service creation, choose **Private Service**, **Docker**, root directory
`voice-service`, Dockerfile `./Dockerfile`, Oregon, one `4c-16g` instance, and a
10 GB disk mounted at `/data`. Add a random `AMIBOT_VOICE_TOKEN` of at least 24
characters and `PORT=8001`; the other defaults are in the Dockerfile. Start with
one instance because the reference and inference lock are local to the worker.

The Docker image has not been built locally when Docker is unavailable; the
first Render build and live status check are required deployment verification.

Render references: [Docker](https://render.com/docs/docker),
[private networking](https://render.com/docs/private-network),
[persistent disks](https://render.com/docs/disks),
[pricing](https://render.com/pricing).

## Verification

```powershell
node --test test/amibotVoice.test.js
voice-service/.venv/Scripts/python.exe -m unittest discover -s voice-service -p "test_*.py"
```

Frontend voice lifecycle tests live beside `useAmiBotVoice.js`. An actual voice
similarity, pronunciation, microphone/device, and latency check still requires a
real owner recording and live models.

API references: [Chatterbox](https://github.com/resemble-ai/chatterbox),
[faster-whisper](https://github.com/SYSTRAN/faster-whisper),
[MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder),
[Web Audio analyser](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode).
