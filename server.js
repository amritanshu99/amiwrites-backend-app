const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const path = require("path");
const securityHeaders = require("./middleware/securityHeaders");
const { buildCorsOptions } = require("./utils/security");

dotenv.config();
const requiredEnv = ["MONGO_URI", "JWT_SECRET"];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);

if (missingEnv.length) {
  console.error(
    `Missing required environment variable(s): ${missingEnv.join(", ")}. ` +
    "Create a local .env from .env.example or set these values in your deployment environment."
  );
  process.exit(1);
}

const app = express();
const mongoServerSelectionTimeoutMS =
  Number.parseInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS, 10) || 30000;

// Middleware
app.set("trust proxy", 1);
app.use(securityHeaders);
app.use(cors(buildCorsOptions()));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));

// Serve static files (e.g., images)
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

// API routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/blogs", require("./routes/blogRoutes"));
app.use("/api/portfolio", require("./routes/portfolioRoutes"));
app.use("/api", require("./routes/newsRoutes"));
app.use("/api", require("./routes/contactRoutes"));
app.use("/api/gemini", require("./routes/geminiRoutes"));
app.use("/api/tasks", require("./routes/taskRoutes"));
app.use("/api", require("./routes/pushRoutes"));
app.use("/api", require("./routes/spamRoutes"));
app.use("/api/recommender", require("./routes/recommenderRoutes"));
app.use("/api/emotion", require("./routes/emotionRoutes"));
app.use("/api/amibot", require("./routes/amibotRoutes"));
app.use("/api/trending-rl", require("./routes/trendingRLRoutes"));

app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Payload too large" });
  }

  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }

  return next(err);
});

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: mongoServerSelectionTimeoutMS,
  })
  .then(() => {
    console.log("Connected to MongoDB");

    const { startDecayJob } = require("./utils/decay");
    startDecayJob();

    app.listen(process.env.PORT || 5000, () =>
      console.log(`Server running at http://localhost:${process.env.PORT || 5000}`)
    );
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  });
