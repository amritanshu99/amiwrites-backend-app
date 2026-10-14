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
const { getVoiceStatus, transcribeVoice, synthesizeVoice, saveVoiceReference, uploadAudio } = require("../controllers/amibotVoiceController");
const { createRateLimiter } = require("../utils/security");

const router = express.Router();
const voiceRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 120 });

router.get("/voice/status", getVoiceStatus);
router.post("/voice/transcribe", voiceRateLimiter, optionalAuthMiddleware, uploadAudio, transcribeVoice);
router.post("/voice/speech", voiceRateLimiter, optionalAuthMiddleware, synthesizeVoice);
router.post("/admin/voice/reference", authMiddleware, requireAdmin, voiceRateLimiter, uploadAudio, saveVoiceReference);

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
