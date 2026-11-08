// The extension manifest per build target, kept apart from the build so tests can check the permissions.
//
// Permissions are deliberately minimal: no standing access to any shop. Pages are read only through activeTab,
// granted by the user's click on the toolbar button; the marketplace icon hint is set by the browser itself through
// declarativeContent (Chromium only), which needs no host access and shows no install warning.

export const API_ORIGIN = "https://veridex.kroshtan.com";
export const UPDATE_URL = `${API_ORIGIN}/extension/updates.xml`;
export const DEV_PERMISSIONS = ["http://localhost/*", "http://127.0.0.1/*"];

const ICONS = {
  16: "icons/icon-16.png",
  32: "icons/icon-32.png",
  48: "icons/icon-48.png",
  128: "icons/icon-128.png",
};

/**
 * @param {"chrome" | "chrome-selfhosted" | "firefox"} browser
 * @param {{ version: string, description: string, publicKey?: string }} options
 */
export function manifest(browser, { version, description, publicKey }) {
  const chromium = browser !== "firefox";
  const base = {
    manifest_version: 3,
    name: "Veridex",
    version,
    // Localised from _locales (nl, en); package.json keeps the English text for npm.
    description: description && "__MSG_ext_description__",
    default_locale: "en",
    icons: ICONS,
    action: { default_popup: "popup/popup.html", default_title: "Veridex", default_icon: ICONS },
    options_ui: { page: "options/options.html", open_in_tab: true },
    permissions: ["activeTab", "storage", "scripting", ...(chromium ? ["declarativeContent"] : [])],
    // The API is reached through its CORS (it allows extension origins); the only site the extension is ever
    // injected into on its own is the Veridex sign-in page, for the session relay below.
    optional_host_permissions: DEV_PERMISSIONS,
    content_scripts: [
      { matches: [`${API_ORIGIN}/connect*`], js: ["connect-relay.js"], run_at: "document_start" },
    ],
    content_security_policy: {
      // Extension pages may only talk to the Veridex API (or a local dev server).
      extension_pages: `script-src 'self'; object-src 'self'; connect-src ${API_ORIGIN} http://localhost:* http://127.0.0.1:*`,
    },
  };
  if (browser === "chrome") {
    return { ...base, background: { service_worker: "background.js" }, minimum_chrome_version: "116" };
  }
  if (browser === "chrome-selfhosted") {
    if (!publicKey) throw new Error("the self-hosted build needs the public key (release/public-key.b64)");
    return { ...manifest("chrome", { version, description }), key: publicKey, update_url: UPDATE_URL };
  }
  return {
    ...base,
    background: { scripts: ["background.js"] },
    browser_specific_settings: {
      gecko: {
        id: "veridex@kroshtan.com",
        strict_min_version: "140.0",
        data_collection_permissions: { required: ["websiteContent", "browsingActivity"] },
      },
      gecko_android: { strict_min_version: "142.0" },
    },
  };
}
