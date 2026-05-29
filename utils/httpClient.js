const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

async function readLimitedText(response, maxResponseBytes) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxResponseBytes) {
    const error = new Error("Upstream response too large");
    error.code = "RESPONSE_TOO_LARGE";
    throw error;
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxResponseBytes) {
      const error = new Error("Upstream response too large");
      error.code = "RESPONSE_TOO_LARGE";
      throw error;
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > maxResponseBytes) {
      const error = new Error("Upstream response too large");
      error.code = "RESPONSE_TOO_LARGE";
      throw error;
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function fetchText(url, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  ...options
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await readLimitedText(response, maxResponseBytes);

    return { response, text };
  } catch (error) {
    if (error.name === "AbortError") {
      error.code = "ETIMEDOUT";
      error.message = "Upstream request timed out";
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}) {
  const { response, text } = await fetchText(url, options);
  const data = text ? JSON.parse(text) : null;

  return { response, data, text };
}

module.exports = {
  fetchJson,
  fetchText,
};
