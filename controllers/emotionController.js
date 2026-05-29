const { fetchText } = require("../utils/httpClient");

const MAX_TEXT_LENGTH = 2000;

const analyzeEmotion = async (req, res) => {
  const inputText = typeof req.params.text === "string" ? req.params.text.trim() : "";

  if (!inputText) {
    return res.status(400).json({ error: "Text is required" });
  }

  if (inputText.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: "Text is too long" });
  }

  try {
    const { response, text } = await fetchText("https://emotion-detector-rr3l.onrender.com/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: inputText }),
      timeoutMs: 15000,
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: text });
    }

    res.json(JSON.parse(text));
  } catch (err) {
    console.error("Emotion API Error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = { analyzeEmotion };
