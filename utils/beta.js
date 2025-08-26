// utils/beta.js
function gaussian() { // Box–Muller
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function gammaSample(shape) { // Marsaglia–Tsang
  if (shape < 1) {
    const u = Math.random();
    return gammaSample(1 + shape) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1/3, c = 1 / Math.sqrt(9*d);
  while (true) {
    let x, v, u;
    do { x = gaussian(); v = 1 + c * x; } while (v <= 0);
    v = v*v*v; u = Math.random();
    if (u < 1 - 0.0331 * (x*x)*(x*x)) return d * v;
    if (Math.log(u) < 0.5*x*x + d*(1 - v + Math.log(v))) return d * v;
  }
}

function betaSample(alpha, beta) {
  const x = gammaSample(alpha), y = gammaSample(beta);
  return x / (x + y);
}

module.exports = { betaSample };
