const express = require("express");
const router = express.Router();
const blogController = require("../controllers/blogController");
const authMiddleware = require("../middleware/authMiddleware");

router.get("/", blogController.getBlogs);
router.get("/:id", blogController.getBlogById);

// Protected routes for blog creation and deletion
router.post("/", authMiddleware, blogController.createBlog);
router.delete("/:id", authMiddleware, blogController.deleteBlog);
router.delete("/", authMiddleware, blogController.deleteAllBlogs);

module.exports = router;
