const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const routes = require("../routes/amibotRoutes");
const httpFetch = global.fetch;
let server;
let base;
let workerCalls;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/amibot", routes);
  server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  base = `http://127.0.0.1:${server.address().port}/api/amibot`;
});
test.after(() => new Promise((resolve) => server.close(resolve)));
test.beforeEach(() => {
  workerCalls = [];
  process.env.AMIBOT_VOICE_URL = "http://voice-worker.test";
  process.env.AMIBOT_VOICE_TOKEN = "private-worker-secret-for-tests";
  global.fetch = async (url, options) => {
    workerCalls.push({ url, options });
    return new Response(JSON.stringify({ ready: true, referenceReady: true, modelReady: true }), { headers: { "Content-Type": "application/json" } });
  };
});
test.afterEach(() => { global.fetch = httpFetch; delete process.env.AMIBOT_VOICE_URL; delete process.env.AMIBOT_VOICE_TOKEN; });

test("status uses private worker authorization without exposing its secret", async () => {
  const response = await httpFetch(`${base}/voice/status`);
  const data = await response.json();
  assert.equal(data.ready, true);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(workerCalls[0].options.headers.Authorization, "Bearer private-worker-secret-for-tests");
  assert.equal(JSON.stringify(data).includes("secret"), false);
});

test("unconfigured worker reports an actionable unavailable response", async () => {
  delete process.env.AMIBOT_VOICE_TOKEN;
  const response = await httpFetch(`${base}/voice/status`);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not set up/i);
  assert.equal(workerCalls.length, 0);
});

test("speech validates text limits, language, and tone before running inference", async () => {
  for (const body of [{ text: "" }, { text: "a".repeat(601) }, { text: "hello", language: "xx" }, { text: "hello", tone: "arbitrary" }]) {
    const response = await httpFetch(`${base}/voice/speech`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, 400);
  }
  assert.equal(workerCalls.length, 0);
});

test("speech returns audio bytes and forwards the selected tone", async () => {
  let forwarded;
  global.fetch = async (url, options) => {
    forwarded = JSON.parse(options.body);
    return new Response(Buffer.from("RIFFtest-wave"), { headers: { "Content-Type": "audio/wav" } });
  };
  const response = await httpFetch(`${base}/voice/speech`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Hello", language: "en", tone: "calm" }) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /audio\/wav/);
  assert.equal(await response.text(), "RIFFtest-wave");
  assert.deepEqual(forwarded, { text: "Hello", language: "en", tone: "calm" });
});

test("transcription accepts a browser recording and forwards its language", async () => {
  global.fetch = async (url, options) => {
    assert.equal(url, "http://voice-worker.test/transcribe");
    assert.equal(options.body.get("language"), "hi");
    assert.equal(options.body.get("audio").size, 8);
    return new Response(JSON.stringify({ text: "नमस्ते", language: "hi" }));
  };
  const form = new FormData();
  form.append("audio", new Blob(["test-wav"], { type: "audio/webm" }), "recording.webm");
  form.append("language", "hi");
  const response = await httpFetch(`${base}/voice/transcribe`, { method: "POST", body: form });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { text: "नमस्ते", language: "hi" });
});

test("non-audio uploads and empty recordings do not reach the worker", async () => {
  const form = new FormData();
  form.append("audio", new Blob(["not audio"], { type: "text/plain" }), "data.txt");
  assert.equal((await httpFetch(`${base}/voice/transcribe`, { method: "POST", body: form })).status, 415);
  assert.equal((await httpFetch(`${base}/voice/transcribe`, { method: "POST", body: new FormData() })).status, 400);
  assert.equal(workerCalls.length, 0);
});

test("voice replacement requires authentication before accepting uploads", async () => {
  const response = await httpFetch(`${base}/admin/voice/reference`, { method: "POST" });
  assert.equal(response.status, 401);
  assert.equal(workerCalls.length, 0);
});

test("worker failures do not leak internal URLs or exception details", async () => {
  global.fetch = async () => new Response(JSON.stringify({ detail: "private path C:/secret/token" }), { status: 500 });
  const response = await httpFetch(`${base}/voice/status`);
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /secret/);
});
