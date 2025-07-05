const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const path = require("path");

dotenv.config();
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files (e.g., images)
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

// --- API Routes ---
app.use("/api/auth", require("./routes/authRoutes"));              // Auth
app.use("/api/blogs", require("./routes/blogRoutes"));             // Blog routes (protected)
app.use("/api/portfolio", require("./routes/portfolioRoutes"));    // Portfolio routes
app.use("/api", require("./routes/newsRoutes"));                   // News API
app.use("/api", require("./routes/contactRoutes"));                // Contact form
app.use("/api/gemini", require("./routes/geminiRoutes"));          // Gemini AI
app.use("/api/tasks", require("./routes/taskRoutes"));
// ✅ Push Notification Routes
app.use("/api", require("./routes/pushRoutes"));                   // Handles /api/subscribe
//spam routhes
app.use("/api", require("./routes/spamRoutes")); 
// --- MongoDB Connection ---
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ Connected to MongoDB");
    app.listen(process.env.PORT || 5000, () =>
      console.log(`🚀 Server running at http://localhost:${process.env.PORT || 5000}`)
    );
  })
  .catch((err) => console.error("❌ MongoDB connection error:", err.message));
