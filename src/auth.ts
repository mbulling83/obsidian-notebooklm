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

        // Extract CSRF + session tokens from the live page HTML
        const html: string = await win.webContents.executeJavaScript(
          "document.documentElement.innerHTML"
        );
        const csrfMatch = html.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
        const sessionMatch = html.match(/"FdrFJe"\s*:\s*"([^"]+)"/);
        if (!csrfMatch || !sessionMatch) return;

        const csrfToken = csrfMatch[1];
        const sessionId = sessionMatch[1];

        win.close();
        finish(() => resolve({ cookieHeader, csrfToken, sessionId, connectedAt: Date.now() }));
      } catch {
        // Not ready — keep window open
      }
    });

    win.on("closed", () => finish(() => reject(new Error("Auth window closed by user"))));
  });
}

/**
 * Fetch CSRF token (SNlM0e) and session ID (FdrFJe) from NotebookLM homepage.
 */
export async function fetchTokens(cookieHeader: string): Promise<{ csrfToken: string; sessionId: string }> {
  const response = await fetch("https://notebooklm.google.com/", {
    headers: { Cookie: cookieHeader },
  });
  const html = await response.text();

  const csrfMatch = html.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
  const sessionMatch = html.match(/"FdrFJe"\s*:\s*"([^"]+)"/);

  if (!csrfMatch) throw new Error("Could not extract CSRF token — try reconnecting");
  if (!sessionMatch) throw new Error("Could not extract session ID — try reconnecting");

  return { csrfToken: csrfMatch[1], sessionId: sessionMatch[1] };
}

export function storedAuthToTokens(stored: StoredAuth): AuthTokens {
  return {
    cookieHeader: stored.cookieHeader,
    csrfToken: stored.csrfToken,
    sessionId: stored.sessionId,
  };
}
