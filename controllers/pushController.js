const webpush = require('../utils/webPushConfig');

const subscriptions = [];

exports.subscribe = (req, res) => {
  const subscription = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription object' });
  }

  // Avoid duplicates
  if (!subscriptions.find((sub) => sub.endpoint === subscription.endpoint)) {
    subscriptions.push(subscription);
    console.log('New subscription added:', subscription.endpoint);
  }

  res.status(201).json({ message: 'Subscription stored.' });
};

exports.sendNotificationToAll = async (title = 'New Blog!', body = 'Check out the latest post on AmiVerse!') => {
  const payload = JSON.stringify({ title, body });

  const sendAll = subscriptions.map((sub) =>
    webpush.sendNotification(sub, payload).catch((err) => {
      console.error('Push error', err);
    })
  );

  await Promise.all(sendAll);
};
