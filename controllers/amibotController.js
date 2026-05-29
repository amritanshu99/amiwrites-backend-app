const { fetchJson } = require("../utils/httpClient");

const MAX_QUERY_LENGTH = 4000;

async function askAmibot(req, res) {
  try {
    const query = typeof req.body.query === "string" ? req.body.query.trim() : "";

    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }

    if (query.length > MAX_QUERY_LENGTH) {
      return res.status(400).json({ error: "Query is too long" });
    }

    const postData = JSON.stringify({ query });
    const { response, data } = await fetchJson("https://amibot-smbs.onrender.com/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(postData)),
      },
      body: postData,
      timeoutMs: 20000,
    });

    if (response.ok) {
      return res.status(200).json({ botResponse: data });
    }

    return res.status(response.status).json({ error: data || "Unknown error from AmiBot API" });
  } catch (err) {
    console.error("AmiBot API request error:", err.message);
    res.status(500).json({ error: "Failed to reach AmiBot API" });
  }
}

module.exports = { askAmibot };
