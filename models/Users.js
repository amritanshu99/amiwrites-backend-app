const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: {
    type: String,
    required: true,
    unique: true,
    match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address"]
  },
  password: { type: String, required: true },
  resetToken: String,
  resetTokenExpiry: Date,
});

module.exports = mongoose.model("User", userSchema);
