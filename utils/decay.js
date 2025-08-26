// utils/decay.js
const cron = require("node-cron");
const BlogStat = require("../models/BlogStat");
const DECAY = 0.97; // tune between 0.95–0.99

function startDecayJob() {
  // 03:15 every day (uses TZ from env if set)
  cron.schedule("15 3 * * *", async () => {
    try {
      await BlogStat.updateMany(
        {},
        {
          $mul: {
            alpha: DECAY,
            beta: DECAY,
            impressions: DECAY,
            clicks: DECAY,
            engaged_count: DECAY,
          },
          $set: { lastUpdated: new Date() },
        }
      );
      console.log("✅ Decay job applied");
    } catch (e) {
      console.error("❌ Decay job failed", e);
    }
  });
}
module.exports = { startDecayJob };
