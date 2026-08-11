const test = require("node:test");
const assert = require("node:assert/strict");
const { betaSample } = require("../utils/beta");

function seededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

test("betaSample returns finite samples inside the closed unit interval", () => {
  const rng = seededRng(42);

  for (let index = 0; index < 1_000; index += 1) {
    const sample = betaSample(1.5, 1, rng);
    assert.equal(Number.isFinite(sample), true);
    assert.ok(sample >= 0 && sample <= 1);
  }
});

test("betaSample supports deterministic injected RNGs", () => {
  const firstRng = seededRng(123);
  const secondRng = seededRng(123);
  const first = Array.from({ length: 20 }, () => betaSample(2.5, 4, firstRng));
  const second = Array.from({ length: 20 }, () => betaSample(2.5, 4, secondRng));

  assert.deepEqual(first, second);
});

test("betaSample rejects invalid distribution shapes explicitly", () => {
  for (const invalid of [0, -1, NaN, Infinity, "2", null, undefined]) {
    assert.throws(() => betaSample(invalid, 1), RangeError);
    assert.throws(() => betaSample(1, invalid), RangeError);
  }
});

test("betaSample validates injected RNG values", () => {
  assert.throws(() => betaSample(1, 1, null), TypeError);
  for (const invalid of [-0.1, 1, Infinity, NaN, "0.5"]) {
    assert.throws(() => betaSample(1, 1, () => invalid), RangeError);
  }
});

test("betaSample safely handles a legal zero from an injected RNG", () => {
  let firstDraw = true;
  const sample = betaSample(2, 3, () => {
    if (firstDraw) {
      firstDraw = false;
      return 0;
    }
    return 0.5;
  });
  assert.equal(Number.isFinite(sample), true);
  assert.ok(sample >= 0 && sample <= 1);
});

test("seeded samples converge broadly on the distribution mean", () => {
  const alpha = 3;
  const beta = 7;
  const expectedMean = alpha / (alpha + beta);
  const rng = seededRng(987654321);
  const samples = Array.from({ length: 20_000 }, () => betaSample(alpha, beta, rng));
  const observedMean = samples.reduce((sum, value) => sum + value, 0) / samples.length;

  assert.ok(Math.abs(observedMean - expectedMean) < 0.01, {
    expectedMean,
    observedMean,
  });
});
