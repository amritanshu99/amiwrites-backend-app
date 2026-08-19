const { Resend } = require("resend");
const { escapeHtml, isValidEmail, normalizeEmail } = require("../utils/security");

const DEFAULT_CONTACT_TO_EMAIL = "amritanshu99@gmail.com";
let resendClient;

function getResendClient() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY not set. Configure RESEND_API_KEY env var.");
  }

  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }

  return resendClient;
}

async function sendEmail(message) {
  return getResendClient().emails.send(message);
}

function getRequestBody(req) {
  return req?.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body
    : {};
}

function createContactMailHandler({ emailSender = sendEmail, env = process.env } = {}) {
  return async function sendContactMail(req, res) {
    try {
      const body = getRequestBody(req);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const email = normalizeEmail(body.email);
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";

      if (!name || !email || !reason) {
        return res.status(400).json({ message: "All fields are required" });
      }

      if (name.length > 100 || reason.length > 5000 || !isValidEmail(email)) {
        return res.status(400).json({ message: "Invalid contact form details" });
      }

      const mailFrom = typeof env.MAIL_FROM === "string" ? env.MAIL_FROM.trim() : "";
      const configuredContactTo = normalizeEmail(env.CONTACT_TO_EMAIL);
      const contactTo = isValidEmail(configuredContactTo)
        ? configuredContactTo
        : DEFAULT_CONTACT_TO_EMAIL;

      if (!mailFrom) {
        console.error("MAIL_FROM not set in environment.");
        return res.status(500).json({ message: "Mail sender not configured on server" });
      }

      const { error } = await emailSender({
        from: mailFrom,
        to: contactTo,
        subject: "New Contact Form Submission",
        html: `
          <h3>Contact Form Message</h3>
          <p><strong>Name:</strong> ${escapeHtml(name)}</p>
          <p><strong>Email:</strong> ${escapeHtml(email)}</p>
          <p><strong>Reason:</strong> ${escapeHtml(reason)}</p>
        `,
        replyTo: email,
      });

      if (error) {
        console.error("Resend email error:", error);
        return res.status(500).json({ message: "Failed to send message" });
      }

      return res.status(200).json({ message: "Message sent successfully" });
    } catch (error) {
      console.error("Mail error:", error?.message || error);
      return res.status(500).json({ message: "Failed to send message" });
    }
  };
}

exports.sendContactMail = createContactMailHandler();

exports.__test = {
  createContactMailHandler,
  DEFAULT_CONTACT_TO_EMAIL,
};
