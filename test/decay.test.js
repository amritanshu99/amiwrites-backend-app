const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DECAY,
  PRIORS,
  applyDailyDecay,
  buildDailyDecayFilter,
  buildDailyDecayPipeline,
  decayStat,
  getUtcDayStart,
  startDecayJob,
} = require("../utils/decay");

test("decayStat decays only evidence above the Bayesian priors", () => {
  assert.deepEqual(
    decayStat({
      alpha: PRIORS.alpha + 10,
      beta: PRIORS.beta + 5,
      impressions: 100,
      clicks: 25,
      engaged_count: 8,
    }),
    {
      alpha: PRIORS.alpha + 10 * DECAY,
      beta: PRIORS.beta + 5 * DECAY,
      impressions: 100 * DECAY,
      clicks: 25 * DECAY,
      engaged_count: 8 * DECAY,
    }
  );
});

test("decayStat floors missing, non-finite, and below-floor values", () => {
  assert.deepEqual(
    decayStat({
      alpha: -100,
      beta: NaN,
      impressions: -1,
      clicks: Infinity,
      engaged_count: "12",
    }),
    {
      alpha: PRIORS.alpha,
      beta: PRIORS.beta,
      impressions: 0,
      clicks: 0,
      engaged_count: 0,
    }
  );
  assert.deepEqual(decayStat(), {
    alpha: PRIORS.alpha,
    beta: PRIORS.beta,
    impressions: 0,
    clicks: 0,
    engaged_count: 0,
  });
});

test("UTC day boundaries do not depend on the server's local timezone", () => {
  assert.deepEqual(
    getUtcDayStart("2026-08-11T23:59:59.999-05:00"),
    new Date("2026-08-12T00:00:00.000Z")
  );
});

test("applyDailyDecay uses an atomic once-per-UTC-day filter and pipeline", async () => {
  const calls = [];
  const model = {
    async updateMany(filter, update) {
      calls.push({ filter, update });
      return { acknowledged: true, modifiedCount: 3 };
    },
  };
  const now = new Date("2026-08-11T18:45:12.000Z");

  const result = await applyDailyDecay({ model, now });

  assert.deepEqual(result, { acknowledged: true, modifiedCount: 3 });
  assert.deepEqual(calls, [{
    filter: buildDailyDecayFilter(new Date("2026-08-11T00:00:00.000Z")),
    update: buildDailyDecayPipeline(now),
  }]);

  const [{ $set }] = calls[0].update;
  assert.deepEqual($set.lastDecayAt, now);
  assert.deepEqual($set.lastUpdated, now);
  assert.ok($set.alpha.$add);
  assert.ok($set.beta.$add);
  assert.ok($set.impressions.$add);
  assert.ok($set.clicks.$add);
  assert.ok($set.engaged_count.$add);
});

test("same-day calls use the same claim cutoff for multi-instance safety", async () => {
  const filters = [];
  const model = {
    async updateMany(filter) {
      filters.push(filter);
      return { acknowledged: true };
    },
  };

  await Promise.all([
    applyDailyDecay({ model, now: "2026-08-11T01:00:00.000Z" }),
    applyDailyDecay({ model, now: "2026-08-11T22:00:00.000Z" }),
  ]);

  assert.deepEqual(filters[0], filters[1]);
  assert.deepEqual(
    filters[0].$or[2],
    { lastDecayAt: { $lt: new Date("2026-08-11T00:00:00.000Z") } }
  );
});

test("the scheduled job delegates to the same daily decay operation", async () => {
  let scheduled;
  const scheduler = {
    schedule(expression, callback, options) {
      scheduled = { expression, callback, options };
      return { stop() {} };
    },
  };
  const calls = [];
  const model = {
    async updateMany(filter, update) {
      calls.push({ filter, update });
      return { acknowledged: true, modifiedCount: 1 };
    },
  };
  const logger = { log() {}, error() {} };
  const now = new Date("2026-08-11T03:15:00.000Z");

  const task = startDecayJob({
    model,
    scheduler,
    clock: () => now,
    timezone: "Asia/Calcutta",
    logger,
  });

  assert.equal(typeof task.stop, "function");
  assert.equal(scheduled.expression, "15 3 * * *");
  assert.deepEqual(scheduled.options, { timezone: "Asia/Calcutta" });
  assert.equal(calls.length, 1, "startup immediately performs a guarded catch-up");

  await scheduled.callback();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].filter, buildDailyDecayFilter(getUtcDayStart(now)));
  assert.deepEqual(calls[0].update, buildDailyDecayPipeline(now));
  assert.deepEqual(calls[1].filter, calls[0].filter);
  assert.deepEqual(calls[1].update, calls[0].update);
});

test("decay helpers reject invalid factors and dates", async () => {
  assert.throws(() => decayStat({}, 1.1), RangeError);
  assert.throws(() => buildDailyDecayPipeline(new Date("invalid")), RangeError);
  await assert.rejects(() => applyDailyDecay({ model: {}, now: new Date() }), TypeError);
});
