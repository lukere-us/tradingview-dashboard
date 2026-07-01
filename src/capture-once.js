const { captureAllCoins } = require("./services/screenshotter");

captureAllCoins({
  onProgress: (event) => {
    if (event.phase === "start") {
      console.log(`[${event.current}/${event.total}] Capturing ${event.coin}...`);
    }
  },
})
  .then((results) => {
    console.log("Done:", JSON.stringify(results, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error("Capture failed:", err.message);
    process.exit(1);
  });
