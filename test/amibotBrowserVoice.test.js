const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const Profile = require("../models/AmiBotVoiceProfile");
const User = require("../models/Users");
const { ADMIN_USERNAME } = require("../middleware/adminMiddleware");
const { validateReference } = require("../controllers/amibotBrowserVoiceController");
const routes = require("../routes/amibotRoutes");
let server, base, profile, writes;
const originalSecret = process.env.JWT_SECRET;
const userId = "507f1f77bcf86cd799439011";
const query = (value) => ({ select() { return this; }, lean: async () => value });

function wav(seconds = 5, amplitude = 4000) {
  const bytes = Buffer.alloc(44 + seconds * 24000 * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(48000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = 44; i < bytes.length; i += 2) bytes.writeInt16LE(Math.round(amplitude * Math.sin(i / 50)), i);
  return bytes;
}
function authorization(username = ADMIN_USERNAME) {
  return { Authorization: `Bearer ${jwt.sign({ id: userId, username, authVersion: 0 }, process.env.JWT_SECRET)}` };
}
async function save({ bytes = wav(), consent = true, sharing = true, username = ADMIN_USERNAME } = {}) {
  const body = new FormData();
  body.append("audio", new Blob([bytes], { type: "audio/wav" }), "voice.wav");
  if (consent) body.append("consent", "true");
  if (sharing) body.append("browserSharingConsent", "true");
  return fetch(`${base}/admin/voice/browser/reference`, { method: "POST", body, headers: authorization(username) });
}

test.before(async () => {
  process.env.JWT_SECRET = "test-only-browser-voice-secret";
  const app = express(); app.use(express.json()); app.use("/api/amibot", routes);
  server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  base = `http://127.0.0.1:${server.address().port}/api/amibot`;
});
test.after(async () => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret;
  await new Promise((resolve) => server.close(resolve));
});
test.beforeEach(() => {
  profile = null; writes = [];
  test.mock.method(Profile, "findById", () => query(profile));
  test.mock.method(Profile, "findByIdAndUpdate", async (id, update, options) => { writes.push({ id, update, options }); profile = update.$set; });
  test.mock.method(User, "findById", () => query({ _id: userId, username: ADMIN_USERNAME, authVersion: 0 }));
});
test.afterEach(() => test.mock.restoreAll());

test("status works without a paid worker and asks only for the owner's recording", async () => {
  const response = await fetch(`${base}/voice/browser/status`);
  const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.mode, "browser"); assert.equal(data.ready, false);
  assert.deepEqual(data.languages, ["en"]); assert.match(data.message, /save a voice recording/);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("only an authenticated admin can publish a reference", async () => {
  assert.equal((await fetch(`${base}/admin/voice/browser/reference`, { method: "POST" })).status, 401);
  User.findById = () => query({ _id: userId, username: "visitor", authVersion: 0 });
  assert.equal((await save({ username: "visitor" })).status, 403);
  assert.equal(writes.length, 0);
});
test("both ownership and public sharing consent are mandatory", async () => {
  assert.equal((await save({ consent: false })).status, 400);
  assert.equal((await save({ sharing: false })).status, 400);
  assert.equal(writes.length, 0);
});
test("invalid, silent, oversized, and wrong-format WAVs are rejected", async () => {
  const stereo = wav(); stereo.writeUInt16LE(2, 22);
  for (const bytes of [Buffer.from("not audio"), wav(4), wav(31), wav(5, 0), stereo]) {
    assert.throws(() => validateReference(bytes), { status: 422 });
  }
  assert.equal((await save({ bytes: wav(5, 0) })).status, 422);
  assert.equal(writes.length, 0);
});
test("valid reference persists to MongoDB and round trips as bounded WAV bytes", async () => {
  const bytes = wav(); const response = await save({ bytes }); const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.referenceReady, true); assert.equal(data.duration, 5);
  assert.ok(data.revision); assert.equal(writes[0].options.upsert, true);
  const status = await (await fetch(`${base}/voice/browser/status`)).json();
  assert.equal(status.ready, true); assert.equal(status.revision, data.revision); assert.equal(status.audio, undefined);
  const reference = await fetch(`${base}/voice/browser/reference`);
  assert.match(reference.headers.get("content-type"), /audio\/wav/);
  assert.equal(reference.headers.get("cache-control"), "no-store");
  assert.deepEqual(Buffer.from(await reference.arrayBuffer()), bytes);
});
test("missing or unconsented recordings are never served", async () => {
  assert.equal((await fetch(`${base}/voice/browser/reference`)).status, 404);
  profile = { audio: wav(), browserSharingConsent: false };
  assert.equal((await fetch(`${base}/voice/browser/reference`)).status, 404);
  assert.equal((await (await fetch(`${base}/voice/browser/status`)).json()).ready, false);
});
test("database failures do not expose credentials or internal details", async () => {
  Profile.findById = () => { throw new Error("private-db-credential"); };
  const response = await fetch(`${base}/voice/browser/status`);
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private-db-credential/);
});
