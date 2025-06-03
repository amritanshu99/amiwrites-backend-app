const https = require("https");
const NodeCache = require("node-cache");

const NEWS_API_KEY = process.env.NEWS_API_KEY;
const newsCache = new NodeCache({ stdTTL: 300 }); // cache for 5 minutes

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (e) {
            reject(new Error("Invalid JSON response"));
          }
        } else {
          reject(new Error(`Status Code: ${res.statusCode}`));
        }
      });
    }).on("error", (err) => {
      reject(err);
    });
  });
}

exports.getTechNews = async (req, res) => {
  try {
    const cacheKey = "tech-news";
    const cachedData = newsCache.get(cacheKey);

    if (cachedData) {
        console.log("Tech news served from cache")
      return res.json({ source: "cache", ...cachedData });
    }

    const url = `https://gnews.io/api/v4/top-headlines?topic=technology&lang=en&country=in&apikey=${NEWS_API_KEY}`;
    const data = await fetchUrl(url);

    newsCache.set(cacheKey, data);
    res.json({ source: "api", ...data });
  } catch (error) {
    console.error("Error fetching news:", error);
    res.status(500).json({ error: "Failed to fetch news" });
  }
};
