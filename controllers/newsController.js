const NodeCache = require("node-cache");
const { fetchJson } = require("../utils/httpClient");

const NEWS_API_KEY = process.env.NEWS_API_KEY;
const newsCache = new NodeCache({ stdTTL: 300 });

exports.getTechNews = async (req, res) => {
  try {
    if (!NEWS_API_KEY) {
      return res.status(500).json({ error: "News API is not configured" });
    }

    const cacheKey = "tech-news";
    const cachedData = newsCache.get(cacheKey);

    if (cachedData) {
      return res.json({ source: "cache", ...cachedData });
    }

    const url = `https://gnews.io/api/v4/top-headlines?topic=technology&lang=en&country=in&apikey=${NEWS_API_KEY}`;
    const { response, data } = await fetchJson(url, { timeoutMs: 10000 });

    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch news" });
    }

    newsCache.set(cacheKey, data);
    res.json({ source: "api", ...data });
  } catch (error) {
    console.error("Error fetching news:", error.message);
    res.status(500).json({ error: "Failed to fetch news" });
  }
};
