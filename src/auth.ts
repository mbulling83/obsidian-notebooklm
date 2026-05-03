import type { AuthTokens } from "./api/session";

export interface StoredAuth {
  cookieHeader: string;
  csrfToken: string;
  sessionId: string;
  connectedAt: number;
}

function getElectronRemote(): { BrowserWindow: typeof import("electron").BrowserWindow; session: typeof import("electron").session } {
  try { return (window as any).require("@electron/remote"); } catch { /* ignore */ }
  const electron = (window as any).require("electron");
  if (!electron?.remote?.BrowserWindow) throw new Error("Electron remote not available");
  return electron.remote;
}

/**
 * Opens an Electron BrowserWindow for Google OAuth.
 * After login, injects cookies into the default session so requestUrl picks them up
 * automatically — avoids issues with Cookie being dropped from manual headers.
 */
export async function runOAuthFlow(): Promise<StoredAuth> {
  let electronRemote: ReturnType<typeof getElectronRemote>;
  try {
    electronRemote = getElectronRemote();
  } catch (e) {
    throw new Error(`Could not access Electron BrowserWindow. Make sure you are using the desktop app. (${(e as Error).message})`);
  }

  const { BrowserWindow, session: electronSession } = electronRemote;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (!settled) { settled = true; fn(); }
    };

    const win = new BrowserWindow({
      width: 500,
      height: 700,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    win.loadURL("https://notebooklm.google.com/");

    // Fires after each full page load — retries silently until login is complete
    win.webContents.on("did-finish-load", async () => {
      const url = win.webContents.getURL();
      if (!url.startsWith("https://notebooklm.google.com/")) return;

      try {
        // Get cookies from all relevant Google domains
        const [dotCookies, nlmCookies] = await Promise.all([
          win.webContents.session.cookies.get({ domain: ".google.com" }),
          win.webContents.session.cookies.get({ domain: "notebooklm.google.com" }),
        ]);
        const seen = new Set<string>();
        const allCookies = [...dotCookies, ...nlmCookies].filter(
          c => !seen.has(c.name) && seen.add(c.name)
        );

        // Only proceed once a real session cookie exists (user is logged in)
        const hasSid = allCookies.some(c => c.name === "SID" || c.name === "__Secure-1PSID");
        if (!hasSid) return;

        // Inject cookies into the default session so requestUrl uses them automatically
        const defaultSes = electronSession.defaultSession;
        for (const cookie of allCookies) {
          const domain = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
          try {
            await defaultSes.cookies.set({
              url: `https://${domain}`,
              name: cookie.name,
              value: cookie.value,
              domain: cookie.domain,
              path: cookie.path ?? "/",
              secure: cookie.secure ?? true,
              httpOnly: cookie.httpOnly ?? false,
              expirationDate: cookie.expirationDate,
            });
          } catch { /* skip invalid cookies */ }
        }

        // Build cookie header string (kept for fallback / token refresh)
        const cookieHeader = allCookies.map(c => `${c.name}=${c.value}`).join("; ");

        // Extract CSRF + session tokens: try WIZ_global_data first, fall back to HTML scraping
        const tokens = await win.webContents.executeJavaScript(`
          (() => {
            const d = window.WIZ_global_data || {};
            if (d.SNlM0e && d.FdrFJe) return { csrf: d.SNlM0e, sid: d.FdrFJe };
            const h = document.documentElement.innerHTML;
            const m1 = h.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
            const m2 = h.match(/"FdrFJe"\s*:\s*"([^"]+)"/);
            return { csrf: m1 ? m1[1] : null, sid: m2 ? m2[1] : null };
          })()
        `) as { csrf: string | null; sid: string | null };
        if (!tokens.csrf || !tokens.sid) return;

        const csrfToken = tokens.csrf;
        const sessionId = tokens.sid;

        win.close();
        finish(() => resolve({ cookieHeader, csrfToken, sessionId, connectedAt: Date.now() }));
      } catch {
        // Not ready — keep window open
      }
    });

    win.on("closed", () => finish(() => reject(new Error("Auth window closed by user"))));
  });
}


export function storedAuthToTokens(stored: StoredAuth): AuthTokens {
  return {
    cookieHeader: stored.cookieHeader,
    csrfToken: stored.csrfToken,
    sessionId: stored.sessionId,
  };
}
