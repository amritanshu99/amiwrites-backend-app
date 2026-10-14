const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const dotenv = require("dotenv");

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");
if (process.argv.includes("--setup")) {
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const existing = dotenv.parse(content);
  const values = { AMIBOT_VOICE_URL: "http://127.0.0.1:8001", AMIBOT_VOICE_TOKEN: crypto.randomBytes(32).toString("hex") };
  for (const [name, value] of Object.entries(values)) {
    if (existing[name]) continue;
    const pattern = new RegExp(`^${name}=.*$`, "m");
    content = pattern.test(content) ? content.replace(pattern, `${name}=${value}`) : `${content.trimEnd()}\n${name}=${value}\n`;
  }
  fs.writeFileSync(envPath, content);
  console.log("Local voice settings saved to .env. No existing nonempty settings were changed. Restart Express after setup.");
} else {
  dotenv.config({ path: envPath });
  if (!process.env.AMIBOT_VOICE_TOKEN || process.env.AMIBOT_VOICE_TOKEN.length < 24) {
    console.error("Run npm run voice:setup first to create private voice service settings.");
    process.exit(1);
  }
  const service = path.join(root, "voice-service");
  const python = path.join(service, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  if (!fs.existsSync(python)) {
    console.error("Install the voice-service Python environment first. See voice-service/README.md.");
    process.exit(1);
  }
  const child = spawn(python, ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "8001"], {
    cwd: service, stdio: "inherit", windowsHide: true,
    env: { ...process.env, HF_HOME: process.env.HF_HOME || path.join(service, ".cache", "huggingface"), TORCH_HOME: process.env.TORCH_HOME || path.join(service, ".cache", "torch") },
  });
  child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code || 0; });
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}
