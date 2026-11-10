// The extension manifest per build target, kept apart from the build so tests can check the permissions.
//
// Permissions are deliberately minimal: no standing access to any shop. Pages are read only through activeTab,
// granted by the user's click on the toolbar button; the marketplace icon hint is set by the browser itself through
// declarativeContent (Chromium only), which needs no host access and shows no install warning.

export const API_ORIGIN = "https://unfret.net";
export const UPDATE_URL = `${API_ORIGIN}/extension/updates.xml`;
// "Unfret Dev" is a separate extension (its own key, ID, icon and update channel) that only talks to the dev
// deployment, so testing never touches the production install.
export const DEV_API_ORIGIN = "https://dev.unfret.net";
export const DEV_UPDATE_URL = `${DEV_API_ORIGIN}/extension/updates-dev.xml`;
// A local server: optional, asked for only when chosen in the options (no install warning).
export const LOCAL_PERMISSIONS = ["http://localhost/*", "http://127.0.0.1/*"];

/** The API origin a build talks to. */
export function apiOrigin(browser) {
  return browser === "chrome-dev" ? DEV_API_ORIGIN : API_ORIGIN;
}

const ICONS = {
  16: "icons/icon-16.png",
  32: "icons/icon-32.png",
  48: "icons/icon-48.png",
  128: "icons/icon-128.png",
};

/**
 * @param {"chrome" | "chrome-selfhosted" | "chrome-dev" | "firefox"} browser
 * @param {{ version: string, description: string, publicKey?: string }} options
 */
export function manifest(browser, { version, description, publicKey }) {
  const chromium = browser !== "firefox";
  const api = apiOrigin(browser);
  const name = browser === "chrome-dev" ? "Unfret Dev" : "Unfret";
  const base = {
    manifest_version: 3,
    name,
    version,
    // The extension is in English only: package.json's description, as it is.
    description,
    icons: ICONS,
    action: { default_popup: "popup/popup.html", default_title: name, default_icon: ICONS },
    options_ui: { page: "options/options.html", open_in_tab: true },
    permissions: ["activeTab", "storage", "scripting", ...(chromium ? ["declarativeContent"] : [])],
    // The API is reached through its CORS (it allows extension origins); the only site the extension is ever
    // injected into on its own is the Unfret sign-in page, for the session relay below.
    optional_host_permissions: LOCAL_PERMISSIONS,
    content_scripts: [{ matches: [`${api}/connect*`], js: ["connect-relay.js"], run_at: "document_start" }],
    content_security_policy: {
      // Extension pages may only talk to the Unfret API (or a local dev server).
      extension_pages: `script-src 'self'; object-src 'self'; connect-src ${api} http://localhost:* http://127.0.0.1:*`,
    },
  };
  if (browser === "chrome") {
    return { ...base, background: { service_worker: "background.js" }, minimum_chrome_version: "116" };
  }
  if (browser === "chrome-selfhosted" || browser === "chrome-dev") {
    if (!publicKey) throw new Error(`the ${browser} build needs its public key (release/)`);
    const update_url = browser === "chrome-dev" ? DEV_UPDATE_URL : UPDATE_URL;
    return {
      ...base,
      background: { service_worker: "background.js" },
      minimum_chrome_version: "116",
      key: publicKey,
      update_url,
    };
  }
  return {
    ...base,
    background: { scripts: ["background.js"] },
    browser_specific_settings: {
      gecko: {
        id: "unfret@kroshtan.com",
        strict_min_version: "140.0",
        data_collection_permissions: { required: ["websiteContent", "browsingActivity"] },
      },
      gecko_android: { strict_min_version: "142.0" },
    },
  };
}
