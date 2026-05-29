const { Resend } = require("resend");
const { escapeHtml, isValidEmail, normalizeEmail } = require("../utils/security");

const MAIL_FROM = process.env.MAIL_FROM;
const CONTACT_TO = process.env.CONTACT_TO_EMAIL || "amritanshu0909@gmail.com";
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

exports.sendContactMail = async (req, res) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const email = normalizeEmail(req.body.email);
    const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";

    if (!name || !email || !reason) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (name.length > 100 || reason.length > 5000 || !isValidEmail(email)) {
      return res.status(400).json({ message: "Invalid contact form details" });
    }

    if (!MAIL_FROM) {
      console.error("MAIL_FROM not set in environment.");
      return res.status(500).json({ message: "Mail sender not configured on server" });
    }

    const { error } = await getResendClient().emails.send({
      from: MAIL_FROM,
      to: CONTACT_TO,
      subject: "New Contact Form Submission",
      html: `
        <h3>Contact Form Message</h3>
        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Reason:</strong> ${escapeHtml(reason)}</p>
      `,
      reply_to: email,
    });

    if (error) {
      console.error("Resend email error:", error);
      return res.status(500).json({ message: "Failed to send message" });
    }

    res.status(200).json({ message: "Message sent successfully" });
  } catch (error) {
    console.error("Mail error:", error.message);
    res.status(500).json({ message: "Failed to send message" });
  }
};
