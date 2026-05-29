const { fetchJson } = require("../utils/httpClient");

const MAX_PROMPT_LENGTH = 8000;

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

    const { response, data } = await fetchJson(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(postData)),
        },
        body: postData,
        timeoutMs: 20000,
      }
    );

    if (response.ok) {
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return res.json({ response: text });
    }

    return res.status(response.status).json({ error: data || "Unknown error from Gemini API" });
  } catch (err) {
    console.error("Gemini API request error:", err.message);
    res.status(500).json({ error: "Failed to get response from Gemini API" });
  }
}

module.exports = { generateGeminiContent };
