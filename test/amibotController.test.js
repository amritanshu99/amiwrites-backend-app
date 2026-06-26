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
