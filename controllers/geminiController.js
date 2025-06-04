const https = require("https");

const API_KEY = process.env.GEMINI_API_KEY;

function generateGeminiContent(req, res) {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  const postData = JSON.stringify({
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
  });

  const options = {
    hostname: "generativelanguage.googleapis.com",
    path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
    },
  };

  const request = https.request(options, (response) => {
    let data = "";

    response.on("data", (chunk) => {
      data += chunk;
    });

    response.on("end", () => {
      if (response.statusCode >= 200 && response.statusCode < 300) {
        try {
          const parsedData = JSON.parse(data);
          const text = parsedData.candidates?.[0]?.content?.parts?.[0]?.text || "";
          res.json({ response: text });
        } catch (err) {
          console.error("Error parsing Gemini response:", err);
          res.status(500).json({ error: "Failed to parse Gemini API response" });
        }
      } else {
        try {
          const errorData = JSON.parse(data);
          res.status(response.statusCode).json({ error: errorData });
        } catch {
          res.status(response.statusCode).json({ error: "Unknown error from Gemini API" });
        }
      }
    });
  });

  request.on("error", (err) => {
    console.error("Gemini API request error:", err);
    res.status(500).json({ error: "Failed to get response from Gemini API" });
  });

  request.write(postData);
  request.end();
}

module.exports = { generateGeminiContent };
