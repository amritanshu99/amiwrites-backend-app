const test = require("node:test");
const assert = require("node:assert/strict");
const { askAmibot } = require("../controllers/amibotController");
const AmiBotChatMessage = require("../models/AmiBotChatMessage");
const AmiBotKnowledgeChunk = require("../models/AmiBotKnowledgeChunk");
const AmiBotQuestion = require("../models/AmiBotQuestion");

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("askAmibot falls back to direct greetings without admin review", async () => {
  const originalChatCreate = AmiBotChatMessage.create;
  const originalChunkFind = AmiBotKnowledgeChunk.find;
  const originalQuestionCreate = AmiBotQuestion.create;
  const originalQuestionFindOne = AmiBotQuestion.findOne;
  const originalEmbeddingsEnabled = process.env.AMIBOT_EMBEDDINGS_ENABLED;
  const chatMessages = [];
  let knowledgeLookups = 0;

  try {
    process.env.AMIBOT_EMBEDDINGS_ENABLED = "false";
    AmiBotChatMessage.create = async (payload) => {
      chatMessages.push(payload);
      return { _id: String(chatMessages.length), ...payload };
    };
    AmiBotKnowledgeChunk.find = () => {
      knowledgeLookups += 1;
      return {
        sort() {
          return this;
        },
        limit() {
          return this;
        },
        lean: async () => [],
      };
    };
    AmiBotQuestion.create = () => {
      throw new Error("admin question should not be created for a direct greeting");
    };
    AmiBotQuestion.findOne = () => {
      throw new Error("admin question lookup should not run for a direct greeting");
    };

    const res = mockRes();

    await askAmibot(
      {
        body: { query: " hi " },
        user: { id: "507f1f77bcf86cd799439011" },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(
      res.body.response,
      "Hi! I am AmiBot. Ask me anything from the uploaded AmiBot knowledge."
    );
    assert.equal(res.body.answeredFromKnowledge, false);
    assert.equal(res.body.pendingQuestionId, null);
    assert.equal(knowledgeLookups, 2);
    assert.deepEqual(
      chatMessages.map((message) => message.sender),
      ["user", "bot"]
    );
    assert.equal(chatMessages[1].metadata.answerSource, "direct");
    assert.equal(chatMessages[1].metadata.interactionType, "greeting");
  } finally {
    AmiBotChatMessage.create = originalChatCreate;
    AmiBotKnowledgeChunk.find = originalChunkFind;
    AmiBotQuestion.create = originalQuestionCreate;
    AmiBotQuestion.findOne = originalQuestionFindOne;
    if (originalEmbeddingsEnabled === undefined) delete process.env.AMIBOT_EMBEDDINGS_ENABLED;
    else process.env.AMIBOT_EMBEDDINGS_ENABLED = originalEmbeddingsEnabled;
  }
});

test("askAmibot includes recent body history when answering follow-up questions", async () => {
  const controllerPath = require.resolve("../controllers/amibotController");
  const geminiService = require("../utils/geminiService");
  const originalGenerateGeminiText = geminiService.generateGeminiText;
  const originalChunkFind = AmiBotKnowledgeChunk.find;
  const originalEmbeddingsEnabled = process.env.AMIBOT_EMBEDDINGS_ENABLED;
  let capturedPrompt = "";

  try {
    process.env.AMIBOT_EMBEDDINGS_ENABLED = "false";
    delete require.cache[controllerPath];
    geminiService.generateGeminiText = async (prompt) => {
      capturedPrompt = prompt;
      return {
        text: JSON.stringify({
          answerable: true,
          answer: "Associate Consultant Technology at GlobalLogic.",
        }),
      };
    };

    AmiBotKnowledgeChunk.find = (criteria) => {
      const isTextSearch = Boolean(criteria?.$text);
      return {
        sort() {
          return this;
        },
        limit() {
          return this;
        },
        lean: async () => (
          isTextSearch
            ? [
              {
                _id: "designation",
                sourceId: "source-1",
                sourceName: "AmiBot_API",
                sourceType: "excel",
                chunkIndex: 32,
                chunkText:
                  "Topic: Current Designation\nAnswer: Associate Consultant Technology at GlobalLogic.\nSearch phrases: designation, role in company, job title.",
              },
            ]
            : []
        ),
      };
    };

    const { askAmibot: askAmibotWithMockedGemini } = require("../controllers/amibotController");
    const res = mockRes();

    await askAmibotWithMockedGemini(
      {
        body: {
          query: "what about designation?",
          history: [
            { sender: "user", text: "Where do you work now?" },
            { sender: "bot", text: "Currently working at GlobalLogic." },
          ],
        },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.response, "Associate Consultant Technology at GlobalLogic.");
    assert.equal(res.body.answeredFromKnowledge, true);
    assert.match(capturedPrompt, /Recent conversation/);
    assert.match(capturedPrompt, /Where do you work now\?/);
    assert.match(capturedPrompt, /Question:\nwhat about designation\?/);
  } finally {
    geminiService.generateGeminiText = originalGenerateGeminiText;
    AmiBotKnowledgeChunk.find = originalChunkFind;
    delete require.cache[controllerPath];
    if (originalEmbeddingsEnabled === undefined) delete process.env.AMIBOT_EMBEDDINGS_ENABLED;
    else process.env.AMIBOT_EMBEDDINGS_ENABLED = originalEmbeddingsEnabled;
    require("../controllers/amibotController");
  }
});

test("findRelevantKnowledge can use semantic candidates when keyword search misses", async () => {
  const controllerPath = require.resolve("../controllers/amibotController");
  const geminiService = require("../utils/geminiService");
  const originalGenerateGeminiEmbedding = geminiService.generateGeminiEmbedding;
  const originalChunkFind = AmiBotKnowledgeChunk.find;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalEmbeddingsEnabled = process.env.AMIBOT_EMBEDDINGS_ENABLED;

  try {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.AMIBOT_EMBEDDINGS_ENABLED = "true";
    delete require.cache[controllerPath];

    geminiService.generateGeminiEmbedding = async () => ({
      embedding: [1, 0],
      model: "test-embedding",
    });

    AmiBotKnowledgeChunk.find = (criteria) => {
      const isSemanticLookup = Boolean(criteria?.embedding);
      return {
        sort() {
          return this;
        },
        limit() {
          return this;
        },
        lean: async () => (
          isSemanticLookup
            ? [
              {
                _id: "career",
                sourceId: "source-1",
                sourceName: "AmiBot_API",
                sourceType: "excel",
                chunkIndex: 1,
                chunkText: "Topic: Career\nAnswer: Associate Consultant Technology.",
                embedding: [0.98, 0.1],
              },
              {
                _id: "fitness",
                sourceId: "source-1",
                sourceName: "AmiBot_API",
                sourceType: "excel",
                chunkIndex: 2,
                chunkText: "Topic: Fitness\nAnswer: Strength training.",
                embedding: [0.1, 0.98],
              },
            ]
            : []
        ),
      };
    };

    const { findRelevantKnowledge } = require("../controllers/amibotController");
    const matches = await findRelevantKnowledge("occupation");

    assert.equal(matches[0]._id, "career");
    assert.ok(matches[0].semanticScore > 0.5);
  } finally {
    geminiService.generateGeminiEmbedding = originalGenerateGeminiEmbedding;
    AmiBotKnowledgeChunk.find = originalChunkFind;
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
    if (originalEmbeddingsEnabled === undefined) delete process.env.AMIBOT_EMBEDDINGS_ENABLED;
    else process.env.AMIBOT_EMBEDDINGS_ENABLED = originalEmbeddingsEnabled;
    delete require.cache[controllerPath];
    require("../controllers/amibotController");
  }
});
