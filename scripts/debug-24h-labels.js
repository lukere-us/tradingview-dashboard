const sharp = require("sharp");
const path = require("path");

// Load chartSignal internals by requiring and using exported helpers
const chartSignalPath = path.join(__dirname, "..", "src", "services", "chartSignal.js");
const fs = require("fs");
const vm = require("vm");

async function main() {
  const imagePath =
    process.argv[2] ||
    path.join(__dirname, "..", "screenshots", "current", "ada.png");

  const {
    findAllChartTextLabels,
    filterLabelsIn24h,
    dedupeChartLabels,
    analyzeChartSignals24h,
    window24hLeftX,
    PLOT,
  } = require(chartSignalPath);

  const { data, info } = await sharp(imagePath)
    .resize(1280, 720, { fit: "fill" })
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });

  const all = findAllChartTextLabels(data, info.channels);
  const in24 = filterLabelsIn24h(all);
  const ded = dedupeChartLabels(in24);
  const result = await analyzeChartSignals24h(imagePath);

  console.log("sinceX", window24hLeftX());
  console.log("all", all.length, all);
  console.log("in24", in24.length, in24.map((b) => `${b.type}@${Math.round(b.centerX)}`));
  console.log("deduped", ded.map((b) => `${b.type}@${Math.round(b.centerX)}`));
  console.log("final", result.signals);
  console.log("totals", result.totals);
}

main().catch(console.error);
