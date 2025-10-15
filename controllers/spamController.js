// Native fetch is available in Node.js >=18
exports.checkSpam = async (req, res) => {
  const { subject, body } = req.body;

  if (!subject && !body) {
    return res.status(400).json({ error: "Subject or body is required" });
  }

  try {
    const flaskURL = "https://flask-spam-detector-bz71.onrender.com/predict";

    const response = await fetch(flaskURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Flask responded with ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    res.status(200).json(result); // { spam: true/false }

  } catch (error) {
    console.error("❌ Flask API fetch failed:", error.message);
    res.status(500).json({ error: "Failed to get spam prediction" });
  }
};
