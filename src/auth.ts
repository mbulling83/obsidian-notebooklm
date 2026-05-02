import type { AuthTokens } from "./api/session";

export interface StoredAuth {
  cookieHeader: string;
  csrfToken: string;
  sessionId: string;
  connectedAt: number;
}

/**
 * Opens an Electron BrowserWindow for Google OAuth.
 * After the user signs in and lands on notebooklm.google.com,
 * captures session cookies and fetches CSRF/session tokens.
 */
export async function runOAuthFlow(): Promise<StoredAuth> {
  // BrowserWindow is only available in Electron desktop context
  let BrowserWindow: typeof import("electron").BrowserWindow;
  try {
    // Try modern @electron/remote first, then legacy remote
    const electronRemote = (() => {
      try { return (window as any).require("@electron/remote"); } catch { /* ignore */ }
      const electron = (window as any).require("electron");
      return electron.remote;
    })();
    if (!electronRemote?.BrowserWindow) throw new Error("Electron remote not available");
    BrowserWindow = electronRemote.BrowserWindow;
  } catch (e) {
    throw new Error(`Could not access Electron BrowserWindow. Make sure you are using the desktop app. (${(e as Error).message})`);
  }

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

    // did-finish-load fires after each full page load — including after Google redirects
    // back to NotebookLM post-login. We silently retry on every load until it succeeds.
    win.webContents.on("did-finish-load", async () => {
      const url = win.webContents.getURL();
      if (!url.startsWith("https://notebooklm.google.com/")) return;

      try {
        const allCookies = await win.webContents.session.cookies.get({ domain: ".google.com" });
        // Only proceed if a real session cookie is present (user is logged in)
        const hasSid = allCookies.some(c => c.name === "SID" || c.name === "__Secure-1PSID");
        if (!hasSid) return;

        const cookieHeader = allCookies.map((c) => `${c.name}=${c.value}`).join("; ");

        // Extract tokens directly from the loaded page — avoids cross-context fetch issues
        const html: string = await win.webContents.executeJavaScript(
          "document.documentElement.innerHTML"
        );
        const csrfMatch = html.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
        const sessionMatch = html.match(/"FdrFJe"\s*:\s*"([^"]+)"/);
        if (!csrfMatch || !sessionMatch) return; // Page still loading, wait for next load

        const csrfToken = csrfMatch[1];
        const sessionId = sessionMatch[1];

        win.close();
        finish(() => resolve({ cookieHeader, csrfToken, sessionId, connectedAt: Date.now() }));
      } catch {
        // Not ready yet — keep window open for user to complete login
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
