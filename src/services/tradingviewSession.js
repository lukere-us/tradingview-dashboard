const path = require("path");
const puppeteer = require("puppeteer");

const PROFILE_DIR = path.join(__dirname, "..", "..", "data", "tradingview-profile");

let loginBrowser = null;

const BASE_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
];

function isLoggedInFromCookies(cookies) {
  return cookies.some(
    (cookie) =>
      cookie.domain.includes("tradingview.com") &&
      (cookie.name === "sessionid" || cookie.name === "sessionid_sign") &&
      cookie.value &&
      cookie.value !== "false"
  );
}

function getBrowserLaunchOptions({ headless = true } = {}) {
  return {
    headless,
    userDataDir: PROFILE_DIR,
    args: [...BASE_ARGS, "--window-size=1280,720"],
  };
}

function isLoginBrowserOpen() {
  return Boolean(loginBrowser);
}

async function assertProfileAvailable() {
  if (loginBrowser) {
    throw new Error(
      "Close the TradingView login window before capturing screenshots."
    );
  }
}

async function getSessionStatus() {
  if (loginBrowser) {
    return {
      loggedIn: null,
      loginBrowserOpen: true,
      message: "Login window is open — sign in, then click Save Login.",
    };
  }

  let browser;
  try {
    browser = await puppeteer.launch(getBrowserLaunchOptions({ headless: true }));
    const page = await browser.newPage();
    await page.goto("https://www.tradingview.com/", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    const cookies = await page.cookies("https://www.tradingview.com");
    const loggedIn = isLoggedInFromCookies(cookies);
    return {
      loggedIn,
      loginBrowserOpen: false,
      message: loggedIn
        ? "Logged in — your saved chart layout and indicators will be used."
        : "Not logged in — open Login to TradingView and sign in.",
    };
  } catch (err) {
    return {
      loggedIn: false,
      loginBrowserOpen: false,
      message: `Could not check login status: ${err.message}`,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function openLoginBrowser() {
  await assertProfileAvailable();

  if (loginBrowser) {
    return { opened: false, alreadyOpen: true };
  }

  loginBrowser = await puppeteer.launch({
    ...getBrowserLaunchOptions({ headless: false }),
    defaultViewport: null,
    args: [...BASE_ARGS, "--start-maximized"],
  });

  loginBrowser.on("disconnected", () => {
    loginBrowser = null;
  });

  const pages = await loginBrowser.pages();
  const page = pages[0] || (await loginBrowser.newPage());
  await page.goto("https://www.tradingview.com/accounts/signin/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  return {
    opened: true,
    message:
      "Sign in to TradingView in the browser window. Set up your indicators on a chart, save the layout, then click Save Login.",
  };
}

async function closeLoginBrowser() {
  if (loginBrowser) {
    await loginBrowser.close().catch(() => {});
    loginBrowser = null;
  }
  return getSessionStatus();
}

module.exports = {
  PROFILE_DIR,
  getBrowserLaunchOptions,
  assertProfileAvailable,
  getSessionStatus,
  openLoginBrowser,
  closeLoginBrowser,
  isLoginBrowserOpen,
};
