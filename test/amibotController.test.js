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
  const chatMessages = [];
  let knowledgeLookups = 0;

  try {
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
  }
});

test("askAmibot includes recent body history when answering follow-up questions", async () => {
  const controllerPath = require.resolve("../controllers/amibotController");
  const geminiService = require("../utils/geminiService");
  const originalGenerateGeminiText = geminiService.generateGeminiText;
  const originalChunkFind = AmiBotKnowledgeChunk.find;
  let capturedPrompt = "";

  try {
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
    require("../controllers/amibotController");
  }
});
