const webpush = require('../utils/webPushConfig');

const subscriptions = [];

exports.subscribe = (req, res) => {
  const subscription = req.body;

  if (!subscription || !subscription.endpoint) {
    console.warn('⚠️ Invalid subscription object received');
    return res.status(400).json({ error: 'Invalid subscription object' });
  }

  const exists = subscriptions.find((sub) => sub.endpoint === subscription.endpoint);

  if (!exists) {
    subscriptions.push(subscription);
    console.log('✅ New subscription added:', subscription.endpoint);
    console.log('📦 Total active subscriptions:', subscriptions.length);
  } else {
    console.log('ℹ️ Subscription already exists:', subscription.endpoint);
  }

  res.status(201).json({ message: 'Subscription stored.' });
};

exports.sendNotificationToAll = async (
  title = '🆕 New Blog!',
  body = 'Check out the latest post on AmiVerse!'
) => {
  const payload = JSON.stringify({ title, body });

  console.log(`📣 Sending push notifications to ${subscriptions.length} subscribers...`);

  const sendAll = subscriptions.map((sub, index) =>
    webpush.sendNotification(sub, payload)
      .then(() => {
        console.log(`✅ Notification sent to subscriber #${index + 1}: ${sub.endpoint}`);
      })
      .catch((err) => {
        console.error(`❌ Error sending to subscriber #${index + 1}:`, err);
      })
  );

  await Promise.all(sendAll);

  console.log('✅ All notifications attempted.');
};
