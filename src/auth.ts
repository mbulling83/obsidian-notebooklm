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
  const { BrowserWindow } = (window as unknown as {
    require: (m: string) => { BrowserWindow: typeof import("electron").BrowserWindow }
  }).require("electron").remote ?? (window as unknown as {
    require: (m: string) => unknown
  }).require("@electron/remote");

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

    win.loadURL("https://accounts.google.com/ServiceLogin?service=notebooklm");

    win.webContents.on("did-navigate", async (_, url) => {
      if (!url.includes("notebooklm.google.com")) return;

      try {
        const allCookies = await win.webContents.session.cookies.get({ domain: ".google.com" });
        const cookieHeader = allCookies.map((c) => `${c.name}=${c.value}`).join("; ");

        // Fetch CSRF token and session ID from NotebookLM homepage
        const { csrfToken, sessionId } = await fetchTokens(cookieHeader);

        win.close();
        finish(() => resolve({ cookieHeader, csrfToken, sessionId, connectedAt: Date.now() }));
      } catch (err) {
        win.close();
        finish(() => reject(err));
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
