const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  _id: { type: String, default: "amibot" },
  audio: { type: Buffer, required: true, select: false },
  duration: { type: Number, required: true },
  revision: { type: String, required: true },
  browserSharingConsent: { type: Boolean, required: true },
}, { timestamps: true });

module.exports = mongoose.model("AmiBotVoiceProfile", schema);
