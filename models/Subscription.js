const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  endpoint: { type: String, required: true, unique: true },
  keys: {
    p256dh: String,
    auth: String,
  },
}, { timestamps: true });

module.exports = mongoose.model('Subscription', subscriptionSchema);
