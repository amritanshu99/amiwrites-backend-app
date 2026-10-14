const multer = require("multer");

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const audioTypes = new Set(["audio/webm", "audio/ogg", "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/flac"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 3, fieldSize: 100 },
  fileFilter(req, file, cb) {
    const accepted = audioTypes.has(file.mimetype.split(";")[0]);
    cb(accepted ? null : Object.assign(new Error("Choose a WAV, MP3, M4A, WebM, OGG, or FLAC recording."), { status: 415 }), accepted);
  },
}).single("audio");

function uploadAudio(req, res, next) {
  upload(req, res, (error) => {
    if (!error) return next();
    return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : error.status || 400).json({
      error: error.code === "LIMIT_FILE_SIZE" ? "Audio must be smaller than 10 MB." : "Invalid audio upload. Use one audio file smaller than 10 MB.",
    });
  });
}

function serviceConfig() {
  const url = process.env.AMIBOT_VOICE_URL;
  const token = process.env.AMIBOT_VOICE_TOKEN;
  if (!url || !token) throw Object.assign(new Error("Voice mode is not set up yet. The admin needs to connect the voice service."), { status: 503 });
  return { url: url.replace(/\/+$/, ""), token };
}

async function callVoiceService(req, res, path, { method = "GET", body, audio = false } = {}) {
  const { url, token } = serviceConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), path === "/health" ? 5000 : 120000);
  const onClose = () => { if (!res.writableEnded) controller.abort(); };
  res.on("close", onClose);
  try {
    const response = await fetch(`${url}${path}`, {
      method, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      headers: { Authorization: `Bearer ${token}`, ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}) },
      signal: controller.signal,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const safeStatus = [400, 413, 415, 422, 429, 503].includes(response.status) ? response.status : 502;
      throw Object.assign(new Error(typeof data.detail === "string" && safeStatus !== 502 ? data.detail : "The voice service could not complete this request. Please try again."), { status: safeStatus });
    }
    if (audio) {
      if (!response.headers.get("content-type")?.startsWith("audio/")) throw new Error("Invalid voice audio response");
      const bytes = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_AUDIO_BYTES) { controller.abort(); throw new Error("Voice response too large"); }
        bytes.push(chunk);
      }
      res.set("Content-Type", "audio/wav");
      return res.send(Buffer.concat(bytes));
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
    res.off("close", onClose);
  }
}

function voiceHandler(handler) {
  return async (req, res) => {
    res.set("Cache-Control", "no-store");
    try { await handler(req, res); }
    catch (error) {
      if (res.destroyed || res.headersSent) return;
      res.status(error.status || 503).json({ error: error.status ? error.message : "Voice service is unavailable or took too long. Please try again." });
    }
  };
}

function audioForm(req) {
  if (!req.file?.buffer?.length) throw Object.assign(new Error("An audio recording is required."), { status: 400 });
  const form = new FormData();
  form.append("audio", new Blob([req.file.buffer], { type: req.file.mimetype }), "recording");
  return form;
}

const getVoiceStatus = voiceHandler(async (req, res) => {
  const status = await callVoiceService(req, res, "/health");
  res.json({ ready: status.ready === true, referenceReady: status.referenceReady === true, modelReady: status.modelReady === true, languages: ["en", "hi"], voiceName: "Amritanshu", message: status.modelError ? "The voice models could not start. The admin needs to check the voice service." : status.ready ? "Voice is ready" : status.referenceReady ? "Voice models are warming up. Try again shortly." : "The admin needs to add Amritanshu’s voice recording." });
});

const transcribeVoice = voiceHandler(async (req, res) => {
  const form = audioForm(req);
  const language = req.body.language || "auto";
  if (!["auto", "en", "hi"].includes(language)) return res.status(400).json({ error: "Choose English, Hindi, or automatic language detection." });
  form.append("language", language);
  const data = await callVoiceService(req, res, "/transcribe", { method: "POST", body: form });
  res.json({ text: typeof data.text === "string" ? data.text.slice(0, 2000) : "", language: data.language === "hi" ? "hi" : "en" });
});

const synthesizeVoice = voiceHandler(async (req, res) => {
  const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
  const language = req.body.language || "en";
  const tone = req.body.tone || "natural";
  if (!text || text.length > 600) return res.status(400).json({ error: "Speech text must contain between 1 and 600 characters." });
  if (!["en", "hi"].includes(language) || !["natural", "calm", "expressive"].includes(tone)) return res.status(400).json({ error: "Unsupported voice language or tone." });
  await callVoiceService(req, res, "/speech", { method: "POST", body: { text, language, tone }, audio: true });
});

const saveVoiceReference = voiceHandler(async (req, res) => {
  if (req.body.consent !== "true") return res.status(400).json({ error: "Confirm that this is your voice and you want AmiBot to use it." });
  const data = await callVoiceService(req, res, "/reference", { method: "POST", body: audioForm(req) });
  res.json({ referenceReady: data.referenceReady === true, duration: data.duration });
});

module.exports = { getVoiceStatus, transcribeVoice, synthesizeVoice, saveVoiceReference, uploadAudio };
