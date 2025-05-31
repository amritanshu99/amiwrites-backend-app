const express = require("express");
const router = express.Router();
const {
  createBlog,
  getBlogs,
  deleteBlog,
  deleteAllBlogs,
  getBlogById
} = require("../controllers/blogController");
const authMiddleware = require("../middleware/authMiddleware");

// Public route - get all blogs
router.get("/", getBlogs);
router.get("/:id", getBlogById);
// Protected routes - only admin (you) can create or delete
router.post("/", authMiddleware, createBlog);
router.delete("/:id", authMiddleware, deleteBlog);
router.delete("/", authMiddleware, deleteAllBlogs);
module.exports = router;
