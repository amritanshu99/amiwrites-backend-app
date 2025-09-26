const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);
const MAIL_FROM = process.env.MAIL_FROM; // Must be verified in Resend

exports.sendContactMail = async (req, res) => {
  try {
    const { name, email, reason } = req.body;

    if (!name || !email || !reason) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (!MAIL_FROM) {
      console.error("MAIL_FROM not set in environment.");
      return res.status(500).json({ message: "Mail sender not configured on server" });
    }

    // Build email
    const { error } = await resend.emails.send({
      from: MAIL_FROM,
      to: "amritanshu0909@gmail.com",  // your destination mailbox
      subject: "New Contact Form Submission",
      html: `
        <h3>Contact Form Message</h3>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Reason:</strong> ${reason}</p>
      `,
      // If you want the reply to go back to the submitter:
      reply_to: email
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
