const { spawnSync } = require("child_process");
const fs = require("fs");

require("../src/puppeteer-env");

let execPath = "";
try {
  execPath = require("puppeteer").executablePath();
} catch {
  execPath = "";
}

if (execPath && fs.existsSync(execPath)) {
  console.log(`Puppeteer Chrome ready: ${execPath}`);
  process.exit(0);
}

console.log(`Installing Puppeteer Chrome to ${process.env.PUPPETEER_CACHE_DIR}...`);
const result = spawnSync("npx", ["puppeteer", "browsers", "install", "chrome"], {
  stdio: "inherit",
  env: { ...process.env },
  shell: true,
});
process.exit(result.status ?? 1);
