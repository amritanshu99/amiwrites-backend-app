const path = require("path");
const mongoose = require("mongoose");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const readExcelFile = require("read-excel-file/node");
const { Resend } = require("resend");
const AmiBotChatMessage = require("../models/AmiBotChatMessage");
const AmiBotKnowledgeChunk = require("../models/AmiBotKnowledgeChunk");
const AmiBotKnowledgeSource = require("../models/AmiBotKnowledgeSource");
const AmiBotQuestion = require("../models/AmiBotQuestion");
const User = require("../models/Users");
const { generateGeminiText } = require("../utils/geminiService");
const {
  chunkText,
  formatKnowledgeContext,
  getDirectAmiBotReply,
  makeTokenRegex,
  normalizeQuestion,
  normalizeSearchTokens,
  parseStructuredAnswer,
  scoreKnowledgeChunks,
} = require("../utils/amibotKnowledge");
const { clampPositiveInt, escapeHtml } = require("../utils/security");

const MAX_QUERY_LENGTH = 4000;
const MAX_ADMIN_ANSWER_LENGTH = 12000;
const DEFAULT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_CHUNKS_PER_UPLOAD = 300;
const UNKNOWN_GUEST_REPLY =
  "I do not have this answer in the uploaded AmiBot knowledge yet.";
const UNKNOWN_USER_REPLY =
  "I do not have this answer in the uploaded AmiBot knowledge yet. I have sent your question to the admin for review.";

let resendClient;

function getUploadMaxBytes() {
  const configured = Number.parseInt(process.env.AMIBOT_UPLOAD_MAX_BYTES, 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_UPLOAD_MAX_BYTES;
}

function getMaxChunksPerUpload() {
  const configured = Number.parseInt(process.env.AMIBOT_MAX_CHUNKS_PER_UPLOAD, 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_CHUNKS_PER_UPLOAD;
}

function getResendClient() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY not set. Configure RESEND_API_KEY env var.");
  }

  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }

  return resendClient;
}

function getAdminEmail() {
  return process.env.AMIBOT_ADMIN_EMAIL || process.env.CONTACT_TO_EMAIL || "";
}

function getSourceType(file) {
  const extension = path.extname(file.originalname || "").toLowerCase();

  if (extension === ".pdf" || file.mimetype === "application/pdf") {
    return "pdf";
  }

  if (
    extension === ".xlsx" ||
    file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return "excel";
  }

  return "";
}

function createUploadError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const uploadAmiBotKnowledge = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: getUploadMaxBytes(),
    files: 1,
  },
  fileFilter(req, file, callback) {
    const sourceType = getSourceType(file);
    if (!sourceType) {
      return callback(createUploadError("Only PDF and .xlsx Excel files are supported"));
    }

    return callback(null, true);
  },
});

function handleAmiBotKnowledgeUpload(req, res, next) {
  uploadAmiBotKnowledge.single("file")(req, res, (err) => {
    if (!err) return next();

    const status = err.code === "LIMIT_FILE_SIZE"
      ? 413
      : Number.isInteger(err.status)
        ? err.status
        : 400;

    return res.status(status).json({ error: err.message || "Unable to upload AmiBot knowledge" });
  });
}

function formatCellValue(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).trim();
}

function rowsToSheetText(sheetName, rows = []) {
  const headerRow = Array.isArray(rows[0])
    ? rows[0].map(formatCellValue)
    : [];
  const hasHeader = headerRow.some(Boolean);
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const lines = [];

  dataRows.forEach((row, rowIndex) => {
    const values = Array.isArray(row) ? row.map(formatCellValue) : [];
    if (!values.some(Boolean)) return;

    const cells = values
      .map((value, cellIndex) => {
        if (!value) return "";
        const label = hasHeader && headerRow[cellIndex]
          ? headerRow[cellIndex]
          : `Column ${cellIndex + 1}`;
        return `${label}: ${value}`;
      })
      .filter(Boolean);

    if (cells.length) {
      lines.push(`Row ${rowIndex + 1}: ${cells.join(" | ")}`);
    }
  });

  return [`Sheet: ${sheetName || "Sheet 1"}`, ...lines].join("\n\n");
}

function normalizeExcelSheets(parsedSheets) {
  if (!Array.isArray(parsedSheets) || !parsedSheets.length) return [];

  if (parsedSheets.every((sheet) => Array.isArray(sheet?.data))) {
    return parsedSheets.map((sheet, index) => ({
      sheet: sheet.sheet || `Sheet ${index + 1}`,
      data: sheet.data,
    }));
  }

  if (parsedSheets.every((row) => Array.isArray(row))) {
    return [{ sheet: "Sheet 1", data: parsedSheets }];
  }

  return [];
}

async function readWorkbookSheets(input) {
  const parsedSheets = await readExcelFile(input, { getSheets: true });
  const normalizedSheets = normalizeExcelSheets(parsedSheets);

  if (normalizedSheets.length) return normalizedSheets;

  if (
    Array.isArray(parsedSheets) &&
    parsedSheets.every((sheet) => typeof sheet?.name === "string" || typeof sheet?.sheet === "string")
  ) {
    const loadedSheets = [];

    for (const sheet of parsedSheets) {
      const sheetName = sheet.name || sheet.sheet;
      const rows = await readExcelFile(input, { sheet: sheetName });
      loadedSheets.push({ sheet: sheetName, data: rows });
    }

    return normalizeExcelSheets(loadedSheets);
  }

  return [];
}

async function extractPdfText(file) {
  const parsed = await pdfParse(file.buffer);
  return String(parsed?.text || "").trim();
}

async function extractExcelText(file) {
  let sheets = [];

  try {
    sheets = await readWorkbookSheets(file.buffer);
  } catch {
    sheets = [];
  }

  if (!sheets.length) {
    try {
      sheets = normalizeExcelSheets(await readExcelFile(file.buffer));
    } catch {
      sheets = [];
    }
  }

  if (!sheets.length) {
    const rows = await readExcelFile.readSheet(file.buffer);
    sheets = [{ sheet: "Sheet 1", data: rows }];
  }

  return sheets
    .map((sheet) => rowsToSheetText(sheet.sheet || "Sheet", sheet.data))
    .filter((sheetText) => sheetText.split("\n").length > 1)
    .join("\n\n");
}

async function extractTextFromFile(file, sourceType) {
  if (sourceType === "pdf") return extractPdfText(file);
  if (sourceType === "excel") return extractExcelText(file);
  throw createUploadError("Unsupported knowledge file type");
}

async function createKnowledgeSourceWithChunks({
  sourceName,
  sourceType,
  originalName,
  mimeType,
  size,
  uploadedBy,
  text,
  metadata = {},
}) {
  const chunks = chunkText(text);
  const maxChunks = getMaxChunksPerUpload();

  if (!chunks.length) {
    throw createUploadError("No readable text was found in this file");
  }

  if (chunks.length > maxChunks) {
    throw createUploadError(`This file produced too many knowledge chunks. Maximum is ${maxChunks}.`, 413);
  }

  const source = await AmiBotKnowledgeSource.create({
    sourceName,
    sourceType,
    originalName,
    mimeType,
    size,
    uploadedBy,
    chunkCount: chunks.length,
  });

  try {
    await AmiBotKnowledgeChunk.insertMany(
      chunks.map((chunk, index) => ({
        sourceId: source._id,
        sourceName,
        sourceType,
        chunkIndex: index,
        chunkText: chunk,
        metadata,
      }))
    );
  } catch (error) {
    await AmiBotKnowledgeSource.findByIdAndDelete(source._id).catch(() => {});
    await AmiBotKnowledgeChunk.deleteMany({ sourceId: source._id }).catch(() => {});
    throw error;
  }

  return source;
}

function uniqueChunks(chunks = []) {
  const seen = new Set();
  const unique = [];

  for (const chunk of chunks) {
    const id = String(chunk._id || `${chunk.sourceId}-${chunk.chunkIndex}`);
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(chunk);
  }

  return unique;
}

async function findRelevantKnowledge(query, { limit = 8 } = {}) {
  const tokens = normalizeSearchTokens(query);
  if (!tokens.length) return [];

  const chunks = [];
  const textSearch = tokens.join(" ");

  try {
    const textMatches = await AmiBotKnowledgeChunk.find(
      { $text: { $search: textSearch } },
      { score: { $meta: "textScore" } }
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(limit)
      .lean();

    chunks.push(...textMatches);
  } catch (error) {
    console.error("AmiBot text search failed:", error.message || error);
  }

  if (chunks.length < limit) {
    const regex = makeTokenRegex(tokens);
    if (regex) {
      const fallbackMatches = await AmiBotKnowledgeChunk.find({ chunkText: regex })
        .sort({ createdAt: -1 })
        .limit(30)
        .lean();
      chunks.push(...fallbackMatches);
    }
  }

  return scoreKnowledgeChunks(uniqueChunks(chunks), query).slice(0, limit);
}

function buildGroundedPrompt({ query, context }) {
  return `
You are AmiBot for AmiVerse.
Answer the user's question using only the provided AmiBot knowledge context.
Do not use outside knowledge, guesses, or assumptions.
If the context does not contain the answer, return answerable as false.

Return valid JSON only in this exact shape:
{"answerable":true,"answer":"Your concise answer from the context."}

If the answer is missing:
{"answerable":false,"answer":"I do not have this answer in the uploaded AmiBot knowledge yet."}

Question:
${query}

AmiBot knowledge context:
${context}
`.trim();
}

function getSourcesFromChunks(chunks = []) {
  const sourceMap = new Map();

  for (const chunk of chunks) {
    const key = String(chunk.sourceId || chunk.sourceName);
    if (!sourceMap.has(key)) {
      sourceMap.set(key, {
        sourceId: chunk.sourceId,
        sourceName: chunk.sourceName,
        sourceType: chunk.sourceType,
      });
    }
  }

  return [...sourceMap.values()];
}

async function saveChatMessage(user, sender, text, metadata = {}) {
  const userId = user?.id || user?._id;
  if (!userId || !text) return null;

  try {
    return await AmiBotChatMessage.create({
      userId,
      sender,
      text,
      metadata,
    });
  } catch (error) {
    console.error("AmiBot chat history save failed:", error.message || error);
    return null;
  }
}

async function getUserProfile(userId) {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) return null;

  try {
    return await User.findById(userId).select("username email").lean();
  } catch {
    return null;
  }
}

async function sendPendingQuestionEmail(question) {
  const adminEmail = getAdminEmail();
  const mailFrom = process.env.MAIL_FROM;

  if (!adminEmail || !mailFrom || !process.env.RESEND_API_KEY) {
    console.warn("AmiBot admin email not configured; pending question was saved without email.");
    return false;
  }

  const frontendUrl = (process.env.PUBLIC_FRONTEND_URL || "https://www.amiverse.in").replace(/\/$/, "");
  const adminUrl = `${frontendUrl}/amibot-admin`;
  const userLine = question.userEmail
    ? `${escapeHtml(question.username || "User")} (${escapeHtml(question.userEmail)})`
    : escapeHtml(question.username || "User");

  const { error } = await getResendClient().emails.send({
    from: mailFrom,
    to: adminEmail,
    subject: "AmiBot needs an admin answer",
    html: `
      <h2>New AmiBot question</h2>
      <p><strong>User:</strong> ${userLine}</p>
      <p><strong>Question:</strong></p>
      <p>${escapeHtml(question.question)}</p>
      <p><a href="${adminUrl}">Open AmiBot Admin</a></p>
    `,
    reply_to: question.userEmail || undefined,
  });

  if (error) throw error;

  await AmiBotQuestion.findByIdAndUpdate(question._id, { emailNotifiedAt: new Date() });
  return true;
}

async function createPendingQuestionForUser(req, query) {
  const userId = req.user?.id;
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) return null;

  const normalizedQuestion = normalizeQuestion(query);
  const existing = await AmiBotQuestion.findOne({
    userId,
    normalizedQuestion,
    status: "pending",
  }).lean();

  if (existing) return existing;

  const profile = await getUserProfile(userId);
  const question = await AmiBotQuestion.create({
    userId,
    username: profile?.username || req.user?.username || "",
    userEmail: profile?.email || "",
    question: query,
    normalizedQuestion,
  });

  sendPendingQuestionEmail(question).catch((error) => {
    console.error("AmiBot pending question email failed:", error?.message || error);
  });

  return question;
}

function buildChatResponse({ answer, answeredFromKnowledge, sources = [], pendingQuestion = null }) {
  return {
    botResponse: {
      response: answer,
      answeredFromKnowledge,
      sources,
      pendingQuestionId: pendingQuestion?._id || null,
    },
    response: answer,
    answeredFromKnowledge,
    sources,
    pendingQuestionId: pendingQuestion?._id || null,
  };
}

async function answerFromUnknownData(req, res, query) {
  const pendingQuestion = req.user
    ? await createPendingQuestionForUser(req, query)
    : null;
  const answer = req.user ? UNKNOWN_USER_REPLY : UNKNOWN_GUEST_REPLY;

  await saveChatMessage(req.user, "bot", answer, {
    answeredFromKnowledge: false,
    pendingQuestionId: pendingQuestion?._id || null,
  });

  return res.status(200).json(
    buildChatResponse({
      answer,
      answeredFromKnowledge: false,
      pendingQuestion,
    })
  );
}

async function answerFromDirectReply(req, res, directReply) {
  await saveChatMessage(req.user, "bot", directReply.answer, {
    answeredFromKnowledge: false,
    answerSource: "direct",
    interactionType: directReply.type,
  });

  return res.status(200).json(
    buildChatResponse({
      answer: directReply.answer,
      answeredFromKnowledge: false,
    })
  );
}

async function answerFromKnowledge(req, res, query, relevantChunks) {
  const context = formatKnowledgeContext(relevantChunks);
  const prompt = buildGroundedPrompt({ query, context });
  const { text } = await generateGeminiText(prompt);
  const structuredAnswer = parseStructuredAnswer(text);
  const answer = structuredAnswer?.answer || text.trim();
  const answerable = structuredAnswer ? structuredAnswer.answerable : Boolean(answer);

  if (!answerable) return null;

  const sources = getSourcesFromChunks(relevantChunks);

  await saveChatMessage(req.user, "bot", answer, {
    answeredFromKnowledge: true,
    sources,
  });

  return res.status(200).json(
    buildChatResponse({
      answer,
      answeredFromKnowledge: true,
      sources,
    })
  );
}

async function askAmibot(req, res) {
  try {
    const query = typeof req.body.query === "string" ? req.body.query.trim() : "";

    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }

    if (query.length > MAX_QUERY_LENGTH) {
      return res.status(400).json({ error: "Query is too long" });
    }

    await saveChatMessage(req.user, "user", query);

    const directReply = getDirectAmiBotReply(query);
    if (directReply) {
      const directReplyChunks = directReply.knowledgeQuery
        ? await findRelevantKnowledge(directReply.knowledgeQuery)
        : [];
      if (directReplyChunks.length) {
        const knowledgeResponse = await answerFromKnowledge(req, res, query, directReplyChunks);
        if (knowledgeResponse) return knowledgeResponse;
      }

      return answerFromDirectReply(req, res, directReply);
    }

    const relevantChunks = await findRelevantKnowledge(query);

    if (!relevantChunks.length) {
      return answerFromUnknownData(req, res, query);
    }

    const knowledgeResponse = await answerFromKnowledge(req, res, query, relevantChunks);
    if (knowledgeResponse) return knowledgeResponse;

    return answerFromUnknownData(req, res, query);
  } catch (err) {
    console.error("AmiBot request error:", err.message || err);
    const status = Number.isInteger(err.status) ? err.status : 500;
    return res.status(status).json({ error: err.message || "Failed to get AmiBot response" });
  }
}

async function getAmiBotHistory(req, res) {
  try {
    const limit = clampPositiveInt(req.query.limit, { defaultValue: 100, min: 1, max: 300 });
    const messages = await AmiBotChatMessage.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({
      messages: messages.reverse().map((message) => ({
        id: message._id,
        sender: message.sender,
        text: message.text,
        metadata: message.metadata || {},
        createdAt: message.createdAt,
      })),
    });
  } catch (err) {
    console.error("AmiBot history fetch failed:", err.message || err);
    return res.status(500).json({ error: "Unable to load AmiBot history" });
  }
}

async function clearAmiBotHistory(req, res) {
  try {
    await AmiBotChatMessage.deleteMany({ userId: req.user.id });
    return res.json({ message: "AmiBot history cleared" });
  } catch (err) {
    console.error("AmiBot history clear failed:", err.message || err);
    return res.status(500).json({ error: "Unable to clear AmiBot history" });
  }
}

async function uploadKnowledge(req, res) {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "Knowledge file is required" });
    }

    const sourceType = getSourceType(file);
    if (!sourceType) {
      return res.status(400).json({ error: "Only PDF and .xlsx Excel files are supported" });
    }

    const extractedText = await extractTextFromFile(file, sourceType);
    const sourceName = typeof req.body.sourceName === "string" && req.body.sourceName.trim()
      ? req.body.sourceName.trim().slice(0, 240)
      : file.originalname;

    const source = await createKnowledgeSourceWithChunks({
      sourceName,
      sourceType,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      uploadedBy: req.user.id,
      text: extractedText,
      metadata: {
        originalName: file.originalname,
      },
    });

    return res.status(201).json({
      message: "AmiBot knowledge uploaded",
      source: {
        id: source._id,
        sourceName: source.sourceName,
        sourceType: source.sourceType,
        chunkCount: source.chunkCount,
        createdAt: source.createdAt,
      },
    });
  } catch (err) {
    console.error("AmiBot knowledge upload failed:", err.message || err);
    const status = Number.isInteger(err.status) ? err.status : 500;
    return res.status(status).json({ error: err.message || "Unable to upload AmiBot knowledge" });
  }
}

async function listKnowledgeSources(req, res) {
  try {
    const sources = await AmiBotKnowledgeSource.find({ status: "active" })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      sources: sources.map((source) => ({
        id: source._id,
        sourceName: source.sourceName,
        sourceType: source.sourceType,
        originalName: source.originalName,
        size: source.size,
        chunkCount: source.chunkCount,
        createdAt: source.createdAt,
      })),
    });
  } catch (err) {
    console.error("AmiBot knowledge list failed:", err.message || err);
    return res.status(500).json({ error: "Unable to load AmiBot knowledge" });
  }
}

async function deleteKnowledgeSource(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid knowledge source id" });
    }

    const source = await AmiBotKnowledgeSource.findByIdAndDelete(id);
    if (!source) {
      return res.status(404).json({ error: "Knowledge source not found" });
    }

    await AmiBotKnowledgeChunk.deleteMany({ sourceId: source._id });
    return res.json({ message: "AmiBot knowledge source deleted" });
  } catch (err) {
    console.error("AmiBot knowledge delete failed:", err.message || err);
    return res.status(500).json({ error: "Unable to delete AmiBot knowledge" });
  }
}

async function listAdminQuestions(req, res) {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : "";
    const query = ["pending", "answered", "closed"].includes(status)
      ? { status }
      : {};
    const limit = clampPositiveInt(req.query.limit, { defaultValue: 100, min: 1, max: 300 });

    const questions = await AmiBotQuestion.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({
      questions: questions.map((question) => ({
        id: question._id,
        userId: question.userId,
        username: question.username,
        userEmail: question.userEmail,
        question: question.question,
        status: question.status,
        adminAnswer: question.adminAnswer || "",
        emailNotifiedAt: question.emailNotifiedAt,
        answeredAt: question.answeredAt,
        closedAt: question.closedAt,
        createdAt: question.createdAt,
      })),
    });
  } catch (err) {
    console.error("AmiBot admin questions fetch failed:", err.message || err);
    return res.status(500).json({ error: "Unable to load AmiBot questions" });
  }
}

async function answerAdminQuestion(req, res) {
  try {
    const { id } = req.params;
    const answer = typeof req.body.answer === "string" ? req.body.answer.trim() : "";
    const addToKnowledge = req.body.addToKnowledge === true;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid question id" });
    }

    if (!answer) {
      return res.status(400).json({ error: "Answer is required" });
    }

    if (answer.length > MAX_ADMIN_ANSWER_LENGTH) {
      return res.status(400).json({ error: "Answer is too long" });
    }

    const question = await AmiBotQuestion.findById(id);
    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }

    question.adminAnswer = answer;
    question.status = "answered";
    question.answeredAt = new Date();
    question.answeredBy = req.user.id;
    await question.save();

    await saveChatMessage(
      { id: question.userId },
      "bot",
      answer,
      {
        answeredFromKnowledge: false,
        answerSource: "admin",
        pendingQuestionId: question._id,
      }
    );

    let source = null;
    if (addToKnowledge) {
      source = await createKnowledgeSourceWithChunks({
        sourceName: `Admin answer: ${question.question.slice(0, 80)}`,
        sourceType: "manual",
        originalName: "AmiBot admin answer",
        mimeType: "text/plain",
        size: answer.length + question.question.length,
        uploadedBy: req.user.id,
        text: `Question: ${question.question}\n\nAnswer: ${answer}`,
        metadata: {
          questionId: String(question._id),
        },
      });
    }

    return res.json({
      message: "AmiBot question answered",
      question: {
        id: question._id,
        status: question.status,
        adminAnswer: question.adminAnswer,
        answeredAt: question.answeredAt,
      },
      knowledgeSourceId: source?._id || null,
    });
  } catch (err) {
    console.error("AmiBot admin answer failed:", err.message || err);
    const status = Number.isInteger(err.status) ? err.status : 500;
    return res.status(status).json({ error: err.message || "Unable to answer AmiBot question" });
  }
}

async function closeAdminQuestion(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid question id" });
    }

    const question = await AmiBotQuestion.findByIdAndUpdate(
      id,
      {
        status: "closed",
        closedAt: new Date(),
      },
      { new: true }
    ).lean();

    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }

    return res.json({
      message: "AmiBot question closed",
      question: {
        id: question._id,
        status: question.status,
        closedAt: question.closedAt,
      },
    });
  } catch (err) {
    console.error("AmiBot admin close failed:", err.message || err);
    return res.status(500).json({ error: "Unable to close AmiBot question" });
  }
}

module.exports = {
  askAmibot,
  clearAmiBotHistory,
  closeAdminQuestion,
  deleteKnowledgeSource,
  findRelevantKnowledge,
  getAmiBotHistory,
  handleAmiBotKnowledgeUpload,
  listAdminQuestions,
  listKnowledgeSources,
  uploadAmiBotKnowledge,
  uploadKnowledge,
  answerAdminQuestion,
};
