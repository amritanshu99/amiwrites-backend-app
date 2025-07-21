const https = require("https");

function askAmibot(req, res) {
  const { query } = req.body;

  if (!query) {
    return res.status(400).json({ error: "Query is required" });
  }

  const postData = JSON.stringify({ query });

  const options = {
    hostname: "amibot-c6oa.onrender.com",
    path: "/ask",
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
          const parsed = JSON.parse(data);
          res.status(200).json({ botResponse: parsed });
        } catch (err) {
          console.error("❌ Error parsing AmiBot response:", err.message);
          res.status(500).json({ error: "Failed to parse AmiBot response" });
        }
      } else {
        try {
          const errorData = JSON.parse(data);
          res.status(response.statusCode).json({ error: errorData });
        } catch {
          res
            .status(response.statusCode)
            .json({ error: "Unknown error from AmiBot API" });
        }
      }
    });
  });

  request.on("error", (err) => {
    console.error("❌ AmiBot API request error:", err.message);
    res.status(500).json({ error: "Failed to reach AmiBot API" });
  });

  request.write(postData);
  request.end();
}

module.exports = { askAmibot };
