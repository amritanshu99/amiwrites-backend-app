const { fetchJson } = require("../utils/httpClient");

const MAX_PROMPT_LENGTH = 8000;
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_FALLBACK_MODELS = ["gemini-2.5-flash"];
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

function uniqueModels(models) {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))];
}

function getGeminiModels(env = process.env) {
  const primaryModel = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const configuredFallbacks = (env.GEMINI_FALLBACK_MODELS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return uniqueModels([primaryModel, ...configuredFallbacks, ...DEFAULT_FALLBACK_MODELS]);
}

function isRetryableGeminiStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function getGeminiErrorMessage(data) {
  return data?.error?.message || data?.message || "Unknown error from Gemini API";
}

async function callGeminiModel({ model, apiKey, postData }) {
  return fetchJson(
    `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(postData)),
        "x-goog-api-key": apiKey,
      },
      body: postData,
      timeoutMs: 20000,
    }
  );
}

async function generateGeminiContent(req, res) {
  try {
    const prompt = typeof req.body.prompt === "string" ? req.body.prompt.trim() : "";
    const apiKey = process.env.GEMINI_API_KEY;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({ error: "Prompt is too long" });
    }

    if (!apiKey) {
      return res.status(500).json({ error: "Gemini API is not configured" });
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
      const { response, data } = await callGeminiModel({ model, apiKey, postData });

      if (response.ok) {
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        return res.json({ response: text });
      }

      lastFailure = { response, data, model };
      console.error(`Gemini model ${model} failed with ${response.status}: ${getGeminiErrorMessage(data)}`);

      if (!isRetryableGeminiStatus(response.status)) {
        break;
      }
    }

    return res.status(lastFailure?.response?.status || 502).json({
      error: getGeminiErrorMessage(lastFailure?.data),
    });
  } catch (err) {
    console.error("Gemini API request error:", err.message);
    res.status(500).json({ error: "Failed to get response from Gemini API" });
  }
}

module.exports = {
  generateGeminiContent,
  getGeminiModels,
  isRetryableGeminiStatus,
};
