const { fetchText } = require("./httpClient");

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_FALLBACK_MODELS = [
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
];
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_API_KEY_ENV_KEYS = [
  "GEMINI_API_KEY",
  "GEMINI_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GENERATIVE_LANGUAGE_API_KEY",
];

function normalizeGeminiModel(model = "") {
  return String(model)
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^models\//, "");
}

function uniqueModels(models) {
  return [...new Set(models.map(normalizeGeminiModel).filter(Boolean))];
}

function getGeminiModels(env = process.env) {
  const primaryModel = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const configuredFallbacks = (env.GEMINI_FALLBACK_MODELS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return uniqueModels([primaryModel, ...configuredFallbacks, ...DEFAULT_FALLBACK_MODELS]);
}

function getGeminiApiKey(env = process.env) {
  for (const key of GEMINI_API_KEY_ENV_KEYS) {
    const value = String(env[key] || "").trim();
    if (value) return value;
  }

  return "";
}

function isRetryableGeminiStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function getGeminiErrorMessage(data) {
  return data?.error?.message || data?.message || data?.text || "Unknown error from Gemini API";
}

function isModelSelectionError(status, data) {
  if (status === 404) return true;

  if (status !== 400) return false;

  const message = getGeminiErrorMessage(data).toLowerCase();
  return (
    /models?\//.test(message) &&
    /(not found|not supported|unsupported|not available|invalid model|unknown model)/.test(message)
  );
}

function shouldTryNextGeminiModel(status, data) {
  return isRetryableGeminiStatus(status) || isModelSelectionError(status, data);
}

function parseJsonOrText(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

async function callGeminiModel({ model, apiKey, postData, timeoutMs = 20000 }) {
  const { response, text } = await fetchText(
    `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: postData,
      timeoutMs,
    }
  );

  return { response, data: parseJsonOrText(text), text };
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";

  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

function createGeminiError(message, status = 502, details = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, details);
  return error;
}

async function generateGeminiText(
  prompt,
  { env = process.env, timeoutMs = 20000, generationConfig = null } = {}
) {
  const apiKey = getGeminiApiKey(env);

  if (!apiKey) {
    throw createGeminiError("Gemini API is not configured", 503);
  }

  const requestBody = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
  };

  if (generationConfig && typeof generationConfig === "object") {
    requestBody.generationConfig = generationConfig;
  }

  const postData = JSON.stringify(requestBody);

  const models = getGeminiModels(env);
  let lastFailure = null;

  for (const model of models) {
    let result;

    try {
      result = await callGeminiModel({ model, apiKey, postData, timeoutMs });
    } catch (error) {
      lastFailure = {
        status: error.code === "ETIMEDOUT" ? 504 : 502,
        data: { error: { message: error.message || "Gemini upstream request failed" } },
        model,
      };
      console.error(`Gemini model ${model} request failed: ${error.message}`);
      continue;
    }

    const { response, data } = result;

    if (response.ok) {
      const text = extractGeminiText(data);
      if (text) return { text, model, data };

      lastFailure = {
        status: 502,
        data: { error: { message: "Gemini returned an empty response" } },
        model,
      };
      console.error(`Gemini model ${model} returned an empty response`);
      continue;
    }

    lastFailure = { status: response.status, data, model };
    console.error(`Gemini model ${model} failed with ${response.status}: ${getGeminiErrorMessage(data)}`);

    if (!shouldTryNextGeminiModel(response.status, data)) {
      break;
    }
  }

  throw createGeminiError(
    getGeminiErrorMessage(lastFailure?.data),
    lastFailure?.status || 502,
    { model: lastFailure?.model, data: lastFailure?.data }
  );
}

module.exports = {
  callGeminiModel,
  extractGeminiText,
  generateGeminiText,
  getGeminiApiKey,
  getGeminiErrorMessage,
  getGeminiModels,
  isRetryableGeminiStatus,
  shouldTryNextGeminiModel,
};
