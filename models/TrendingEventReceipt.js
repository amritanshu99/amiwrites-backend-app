const mongoose = require("mongoose");

const DEFAULT_RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function receiptExpiry() {
  return new Date(Date.now() + DEFAULT_RECEIPT_TTL_MS);
}

const TrendingEventReceiptSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 8,
      maxlength: 128,
    },
    eventType: {
      type: String,
      required: true,
      enum: ["impression", "click", "read-end"],
    },
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Blog",
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      default: receiptExpiry,
    },
  },
  { timestamps: true }
);

TrendingEventReceiptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const TrendingEventReceipt = mongoose.model(
  "TrendingEventReceipt",
  TrendingEventReceiptSchema
);

module.exports = TrendingEventReceipt;
module.exports.DEFAULT_RECEIPT_TTL_MS = DEFAULT_RECEIPT_TTL_MS;
