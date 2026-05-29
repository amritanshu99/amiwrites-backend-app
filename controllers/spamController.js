const { fetchText } = require("../utils/httpClient");

const MAX_TEXT_LENGTH = 10000;

exports.checkSpam = async (req, res) => {
  const subject = typeof req.body.subject === "string" ? req.body.subject : "";
  const body = typeof req.body.body === "string" ? req.body.body : "";

  if (!subject && !body) {
    return res.status(400).json({ error: "Subject or body is required" });
  }

  if (subject.length + body.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: "Input is too long" });
  }

  try {
    const { response, text } = await fetchText("https://flask-spam-detector-bz71.onrender.com/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body }),
      timeoutMs: 15000,
    });

    if (!response.ok) {
      throw new Error(`Flask responded with ${response.status}: ${text}`);
    }

    res.status(200).json(JSON.parse(text));
  } catch (error) {
    console.error("Flask API fetch failed:", error.message);
    res.status(500).json({ error: "Failed to get spam prediction" });
  }
};
