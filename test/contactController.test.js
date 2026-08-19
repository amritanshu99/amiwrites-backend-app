const test = require("node:test");
const assert = require("node:assert/strict");
const contactController = require("../controllers/contactController");

const {
  createContactMailHandler,
  DEFAULT_CONTACT_TO_EMAIL,
} = contactController.__test;

function response() {
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

function validRequest(overrides = {}) {
  return {
    body: {
      name: "Visitor",
      email: "visitor@example.com",
      reason: "I would like to connect.",
      ...overrides,
    },
  };
}

async function withoutConsoleErrors(callback) {
  const originalConsoleError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);

  try {
    await callback(errors);
  } finally {
    console.error = originalConsoleError;
  }
}

test("contact mail sends normalized, escaped content with the configured addresses", async () => {
  let sentMessage;
  const handler = createContactMailHandler({
    env: {
      MAIL_FROM: "  AmiVerse <noreply@example.com>  ",
      CONTACT_TO_EMAIL: "  owner@example.com  ",
    },
    emailSender: async (message) => {
      sentMessage = message;
      return { data: { id: "email-1" }, error: null };
    },
  });
  const res = response();

  await handler(validRequest({
    name: "  <Writer & Friend>  ",
    email: "  VISITOR@Example.COM  ",
    reason: "Need <help> & 'advice'",
  }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { message: "Message sent successfully" });
  assert.equal(sentMessage.from, "AmiVerse <noreply@example.com>");
  assert.equal(sentMessage.to, "owner@example.com");
  assert.equal(sentMessage.subject, "New Contact Form Submission");
  assert.equal(sentMessage.replyTo, "visitor@example.com");
  assert.equal(Object.hasOwn(sentMessage, "reply_to"), false);
  assert.match(sentMessage.html, /&lt;Writer &amp; Friend&gt;/);
  assert.match(sentMessage.html, /visitor@example\.com/);
  assert.match(sentMessage.html, /Need &lt;help&gt; &amp; &#39;advice&#39;/);
  assert.doesNotMatch(sentMessage.html, /<Writer & Friend>/);
});

test("contact mail uses the canonical recipient fallback for blank or invalid configuration", async () => {
  assert.equal(DEFAULT_CONTACT_TO_EMAIL, "amritanshu99@gmail.com");

  for (const configuredRecipient of ["   ", "not-an-email"]) {
    let sentMessage;
    const handler = createContactMailHandler({
      env: {
        MAIL_FROM: "AmiVerse <noreply@example.com>",
        CONTACT_TO_EMAIL: configuredRecipient,
      },
      emailSender: async (message) => {
        sentMessage = message;
        return { data: { id: "email-2" }, error: null };
      },
    });
    const res = response();

    await handler(validRequest(), res);

    assert.equal(res.statusCode, 200);
    assert.equal(sentMessage.to, DEFAULT_CONTACT_TO_EMAIL);
  }
});

test("contact mail rejects missing and non-object bodies without invoking the sender", async () => {
  let sendCalls = 0;
  const handler = createContactMailHandler({
    env: { MAIL_FROM: "AmiVerse <noreply@example.com>" },
    emailSender: async () => {
      sendCalls += 1;
      return { error: null };
    },
  });
  const requests = [
    {},
    { body: null },
    { body: [] },
    { body: "invalid" },
    { body: { name: "Visitor", email: "visitor@example.com" } },
  ];

  for (const req of requests) {
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { message: "All fields are required" });
  }

  assert.equal(sendCalls, 0);
});

test("contact mail rejects invalid field values without invoking the sender", async () => {
  let sendCalls = 0;
  const handler = createContactMailHandler({
    env: { MAIL_FROM: "AmiVerse <noreply@example.com>" },
    emailSender: async () => {
      sendCalls += 1;
      return { error: null };
    },
  });
  const invalidBodies = [
    { name: "n".repeat(101) },
    { email: "not-an-email" },
    { reason: "r".repeat(5001) },
  ];

  for (const invalidBody of invalidBodies) {
    const res = response();
    await handler(validRequest(invalidBody), res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { message: "Invalid contact form details" });
  }

  assert.equal(sendCalls, 0);
});

test("contact mail reports a missing sender configuration without sending", async () => {
  let sendCalls = 0;
  const handler = createContactMailHandler({
    env: { CONTACT_TO_EMAIL: "owner@example.com" },
    emailSender: async () => {
      sendCalls += 1;
      return { error: null };
    },
  });
  const res = response();

  await withoutConsoleErrors(async (errors) => {
    await handler(validRequest(), res);
    assert.equal(errors.length, 1);
  });

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { message: "Mail sender not configured on server" });
  assert.equal(sendCalls, 0);
});

test("contact mail converts a provider error response into a generic 500", async () => {
  const handler = createContactMailHandler({
    env: { MAIL_FROM: "AmiVerse <noreply@example.com>" },
    emailSender: async () => ({ data: null, error: { message: "provider rejected" } }),
  });
  const res = response();

  await withoutConsoleErrors(async (errors) => {
    await handler(validRequest(), res);
    assert.equal(errors.length, 1);
  });

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { message: "Failed to send message" });
});

test("contact mail converts a thrown provider failure into a generic 500", async () => {
  const handler = createContactMailHandler({
    env: { MAIL_FROM: "AmiVerse <noreply@example.com>" },
    emailSender: async () => {
      throw new Error("network unavailable");
    },
  });
  const res = response();

  await withoutConsoleErrors(async (errors) => {
    await handler(validRequest(), res);
    assert.equal(errors.length, 1);
  });

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { message: "Failed to send message" });
});
