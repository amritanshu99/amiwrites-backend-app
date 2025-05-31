const express = require("express");
const router = express.Router();

const NEWS_API_KEY = process.env.NEWS_API_KEY;

router.get("/tech-news", async (req, res) => {
  try {
    const url = `https://gnews.io/api/v4/top-headlines?topic=technology&lang=en&country=in&apiKey=${NEWS_API_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch news" });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Error fetching news:", error);
    res.status(500).json({ error: "Failed to fetch news" });
  }
});

module.exports = router;
