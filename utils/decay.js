// utils/decay.js
const cron = require("node-cron");
const BlogStat = require("../models/BlogStat");

const DECAY = 0.97;
const PRIORS = Object.freeze({ alpha: 1.5, beta: 1.0 });
const COUNTER_FIELDS = Object.freeze(["impressions", "clicks", "engaged_count"]);
const MAX_FINITE_NUMBER = Number.MAX_VALUE;

function assertDecayFactor(decay) {
  if (typeof decay !== "number" || !Number.isFinite(decay) || decay < 0 || decay > 1) {
    throw new RangeError("decay must be a finite number between 0 and 1");
  }
}

function floorFiniteNumber(value, floor) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(floor, value)
    : floor;
}

function decayAboveFloor(value, floor, decay = DECAY) {
  assertDecayFactor(decay);
  const safeValue = floorFiniteNumber(value, floor);
  return floor + (safeValue - floor) * decay;
}

function decayStat(stat, decay = DECAY) {
  assertDecayFactor(decay);
  const source = stat && typeof stat === "object" ? stat : {};

  return {
    alpha: decayAboveFloor(source.alpha, PRIORS.alpha, decay),
    beta: decayAboveFloor(source.beta, PRIORS.beta, decay),
    impressions: decayAboveFloor(source.impressions, 0, decay),
    clicks: decayAboveFloor(source.clicks, 0, decay),
    engaged_count: decayAboveFloor(source.engaged_count, 0, decay),
  };
}

function toValidDate(value, name) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError(`${name} must be a valid date`);
  }
  return date;
}

function getUtcDayStart(now = new Date()) {
  const date = toValidDate(now, "now");
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function buildDailyDecayFilter(dayStart) {
  const cutoff = toValidDate(dayStart, "dayStart");
  return {
    $or: [
      { lastDecayAt: { $exists: false } },
      { lastDecayAt: null },
      { lastDecayAt: { $lt: cutoff } },
    ],
  };
}

function finiteNumberAtLeast(field, floor) {
  const fieldReference = `$${field}`;
  return {
    $cond: [
      {
        $and: [
          { $isNumber: fieldReference },
          { $gte: [fieldReference, floor] },
          { $lte: [fieldReference, MAX_FINITE_NUMBER] },
        ],
      },
      fieldReference,
      floor,
    ],
  };
}

function decayExpression(field, floor, decay) {
  const safeValue = finiteNumberAtLeast(field, floor);
  return {
    $add: [floor, { $multiply: [{ $subtract: [safeValue, floor] }, decay] }],
  };
}

function buildDailyDecayPipeline(runAt, decay = DECAY) {
  assertDecayFactor(decay);
  const timestamp = toValidDate(runAt, "runAt");
  const set = {
    alpha: decayExpression("alpha", PRIORS.alpha, decay),
    beta: decayExpression("beta", PRIORS.beta, decay),
    lastDecayAt: timestamp,
    lastUpdated: timestamp,
  };

  for (const field of COUNTER_FIELDS) {
    set[field] = decayExpression(field, 0, decay);
  }

  return [{ $set: set }];
}

/**
 * Atomically claims and decays every stat not yet processed on this UTC day.
 * MongoDB re-checks the update predicate while acquiring each document lock,
 * so concurrent application instances cannot both match the same row.
 */
async function applyDailyDecay({ model = BlogStat, now = new Date(), decay = DECAY } = {}) {
  if (!model || typeof model.updateMany !== "function") {
    throw new TypeError("model must provide updateMany(filter, update)");
  }

  const runAt = toValidDate(now, "now");
  const dayStart = getUtcDayStart(runAt);
  return model.updateMany(
    buildDailyDecayFilter(dayStart),
    buildDailyDecayPipeline(runAt, decay)
  );
}

function startDecayJob({
  model = BlogStat,
  scheduler = cron,
  clock = () => new Date(),
  decay = DECAY,
  timezone = process.env.TZ,
  logger = console,
} = {}) {
  if (!scheduler || typeof scheduler.schedule !== "function") {
    throw new TypeError("scheduler must provide schedule(expression, callback, options)");
  }
  if (typeof clock !== "function") {
    throw new TypeError("clock must be a function");
  }
  assertDecayFactor(decay);

  const runDecay = async () => {
    try {
      const result = await applyDailyDecay({ model, now: clock(), decay });
      logger.log("Decay job applied");
      return result;
    } catch (error) {
      logger.error("Decay job failed", error);
      return undefined;
    }
  };

  const scheduleOptions = timezone ? { timezone } : undefined;
  const task = scheduler.schedule("15 3 * * *", runDecay, scheduleOptions);

  // Hosted instances may sleep through the scheduled time. The daily filter is
  // an idempotency guard, so a startup catch-up is safe even when cron fires too.
  void runDecay();
  return task;
}

module.exports = {
  COUNTER_FIELDS,
  DECAY,
  PRIORS,
  applyDailyDecay,
  buildDailyDecayFilter,
  buildDailyDecayPipeline,
  decayAboveFloor,
  decayStat,
  getUtcDayStart,
  startDecayJob,
};
