// utils/beta.js
const MAX_GAMMA_ATTEMPTS = 10_000;
const MAX_BETA_ATTEMPTS = 100;

function assertPositiveShape(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number greater than 0`);
  }
}

function createUniformSampler(rng) {
  if (typeof rng !== "function") {
    throw new TypeError("rng must be a function");
  }

  return () => {
    const value = rng();
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError("rng must return a finite number in the range [0, 1)");
    }

    // Math.random() may legally return zero, while log(0) is undefined for the
    // transformations below. Number.MIN_VALUE is the nearest open-interval value.
    return value === 0 ? Number.MIN_VALUE : value;
  };
}

function gaussian(uniform) {
  // Box-Muller transform.
  const u = uniform();
  const v = uniform();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function gammaSample(shape, uniform) {
  // Boost sub-unit shapes before applying Marsaglia-Tsang.
  if (shape < 1) {
    const boosted = gammaSample(shape + 1, uniform);
    return boosted * Math.pow(uniform(), 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  for (let attempt = 0; attempt < MAX_GAMMA_ATTEMPTS; attempt += 1) {
    const x = gaussian(uniform);
    const base = 1 + c * x;
    if (base <= 0) continue;

    const v = base * base * base;
    const u = uniform();
    const sample = d * v;

    if (
      u < 1 - 0.0331 * x * x * x * x ||
      Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))
    ) {
      if (Number.isFinite(sample) && sample >= 0) return sample;
      throw new RangeError("gamma sample was not finite");
    }
  }

  throw new RangeError("rng did not produce a gamma sample within the attempt limit");
}

function stableRatio(x, y) {
  if (x === 0 && y === 0) return null;
  if (x === 0) return 0;
  if (y === 0) return 1;

  // Avoid overflowing x + y when both gamma samples are very large.
  if (x < y) {
    const ratio = x / y;
    return ratio / (1 + ratio);
  }

  return 1 / (1 + y / x);
}

/**
 * Draw a sample from Beta(alpha, beta).
 *
 * The optional rng must have Math.random semantics: a function returning a
 * finite number in [0, 1). Invalid shapes and RNGs fail explicitly instead of
 * leaking NaN/Infinity into a ranking score.
 */
function betaSample(alpha, beta, rng = Math.random) {
  assertPositiveShape(alpha, "alpha");
  assertPositiveShape(beta, "beta");
  const uniform = createUniformSampler(rng);

  for (let attempt = 0; attempt < MAX_BETA_ATTEMPTS; attempt += 1) {
    const x = gammaSample(alpha, uniform);
    const y = gammaSample(beta, uniform);
    const sample = stableRatio(x, y);

    // Both gamma draws can underflow to zero for extremely small shapes. Retry
    // that rare case; every returned value is guaranteed to be a valid score.
    if (sample !== null && Number.isFinite(sample) && sample >= 0 && sample <= 1) {
      return sample;
    }
  }

  throw new RangeError("unable to produce a finite beta sample");
}

module.exports = { betaSample };
