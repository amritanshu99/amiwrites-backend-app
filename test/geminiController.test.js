const test = require("node:test");
const assert = require("node:assert/strict");
const {
  generateGeminiContent,
  extractGeminiText,
  getGeminiApiKey,
  getGeminiModels,
  getPromptFromRequestBody,
  isRetryableGeminiStatus,
  shouldTryNextGeminiModel,
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
    [
      "gemini-flash-latest",
      "gemini-3.5-flash",
      "gemini-2.5-flash",
      "gemini-flash-lite-latest",
      "gemini-3.1-flash-lite",
    ]
  );
});

test("Gemini model list normalizes quoted model names and models prefix", () => {
  assert.deepEqual(
    getGeminiModels({
      GEMINI_MODEL: '"models/gemini-flash-latest"',
      GEMINI_FALLBACK_MODELS: "'models/gemini-2.5-flash'",
    }),
    [
      "gemini-flash-latest",
      "gemini-2.5-flash",
      "gemini-flash-lite-latest",
      "gemini-3.1-flash-lite",
    ]
  );
});

test("Gemini API key accepts common Google env names", () => {
  assert.equal(
    getGeminiApiKey({
      GOOGLE_GENERATIVE_AI_API_KEY: " fallback-key ",
    }),
    "fallback-key"
  );

  assert.equal(
    getGeminiApiKey({
      GEMINI_API_KEY: " primary-key ",
      GOOGLE_API_KEY: "fallback-key",
    }),
    "primary-key"
  );
});

test("Gemini API key accepts additional deployment aliases", () => {
  assert.equal(
    getGeminiApiKey({
      GOOGLE_GEMINI_API_KEY: " google-gemini-key ",
    }),
    "google-gemini-key"
  );

  assert.equal(
    getGeminiApiKey({
      GEMINI_KEY: " gemini-key ",
    }),
    "gemini-key"
  );
});

test("Gemini request body accepts common prompt field names", () => {
  assert.equal(getPromptFromRequestBody({ prompt: " Say ok " }), "Say ok");
  assert.equal(getPromptFromRequestBody({ message: "Hello" }), "Hello");
  assert.equal(getPromptFromRequestBody({ text: "Hi" }), "Hi");
  assert.equal(getPromptFromRequestBody({ query: "Question" }), "Question");
  assert.equal(getPromptFromRequestBody({ prompt: "   ", message: "Fallback" }), "Fallback");
});

test("Gemini response text is extracted from all text parts", () => {
  assert.equal(
    extractGeminiText({
      candidates: [
        {
          content: {
            parts: [
              { text: "Hello" },
              { inlineData: { mimeType: "image/png" } },
              { text: " world" },
            ],
          },
        },
      ],
    }),
    "Hello world"
  );
});

test("Gemini retryable statuses cover temporary upstream failures", () => {
  assert.equal(isRetryableGeminiStatus(429), true);
  assert.equal(isRetryableGeminiStatus(503), true);
  assert.equal(isRetryableGeminiStatus(400), false);
  assert.equal(isRetryableGeminiStatus(401), false);
});

test("Gemini model-selection errors try the next fallback model", () => {
  assert.equal(
    shouldTryNextGeminiModel(404, {
      error: {
        message:
          "models/gemini-old is not found for API version v1beta, or is not supported for generateContent.",
      },
    }),
    true
  );

  assert.equal(
    shouldTryNextGeminiModel(400, {
      error: { message: "models/gemini-old is not supported for generateContent" },
    }),
    true
  );

  assert.equal(
    shouldTryNextGeminiModel(400, {
      error: { message: "API key not valid. Please pass a valid API key." },
    }),
    false
  );
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
    assert.match(calls[1].url, /gemini-flash-lite-latest:generateContent$/);
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

test("generateGeminiContent falls back when configured Gemini model is not found", async () => {
  const originalFetch = global.fetch;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalGeminiModel = process.env.GEMINI_MODEL;
  const originalFallbackModels = process.env.GEMINI_FALLBACK_MODELS;
  const calls = [];

  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_MODEL = "gemini-old";
  process.env.GEMINI_FALLBACK_MODELS = "gemini-2.5-flash";

  global.fetch = async (url, options) => {
    calls.push({ url, options });

    if (calls.length === 1) {
      return mockFetchResponse(404, {
        error: {
          message:
            "models/gemini-old is not found for API version v1beta, or is not supported for generateContent.",
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
    await generateGeminiContent({ body: { message: "Say ok" } }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { response: "Ok" });
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /gemini-old:generateContent$/);
    assert.match(calls[1].url, /gemini-2\.5-flash:generateContent$/);
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

test("generateGeminiContent returns 503 when Gemini API key is missing", async () => {
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalGoogleKey = process.env.GOOGLE_API_KEY;
  const originalGoogleGenerativeKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  try {
    const res = mockRes();
    await generateGeminiContent({ body: { prompt: "Say ok" } }, res);

    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { error: "Gemini API is not configured" });
  } finally {
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;

    if (originalGoogleKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = originalGoogleKey;

    if (originalGoogleGenerativeKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    else process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalGoogleGenerativeKey;
  }
});

test("generateGeminiContent falls back when Gemini fetch throws", async () => {
  const originalFetch = global.fetch;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalGeminiModel = process.env.GEMINI_MODEL;
  const originalFallbackModels = process.env.GEMINI_FALLBACK_MODELS;
  const calls = [];

  process.env.GEMINI_API_KEY = " test-key ";
  process.env.GEMINI_MODEL = "gemini-flash-latest";
  delete process.env.GEMINI_FALLBACK_MODELS;

  global.fetch = async (url, options) => {
    calls.push({ url, options });

    if (calls.length === 1) {
      throw new Error("upstream socket closed");
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
    assert.equal(calls[0].options.headers["x-goog-api-key"], "test-key");
    assert.equal("Content-Length" in calls[0].options.headers, false);
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
