const test = require("node:test");
const assert = require("node:assert/strict");
const { generateGeminiText } = require("../utils/geminiService");
const response = (status, data) => ({ ok: status === 200, status, headers: { get: () => null }, body: null, text: async () => JSON.stringify(data) });
const success = { candidates: [{ content: { parts: [{ text: '{"answerable":true,"answer":"A grounded answer."}' }] } }] };

test("voice latency settings preserve JSON output and do not affect ordinary chat", async (t) => {
  const bodies = [];
  t.mock.method(global, "fetch", async (url, options) => { bodies.push(JSON.parse(options.body)); return response(200, success); });
  const generationConfig = { responseMimeType: "application/json", maxOutputTokens: 384 };
  const env = { GEMINI_API_KEY: "test", GEMINI_MODEL: "gemini-2.5-flash" };
  await generateGeminiText("Question", { env, generationConfig, lowLatency: true });
  await generateGeminiText("Question", { env, generationConfig });
  assert.deepEqual(bodies[0].generationConfig, { ...generationConfig, thinkingConfig: { thinkingBudget: 0 } });
  assert.deepEqual(bodies[1].generationConfig, generationConfig);
  assert.equal(generationConfig.thinkingConfig, undefined);
});

test("fallback models do not receive Flash 2.5 specific thinking settings", async (t) => {
  const bodies = [];
  t.mock.method(global, "fetch", async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return bodies.length === 1 ? response(503, { error: { message: "Busy" } }) : response(200, success);
  });
  const result = await generateGeminiText("Question", { env: { GEMINI_API_KEY: "test", GEMINI_MODEL: "gemini-2.5-flash" }, lowLatency: true, generationConfig: { responseMimeType: "application/json" } });
  assert.equal(bodies[0].generationConfig.thinkingConfig.thinkingBudget, 0);
  assert.equal(bodies[1].generationConfig.thinkingConfig, undefined);
  assert.equal(bodies[0].generationConfig.maxOutputTokens, 384);
  assert.equal(bodies[1].generationConfig.maxOutputTokens, undefined);
  assert.match(result.text, /grounded answer/);
});


test("AmiBot voice route requests short grounded answers with low latency enabled", async (t) => {
  const oldKey = process.env.GEMINI_API_KEY, oldFlag = process.env.AMIBOT_EMBEDDINGS_ENABLED, oldModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY = "test"; process.env.AMIBOT_EMBEDDINGS_ENABLED = "false"; process.env.GEMINI_MODEL = "gemini-2.5-flash";
  t.after(() => { for (const [key, value] of [["GEMINI_API_KEY",oldKey],["AMIBOT_EMBEDDINGS_ENABLED",oldFlag],["GEMINI_MODEL",oldModel]]) { if(value === undefined) delete process.env[key]; else process.env[key]=value; } });
  const chunks = require("../models/AmiBotKnowledgeChunk");
  t.mock.method(chunks, "find", () => ({ sort(){return this;}, limit(){return this;}, lean:async()=>[{_id:"skills",sourceId:"source",sourceName:"Profile",chunkText:"Skills: React, JavaScript, Node.js and artificial intelligence."}] }));
  let body;
  t.mock.method(global, "fetch", async (url, options) => { body=JSON.parse(options.body); return response(200,success); });
  const res = { status(){return this;}, json(value){this.body=value;return this;} };
  await require("../controllers/amibotController").askAmibot({body:{query:"What skills are listed?",history:[],voiceMode:true,language:"en"}},res);
  assert.equal(body.generationConfig.thinkingConfig.thinkingBudget,0);
  assert.equal(body.generationConfig.maxOutputTokens,384);
  assert.match(body.contents[0].parts[0].text,/10 to 20 words/);
  assert.match(body.contents[0].parts[0].text,/only the provided AmiBot knowledge/);
  assert.match(body.contents[0].parts[0].text,/up to 50 words/);
  assert.match(body.contents[0].parts[0].text,/Include the facts needed/);
  assert.equal(res.body.answeredFromKnowledge,true);
});
