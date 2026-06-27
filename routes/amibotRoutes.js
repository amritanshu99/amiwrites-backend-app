const express = require("express");
const {
  answerAdminQuestion,
  askAmibot,
  backfillKnowledgeEmbeddings,
  clearAmiBotHistory,
  closeAdminQuestion,
  deleteKnowledgeSource,
  getAmiBotHistory,
  handleAmiBotKnowledgeUpload,
  listAdminQuestions,
  listKnowledgeSources,
  uploadKnowledge,
} = require("../controllers/amibotController");
const { aiRateLimiter } = require("../middleware/rateLimiters");
const authMiddleware = require("../middleware/authMiddleware");
const optionalAuthMiddleware = require("../middleware/optionalAuthMiddleware");
const { requireAdmin } = require("../middleware/adminMiddleware");

const router = express.Router();

router.post("/", aiRateLimiter, optionalAuthMiddleware, askAmibot);

router.get("/history", authMiddleware, getAmiBotHistory);
router.delete("/history", authMiddleware, clearAmiBotHistory);

router.get("/admin/questions", authMiddleware, requireAdmin, listAdminQuestions);
router.patch("/admin/questions/:id/answer", authMiddleware, requireAdmin, answerAdminQuestion);
router.patch("/admin/questions/:id/close", authMiddleware, requireAdmin, closeAdminQuestion);

router.get("/admin/knowledge", authMiddleware, requireAdmin, listKnowledgeSources);
router.post(
  "/admin/knowledge/upload",
  authMiddleware,
  requireAdmin,
  handleAmiBotKnowledgeUpload,
  uploadKnowledge
);
router.post(
  "/admin/knowledge/embeddings/backfill",
  authMiddleware,
  requireAdmin,
  backfillKnowledgeEmbeddings
);
router.delete("/admin/knowledge/:id", authMiddleware, requireAdmin, deleteKnowledgeSource);

module.exports = router;
