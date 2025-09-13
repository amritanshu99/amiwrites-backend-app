// controllers/emotionController.js


const analyzeEmotion = async (req, res) => {
  const inputText = req.params.text;

  try {
    const response = await fetch("https://emotion-detector-jwgs.onrender.com/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: inputText }),
    });

    if (!response.ok) {
      const error = await response.text();
      return res.status(response.status).json({ error });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("❌ Emotion API Error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = { analyzeEmotion };

