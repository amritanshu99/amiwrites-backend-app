const webpush = require("../utils/webPushConfig");
const Subscription = require("../models/Subscription");

function isValidSubscription(subscription) {
  if (!subscription || typeof subscription !== "object") return false;
  if (typeof subscription.endpoint !== "string") return false;

  try {
    const endpoint = new URL(subscription.endpoint);
    if (endpoint.protocol !== "https:") return false;
  } catch {
    return false;
  }

  return Boolean(
    subscription.keys &&
    typeof subscription.keys.p256dh === "string" &&
    typeof subscription.keys.auth === "string"
  );
}

exports.subscribe = async (req, res) => {
  const subscription = req.body;

  if (!isValidSubscription(subscription)) {
    return res.status(400).json({ error: "Invalid subscription object" });
  }

  try {
    await Subscription.updateOne(
      { endpoint: subscription.endpoint },
      {
        $setOnInsert: {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
        },
      },
      { upsert: true }
    );

    res.status(201).json({ message: "Subscription stored." });
  } catch (err) {
    console.error("Failed to store subscription:", err.message || err);
    res.status(500).json({ error: "Subscription storage failed" });
  }
};

exports.sendNotificationToAll = async ({
  title = "New Blog!",
  body = "Check out the latest post on AmiVerse!",
  icon = "https://amiwrites-backend-app-1.onrender.com/images/favicon.ico",
  url = "https://www.amiverse.in/blogs",
} = {}) => {
  try {
    const subscriptions = await Subscription.find({}, { endpoint: 1, keys: 1 }).lean();
    const payload = JSON.stringify({
      notification: {
        title,
        body,
        icon,
        url,
      },
    });

    const batchSize = 25;
    for (let i = 0; i < subscriptions.length; i += batchSize) {
      const batch = subscriptions.slice(i, i + batchSize);
      await Promise.all(batch.map(async (sub) => {
        try {
          await webpush.sendNotification(sub, payload);
        } catch (err) {
          console.error("Push error:", err.message || err);

          if (err.statusCode === 404 || err.statusCode === 410) {
            await Subscription.deleteOne({ endpoint: sub.endpoint }).catch((deleteErr) => {
              console.error("Failed to remove stale subscription:", deleteErr.message || deleteErr);
            });
          }
        }
      }));
    }
  } catch (err) {
    console.error("Error sending notifications:", err.message || err);
  }
};
