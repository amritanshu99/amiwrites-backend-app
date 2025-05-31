const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const path = require("path");

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

// Serve static files from public folder (for images etc.)
app.use(express.static(path.join(__dirname, "public")));

// Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/blogs", require("./routes/blogRoutes"));
app.use("/api/portfolio", require("./routes/portfolioRoutes"));  // <-- Add portfolio routes here

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ Connected to MongoDB");
    app.listen(process.env.PORT, () => 
      console.log(`🚀 Server on http://localhost:${process.env.PORT}`)
    );
  })
  .catch((err) => console.error("❌ MongoDB connection error:", err.message));
