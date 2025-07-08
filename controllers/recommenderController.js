

// 🎯 Controller to fetch recommendations from Python API
const getMovieRecommendations = async (req, res) => {
  const { movie, top_n } = req.body;

  try {
    const response = await fetch("https://movie-recommender-mtr3.onrender.com/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ movie, top_n }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error || "Failed to fetch recommendations" });
    }

    return res.json(data); // ✅ Return Python recommender's response
  } catch (error) {
    console.error("❌ Error calling Python recommender:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = { getMovieRecommendations };
