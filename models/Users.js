const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, maxlength: 50 },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 254 },
  password: {
    type: String,
    required() {
      return !this.googleSub;
    },
  },
  googleSub: { type: String, unique: true, sparse: true, trim: true, maxlength: 255 },
  displayName: { type: String, trim: true, maxlength: 160 },
  avatarUrl: { type: String, trim: true, maxlength: 2048 },
  emailVerified: { type: Boolean, default: false },
  authProviders: {
    type: [{ type: String, enum: ["password", "google"] }],
    default() {
      return this.googleSub && !this.password ? ["google"] : ["password"];
    },
  },
  authVersion: { type: Number, default: 0, min: 0 },
  googleLinkedAt: { type: Date },
  lastLoginAt: { type: Date },
  resetToken: { type: String, index: true },
  resetTokenExpiry: { type: Date, index: true },
}, {
  timestamps: true,
});

module.exports = mongoose.model("User", userSchema);
