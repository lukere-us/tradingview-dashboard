const path = require("path");

process.env.PUPPETEER_CACHE_DIR = path.join(__dirname, "..", ".cache", "puppeteer");
