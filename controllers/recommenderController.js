const { fetchJson } = require("../utils/httpClient");
const { clampPositiveInt } = require("../utils/security");

const getMovieRecommendations = async (req, res) => {
  const movie = typeof req.body.movie === "string" ? req.body.movie.trim() : "";
  const top_n = req.body.top_n === undefined
    ? undefined
    : clampPositiveInt(req.body.top_n, { defaultValue: 5, min: 1, max: 50 });

  if (!movie) {
    return res.status(400).json({ error: "Movie is required" });
  }

  try {
    const { response, data } = await fetchJson("https://movie-recommender-mtr3.onrender.com/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ movie, top_n }),
      timeoutMs: 20000,
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: data?.error || "Failed to fetch recommendations" });
    }

    return res.json(data);
  } catch (error) {
    console.error("Error calling Python recommender:", error.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = { getMovieRecommendations };
