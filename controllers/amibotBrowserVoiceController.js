const { randomUUID } = require("node:crypto");
const Profile = require("../models/AmiBotVoiceProfile");

// The browser normalizes uploads to this bounded format. No model/decoder runs on Render.
function validateReference(bytes) {
  const invalid = () => Object.assign(new Error("Use the admin recorder or upload a decodable audio file, then save again."), { status: 422 });
  if (!Buffer.isBuffer(bytes) || bytes.length < 44 || bytes.length > 1440044) throw invalid();
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.readUInt32LE(4) !== bytes.length - 8 ||
      bytes.toString("ascii", 8, 12) !== "WAVE" || bytes.toString("ascii", 12, 16) !== "fmt " ||
      bytes.readUInt32LE(16) !== 16 || bytes.readUInt16LE(20) !== 1 || bytes.readUInt16LE(22) !== 1 ||
      bytes.readUInt32LE(24) !== 24000 || bytes.readUInt32LE(28) !== 48000 ||
      bytes.readUInt16LE(32) !== 2 || bytes.readUInt16LE(34) !== 16 ||
      bytes.toString("ascii", 36, 40) !== "data" || bytes.readUInt32LE(40) !== bytes.length - 44 ||
      (bytes.length - 44) % 2 !== 0) throw invalid();
  const count = (bytes.length - 44) / 2;
  const duration = count / 24000;
  if (duration < 5 || duration > 30) throw Object.assign(new Error("Use 5–30 seconds of your natural voice."), { status: 422 });
  let energy = 0;
  for (let offset = 44; offset < bytes.length; offset += 2) energy += (bytes.readInt16LE(offset) / 32768) ** 2;
  if (Math.sqrt(energy / count) < 0.003) throw Object.assign(new Error("The recording is too quiet. Move closer to your microphone."), { status: 422 });
  return Math.round(duration * 100) / 100;
}

function handle(action) {
  return async (req, res) => {
    res.set("Cache-Control", "no-store");
    try { await action(req, res); }
    catch (error) { res.status(error.status || 503).json({ error: error.status ? error.message : "Voice settings could not be loaded. Please try again shortly." }); }
  };
}

const browserVoiceStatus = handle(async (req, res) => {
  const profile = await Profile.findById("amibot").select("revision duration browserSharingConsent").lean();
  const ready = profile?.browserSharingConsent === true;
  res.json({ mode: "browser", ready, referenceReady: ready, languages: ["en"], voiceName: "Amritanshu",
    revision: ready ? profile.revision : null,
    message: ready ? "Your device generates AmiBot’s voice." : "The admin needs to save a voice recording for browser voice mode." });
});

const browserVoiceReference = handle(async (req, res) => {
  const profile = await Profile.findById("amibot").select("+audio browserSharingConsent").lean();
  if (!profile?.browserSharingConsent || !profile.audio) return res.status(404).json({ error: "No browser voice recording has been published." });
  // lean() returns a BSON Binary in some Mongoose versions.
  const bytes = Buffer.isBuffer(profile.audio) ? profile.audio : Buffer.from(profile.audio.buffer);
  res.set("Content-Type", "audio/wav");
  res.send(bytes);
});

const saveBrowserVoiceReference = handle(async (req, res) => {
  if (req.body.consent !== "true" || req.body.browserSharingConsent !== "true") {
    return res.status(400).json({ error: "Confirm voice ownership and permission for visitors to download this reference." });
  }
  const duration = validateReference(req.file?.buffer);
  const revision = randomUUID();
  await Profile.findByIdAndUpdate("amibot", { $set: { audio: req.file.buffer, duration, revision, browserSharingConsent: true } },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true });
  res.json({ referenceReady: true, duration, revision });
});

module.exports = { browserVoiceStatus, browserVoiceReference, saveBrowserVoiceReference, validateReference };
