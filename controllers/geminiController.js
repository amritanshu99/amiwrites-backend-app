const { fetchText } = require("../utils/httpClient");

const MAX_PROMPT_LENGTH = 8000;
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_FALLBACK_MODELS = ["gemini-2.5-flash"];
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_API_KEY_ENV_KEYS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
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

function parseJsonOrText(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

async function callGeminiModel({ model, apiKey, postData }) {
  const { response, text } = await fetchText(
    `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: postData,
      timeoutMs: 20000,
    }
  );

  return { response, data: parseJsonOrText(text), text };
}

async function generateGeminiContent(req, res) {
  try {
    const prompt = typeof req.body.prompt === "string" ? req.body.prompt.trim() : "";
    const apiKey = getGeminiApiKey();

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({ error: "Prompt is too long" });
    }

    if (!apiKey) {
      return res.status(503).json({ error: "Gemini API is not configured" });
    }

    const postData = JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
    });

    const models = getGeminiModels();
    let lastFailure = null;

    for (const model of models) {
      let result;

      try {
        result = await callGeminiModel({ model, apiKey, postData });
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
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (text) return res.json({ response: text });

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

      if (!isRetryableGeminiStatus(response.status)) {
        break;
      }
    }

    return res.status(lastFailure?.status || 502).json({
      error: getGeminiErrorMessage(lastFailure?.data),
    });
  } catch (err) {
    console.error("Gemini API request error:", err.message);
    res.status(500).json({ error: "Failed to get response from Gemini API" });
  }
}

module.exports = {
  generateGeminiContent,
  getGeminiApiKey,
  getGeminiModels,
  isRetryableGeminiStatus,
};
