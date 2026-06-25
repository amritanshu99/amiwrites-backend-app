const test = require("node:test");
const assert = require("node:assert/strict");
const {
  generateGeminiContent,
  getGeminiModels,
  isRetryableGeminiStatus,
} = require("../controllers/geminiController");

function mockFetchResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: () => null,
    },
    body: null,
    text: async () => JSON.stringify(data),
  };
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("Gemini model list uses configured primary and stable fallback", () => {
  assert.deepEqual(
    getGeminiModels({
      GEMINI_MODEL: "gemini-flash-latest",
      GEMINI_FALLBACK_MODELS: "gemini-3.5-flash, gemini-2.5-flash",
    }),
    ["gemini-flash-latest", "gemini-3.5-flash", "gemini-2.5-flash"]
  );
});

test("Gemini retryable statuses cover temporary upstream failures", () => {
  assert.equal(isRetryableGeminiStatus(429), true);
  assert.equal(isRetryableGeminiStatus(503), true);
  assert.equal(isRetryableGeminiStatus(400), false);
  assert.equal(isRetryableGeminiStatus(401), false);
});

test("generateGeminiContent falls back when configured Gemini model is unavailable", async () => {
  const originalFetch = global.fetch;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalGeminiModel = process.env.GEMINI_MODEL;
  const originalFallbackModels = process.env.GEMINI_FALLBACK_MODELS;
  const calls = [];

  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_MODEL = "gemini-flash-latest";
  delete process.env.GEMINI_FALLBACK_MODELS;

  global.fetch = async (url, options) => {
    calls.push({ url, options });

    if (calls.length === 1) {
      return mockFetchResponse(503, {
        error: {
          message: "This model is currently experiencing high demand.",
        },
      });
    }

    return mockFetchResponse(200, {
      candidates: [
        {
          content: {
            parts: [{ text: "Ok" }],
          },
        },
      ],
    });
  };

  try {
    const res = mockRes();
    await generateGeminiContent({ body: { prompt: "Say ok" } }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { response: "Ok" });
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /gemini-flash-latest:generateContent$/);
    assert.match(calls[1].url, /gemini-2\.5-flash:generateContent$/);
    assert.equal(calls[0].options.headers["x-goog-api-key"], "test-key");
  } finally {
    global.fetch = originalFetch;
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;

    if (originalGeminiModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = originalGeminiModel;

    if (originalFallbackModels === undefined) delete process.env.GEMINI_FALLBACK_MODELS;
    else process.env.GEMINI_FALLBACK_MODELS = originalFallbackModels;
  }
});
