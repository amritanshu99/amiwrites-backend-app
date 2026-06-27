const { fetchText } = require("./httpClient");

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_FALLBACK_MODELS = [
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
];
const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-2";
const DEFAULT_GEMINI_EMBEDDING_DIMENSIONS = 768;
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

function getGeminiEmbeddingModel(env = process.env) {
  return normalizeGeminiModel(env.GEMINI_EMBEDDING_MODEL || DEFAULT_GEMINI_EMBEDDING_MODEL);
}

function getGeminiEmbeddingDimensions(env = process.env) {
  const configured = Number.parseInt(env.GEMINI_EMBEDDING_DIMENSIONS, 10);
  if ([768, 1536, 3072].includes(configured)) return configured;
  return DEFAULT_GEMINI_EMBEDDING_DIMENSIONS;
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

async function callGeminiModel({
  model,
  apiKey,
  postData,
  timeoutMs = 20000,
  action = "generateContent",
}) {
  const { response, text } = await fetchText(
    `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:${action}`,
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

function extractGeminiEmbedding(data) {
  const values =
    data?.embedding?.values ||
    data?.embeddings?.[0]?.values ||
    data?.embeddings?.[0]?.embedding?.values;

  if (!Array.isArray(values)) return [];

  return values
    .map((value) => (
      value === null || value === undefined || value === "" ? NaN : Number(value)
    ))
    .filter((value) => Number.isFinite(value));
}

function createGeminiError(message, status = 502, details = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, details);
  return error;
}

function isGeminiEmbedding2Model(model = "") {
  return normalizeGeminiModel(model).startsWith("gemini-embedding-2");
}

function prepareEmbeddingText({ model, text, taskType, title }) {
  const normalizedText = String(text || "").trim();
  if (!isGeminiEmbedding2Model(model)) return normalizedText;

  if (taskType === "RETRIEVAL_DOCUMENT") {
    const normalizedTitle = String(title || "none").trim() || "none";
    return `title: ${normalizedTitle} | text: ${normalizedText}`;
  }

  if (taskType === "QUESTION_ANSWERING") {
    return `task: question answering | query: ${normalizedText}`;
  }

  if (taskType === "RETRIEVAL_QUERY") {
    return `task: search result | query: ${normalizedText}`;
  }

  return normalizedText;
}

async function generateGeminiEmbedding(
  text,
  {
    env = process.env,
    timeoutMs = 15000,
    taskType = "SEMANTIC_SIMILARITY",
    title = "",
  } = {}
) {
  const apiKey = getGeminiApiKey(env);

  if (!apiKey) {
    throw createGeminiError("Gemini API is not configured", 503);
  }

  const model = getGeminiEmbeddingModel(env);
  const embeddingText = prepareEmbeddingText({ model, text, taskType, title });
  const requestBody = {
    content: {
      parts: [{ text: embeddingText }],
    },
    output_dimensionality: getGeminiEmbeddingDimensions(env),
  };

  if (!isGeminiEmbedding2Model(model)) {
    requestBody.taskType = taskType;
    if (taskType === "RETRIEVAL_DOCUMENT" && title) requestBody.title = title;
  }

  const { response, data } = await callGeminiModel({
    model,
    apiKey,
    postData: JSON.stringify(requestBody),
    timeoutMs,
    action: "embedContent",
  });

  if (!response.ok) {
    throw createGeminiError(
      getGeminiErrorMessage(data),
      response.status || 502,
      { model, data }
    );
  }

  const embedding = extractGeminiEmbedding(data);
  if (!embedding.length) {
    throw createGeminiError("Gemini returned an empty embedding", 502, { model, data });
  }

  return { embedding, model, data };
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
  extractGeminiEmbedding,
  extractGeminiText,
  generateGeminiEmbedding,
  generateGeminiText,
  getGeminiApiKey,
  getGeminiEmbeddingDimensions,
  getGeminiEmbeddingModel,
  getGeminiErrorMessage,
  getGeminiModels,
  isRetryableGeminiStatus,
  shouldTryNextGeminiModel,
};
