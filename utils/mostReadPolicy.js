// Launch day is 4 November 2026, midnight in Asia/Kolkata. Never backfill legacy stats.
const TRACKING_STARTED_AT = new Date("2026-11-03T18:30:00.000Z");
const MIN_READ_MS = 30_000;
const MAX_READ_MS = 6 * 60 * 60 * 1000;
const MOST_READ_LIMIT = 4;

function readerDay(now) {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

module.exports = { TRACKING_STARTED_AT, MIN_READ_MS, MAX_READ_MS, MOST_READ_LIMIT, readerDay };
