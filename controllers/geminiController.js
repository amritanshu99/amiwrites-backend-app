const {
  extractGeminiText,
  generateGeminiText,
  getGeminiApiKey,
  getGeminiModels,
  isRetryableGeminiStatus,
  shouldTryNextGeminiModel,
} = require("../utils/geminiService");

const MAX_PROMPT_LENGTH = 8000;

function getPromptFromRequestBody(body = {}) {
  for (const field of ["prompt", "message", "text", "query"]) {
    if (typeof body[field] === "string" && body[field].trim()) {
      return body[field].trim();
    }
  }

  return "";
}

async function generateGeminiContent(req, res) {
  try {
    const prompt = getPromptFromRequestBody(req.body);

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({ error: "Prompt is too long" });
    }

    const { text } = await generateGeminiText(prompt);
    return res.json({ response: text });
  } catch (err) {
    const status = Number.isInteger(err.status) ? err.status : 500;
    if (status >= 500) {
      console.error("Gemini API request error:", err.message);
    }
    return res.status(status).json({ error: err.message || "Failed to get response from Gemini API" });
  }
}

module.exports = {
  generateGeminiContent,
  getGeminiApiKey,
  getGeminiModels,
  getPromptFromRequestBody,
  extractGeminiText,
  shouldTryNextGeminiModel,
  isRetryableGeminiStatus,
};
