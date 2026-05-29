const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, maxlength: 50 },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 254 },
  password: { type: String, required: true },
  resetToken: { type: String, index: true },
  resetTokenExpiry: { type: Date, index: true }
});

module.exports = mongoose.model("User", userSchema);
