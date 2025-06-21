const webpush = require('../utils/webPushConfig');
const Subscription = require('../models/Subscription');

exports.subscribe = async (req, res) => {
  const subscription = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription object' });
  }

  try {
    const existing = await Subscription.findOne({ endpoint: subscription.endpoint });
    if (!existing) {
      await Subscription.create(subscription);
      console.log('📬 New subscription stored:', subscription.endpoint);
    }

    res.status(201).json({ message: 'Subscription stored.' });
  } catch (err) {
    console.error('❌ Failed to store subscription:', err);
    res.status(500).json({ error: 'Subscription storage failed' });
  }
};

exports.sendNotificationToAll = async ({
  title = 'New Blog!',
  body = 'Check out the latest post on AmiVerse!',
  icon = 'https://amiwrites-backend-app-1.onrender.com/images/favicon.ico',
  url = 'https://www.amiverse.in/blogs'
} = {}) => {
  try {
    const subscriptions = await Subscription.find();
    console.log(`📣 Sending push notifications to ${subscriptions.length} subscribers...`);

    const payload = JSON.stringify({
      notification: {
        title,
        body,
        icon,
        url
      }
    });

    const sendAll = subscriptions.map(sub =>
      webpush.sendNotification(sub, payload).catch(err => {
        console.error('❌ Push error', err);
        // Optionally: remove invalid subscriptions from DB
      })
    );

    await Promise.all(sendAll);
    console.log('✅ All notifications attempted.');
  } catch (err) {
    console.error('❌ Error sending notifications:', err);
  }
};

