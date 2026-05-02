# Obsidian NotebookLM Plugin — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a self-contained Obsidian plugin for two-way selective sync between an Obsidian vault and Google NotebookLM.

**Architecture:** TypeScript Obsidian plugin with no Python runtime dependency. Auth via Electron BrowserWindow capturing Google session cookies + CSRF/session tokens fetched from the NotebookLM homepage. NotebookLM API calls implemented as a TypeScript batchexecute RPC client. Sync state tracked in note frontmatter.

**Tech Stack:** TypeScript, esbuild, Obsidian API, Electron (BrowserWindow for OAuth), Vitest for unit tests.

---

## Key RPC Facts (referenced throughout)

- **Endpoint:** `https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute`
- **Method IDs:** `wXbhsf` (list notebooks), `CCqFvf` (create notebook), `rLM1Ne` (get notebook / list sources), `izAoDd` (add source), `hizoJc` (get source fulltext), `tGMBJ` (delete source)
- **Request body:** `f.req=<encoded>&at=<csrf_token>&` (form-encoded)
- **URL params:** `rpcids=<method>&source-path=<path>&f.sid=<session_id>&rt=c`
- **Response:** strip `)]}'\n` prefix, parse outer JSON, inner payload at `[0][2]` is JSON-encoded string
- **CSRF token** (`SNlM0e`) and **session ID** (`FdrFJe`) scraped from NotebookLM homepage HTML

---

## Task 1: Scaffold the plugin project

**Files:**
- Create: `obsidian-plugin/manifest.json`
- Create: `obsidian-plugin/package.json`
- Create: `obsidian-plugin/tsconfig.json`
- Create: `obsidian-plugin/esbuild.config.mjs`
- Create: `obsidian-plugin/vitest.config.ts`
- Create: `obsidian-plugin/src/main.ts`

**Step 1: Create directory**
```bash
mkdir -p obsidian-plugin/src/api obsidian-plugin/src/sync obsidian-plugin/src/ui obsidian-plugin/tests/api obsidian-plugin/tests/sync
```

**Step 2: Create `obsidian-plugin/manifest.json`**
```json
{
  "id": "notebooklm-sync",
  "name": "NotebookLM Sync",
  "version": "0.1.0",
  "minAppVersion": "1.4.0",
  "description": "Two-way selective sync between your vault and Google NotebookLM",
  "author": "notebooklm-py contributors",
  "isDesktopOnly": true
}
```

**Step 3: Create `obsidian-plugin/package.json`**
```json
{
  "name": "obsidian-notebooklm-sync",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "node esbuild.config.mjs production",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "obsidian": "latest"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "esbuild": "^0.20.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

**Step 4: Create `obsidian-plugin/tsconfig.json`**
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES2018",
    "allowSyntheticDefaultImports": true,
    "moduleResolution": "bundler",
    "importHelpers": true,
    "isolatedModules": true,
    "strictNullChecks": true,
    "lib": ["ES2018", "DOM"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "**/*.test.ts"]
}
```

**Step 5: Create `obsidian-plugin/esbuild.config.mjs`**
```js
import esbuild from "esbuild";
const prod = process.argv[2] === "production";
esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  platform: "node",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  outfile: "main.js",
  minify: prod,
}).catch(() => process.exit(1));
```

**Step 6: Create `obsidian-plugin/vitest.config.ts`**
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
  },
});
```

**Step 7: Create minimal `obsidian-plugin/src/main.ts`**
```ts
import { Plugin } from "obsidian";

export default class NotebookLMPlugin extends Plugin {
  async onload() {
    console.log("NotebookLM Sync loaded");
  }
  onunload() {}
}
```

**Step 8: Install dependencies**
```bash
cd obsidian-plugin && npm install
```
Expected: `node_modules/` created, no errors.

**Step 9: Build to verify scaffold works**
```bash
cd obsidian-plugin && npm run build
```
Expected: `main.js` created, no TypeScript errors.

**Step 10: Commit**
```bash
git add obsidian-plugin/
git commit -m "feat(obsidian): scaffold plugin project"
```

---

## Task 2: RPC client — request encoder and response parser

**Files:**
- Create: `obsidian-plugin/src/api/client.ts`
- Create: `obsidian-plugin/tests/api/client.test.ts`

### What it does
Encodes batchexecute requests and parses chunked responses. No network calls in this layer.

**Step 1: Write failing tests**

Create `obsidian-plugin/tests/api/client.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { encodeRpcRequest, buildRequestBody, parseRpcResponse } from "../../src/api/client";

describe("encodeRpcRequest", () => {
  it("wraps method and params in triple-nested array", () => {
    const result = encodeRpcRequest("wXbhsf", [null, 1, null, [2]]);
    expect(result).toEqual([[["wXbhsf", '[null,1,null,[2]]', null, "generic"]]]);
  });
});

describe("buildRequestBody", () => {
  it("builds form-encoded body with f.req and at", () => {
    const req = [[["wXbhsf", '[null,1,null,[2]]', null, "generic"]]];
    const body = buildRequestBody(req, "mycsrf");
    expect(body).toContain("f.req=");
    expect(body).toContain("at=mycsrf");
    expect(body.endsWith("&")).toBe(true);
  });

  it("omits at when no csrf token provided", () => {
    const req = [[["wXbhsf", "[]", null, "generic"]]];
    const body = buildRequestBody(req);
    expect(body).not.toContain("at=");
  });
});

describe("parseRpcResponse", () => {
  it("strips anti-xssi prefix and returns inner payload", () => {
    // Simulate batchexecute response: outer array, inner JSON at [0][2]
    const inner = JSON.stringify([[{ id: "nb1", title: "Test" }]]);
    const chunk = `[["wrb.fr","wXbhsf",${JSON.stringify(inner)},null,null,null,"generic"]]`;
    const raw = `)]}'\n${chunk}\n`;
    const result = parseRpcResponse(raw, "wXbhsf");
    expect(result).toEqual([[{ id: "nb1", title: "Test" }]]);
  });

  it("throws on auth error response", () => {
    const raw = `)]}'\n[["e",401]]\n`;
    expect(() => parseRpcResponse(raw, "wXbhsf")).toThrow("auth");
  });
});
```

**Step 2: Run to verify failure**
```bash
cd obsidian-plugin && npm test
```
Expected: FAIL — `Cannot find module '../../src/api/client'`

**Step 3: Implement `obsidian-plugin/src/api/client.ts`**
```ts
export const BATCHEXECUTE_URL =
  "https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute";

export class NotebookLMAuthError extends Error {
  constructor(message = "NotebookLM session expired — reconnect in settings") {
    super(message);
    this.name = "NotebookLMAuthError";
  }
}

export class NotebookLMRpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotebookLMRpcError";
  }
}

export function encodeRpcRequest(methodId: string, params: unknown[]): unknown[][][] {
  const paramsJson = JSON.stringify(params);
  return [[[methodId, paramsJson, null, "generic"]]];
}

export function buildRequestBody(rpcRequest: unknown[][][], csrfToken?: string): string {
  const fReq = encodeURIComponent(JSON.stringify(rpcRequest));
  let body = `f.req=${fReq}`;
  if (csrfToken) body += `&at=${encodeURIComponent(csrfToken)}`;
  body += "&";
  return body;
}

export function buildUrl(methodId: string, sessionId: string, sourcePath = "/"): string {
  const params = new URLSearchParams({
    rpcids: methodId,
    "source-path": sourcePath,
    "f.sid": sessionId,
    rt: "c",
  });
  return `${BATCHEXECUTE_URL}?${params.toString()}`;
}

export function parseRpcResponse(raw: string, methodId: string): unknown {
  // Strip )]}'\n anti-XSSI prefix
  const stripped = raw.replace(/^\)\]\}'\n/, "");

  let outer: unknown[];
  try {
    outer = JSON.parse(stripped);
  } catch {
    throw new NotebookLMRpcError(`Failed to parse response for ${methodId}`);
  }

  // Check for error envelope: [["e", 401]] or similar
  if (Array.isArray(outer[0]) && outer[0][0] === "e") {
    const code = outer[0][1];
    if (code === 401 || code === 403) throw new NotebookLMAuthError();
    throw new NotebookLMRpcError(`RPC error code ${code} for ${methodId}`);
  }

  // Find wrb.fr entry matching our method ID
  for (const chunk of outer) {
    if (Array.isArray(chunk) && chunk[0] === "wrb.fr" && chunk[1] === methodId) {
      const innerJson = chunk[2];
      if (innerJson === null || innerJson === undefined) return null;
      return JSON.parse(innerJson as string);
    }
  }

  throw new NotebookLMRpcError(`No wrb.fr response found for ${methodId}`);
}
```

**Step 4: Run tests to verify passing**
```bash
cd obsidian-plugin && npm test
```
Expected: PASS — all client tests green.

**Step 5: Commit**
```bash
git add obsidian-plugin/src/api/client.ts obsidian-plugin/tests/api/client.test.ts
git commit -m "feat(obsidian): RPC client encoder and response parser"
```

---

## Task 3: Notebooks API

**Files:**
- Create: `obsidian-plugin/src/api/notebooks.ts`
- Create: `obsidian-plugin/tests/api/notebooks.test.ts`

### Data types
```ts
export interface NlmNotebook {
  id: string;
  title: string;
}
```

**Step 1: Write failing tests**

Create `obsidian-plugin/tests/api/notebooks.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotebooksApi } from "../../src/api/notebooks";
import type { RpcSession } from "../../src/api/types";

const makeSession = (responsePayload: unknown): RpcSession => ({
  rpcCall: vi.fn().mockResolvedValue(responsePayload),
});

describe("NotebooksApi.list", () => {
  it("returns parsed notebooks", async () => {
    // list response: [[nb1, nb2]] where each nb is [null, null, title, id, ...]
    const rawNb = [null, null, "My Notebook", "nb123"];
    const session = makeSession([[rawNb]]);
    const api = new NotebooksApi(session);
    const result = await api.list();
    expect(result).toEqual([{ id: "nb123", title: "My Notebook" }]);
  });

  it("returns empty array when response is empty", async () => {
    const session = makeSession([[]]);
    const api = new NotebooksApi(session);
    expect(await api.list()).toEqual([]);
  });
});

describe("NotebooksApi.create", () => {
  it("calls rpcCall with correct params and returns notebook", async () => {
    const rawNb = [null, null, "New Notebook", "nb456"];
    const session = makeSession(rawNb);
    const api = new NotebooksApi(session);
    const result = await api.create("New Notebook");
    expect(session.rpcCall).toHaveBeenCalledWith(
      "CCqFvf",
      ["New Notebook", null, null, [2], [1]],
      "/"
    );
    expect(result).toEqual({ id: "nb456", title: "New Notebook" });
  });
});
```

**Step 2: Run to verify failure**
```bash
cd obsidian-plugin && npm test
```
Expected: FAIL — cannot find modules.

**Step 3: Create `obsidian-plugin/src/api/types.ts`** (shared interface)
```ts
export interface NlmNotebook {
  id: string;
  title: string;
}

export interface NlmSource {
  id: string;
  title: string;
  sourceType?: number;
}

export interface RpcSession {
  rpcCall(methodId: string, params: unknown[], sourcePath?: string): Promise<unknown>;
}
```

**Step 4: Create `obsidian-plugin/src/api/notebooks.ts`**
```ts
import type { NlmNotebook, RpcSession } from "./types";

function parseNotebook(raw: unknown[]): NlmNotebook {
  return { id: raw[3] as string, title: raw[2] as string };
}

export class NotebooksApi {
  constructor(private session: RpcSession) {}

  async list(): Promise<NlmNotebook[]> {
    const result = await this.session.rpcCall("wXbhsf", [null, 1, null, [2]]) as unknown[][];
    const rows = result?.[0];
    if (!Array.isArray(rows) || rows.length === 0) return [];
    return (rows as unknown[][]).map(parseNotebook);
  }

  async create(title: string): Promise<NlmNotebook> {
    const result = await this.session.rpcCall(
      "CCqFvf",
      [title, null, null, [2], [1]]
    ) as unknown[];
    return parseNotebook(result);
  }
}
```

**Step 5: Run tests to verify passing**
```bash
cd obsidian-plugin && npm test
```
Expected: PASS.

**Step 6: Commit**
```bash
git add obsidian-plugin/src/api/types.ts obsidian-plugin/src/api/notebooks.ts obsidian-plugin/tests/api/notebooks.test.ts
git commit -m "feat(obsidian): notebooks API (list, create)"
```

---

## Task 4: Sources API

**Files:**
- Create: `obsidian-plugin/src/api/sources.ts`
- Create: `obsidian-plugin/tests/api/sources.test.ts`

**Step 1: Write failing tests**

Create `obsidian-plugin/tests/api/sources.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { SourcesApi } from "../../src/api/sources";
import type { RpcSession } from "../../src/api/types";

const makeSession = (payload: unknown): RpcSession => ({
  rpcCall: vi.fn().mockResolvedValue(payload),
});

describe("SourcesApi.list", () => {
  it("returns sources from GET_NOTEBOOK response", async () => {
    // GET_NOTEBOOK response: [[nb_info]] where nb_info[1] = sources array
    // each source: [[src_id], title, ...]
    const rawSrc = [["src1"], "My Source", [null, null, null, null, 4]];
    const session = makeSession([[null, [rawSrc]]]);
    const api = new SourcesApi(session);
    const result = await api.list("nb1");
    expect(result).toEqual([{ id: "src1", title: "My Source", sourceType: 4 }]);
  });

  it("returns empty array when no sources", async () => {
    const session = makeSession([[null, []]]);
    const api = new SourcesApi(session);
    expect(await api.list("nb1")).toEqual([]);
  });
});

describe("SourcesApi.addText", () => {
  it("calls with correct params", async () => {
    const rawSrc = [["src2"], "My Note", [null, null, null, null, 4]];
    const session = makeSession(rawSrc);
    const api = new SourcesApi(session);
    await api.addText("nb1", "My Note", "Hello content");
    expect(session.rpcCall).toHaveBeenCalledWith(
      "izAoDd",
      [[[null, ["My Note", "Hello content"], null, null, null, null, null, null]], "nb1", [2], null, null],
      "/notebook/nb1"
    );
  });
});

describe("SourcesApi.getFulltext", () => {
  it("returns text content from response", async () => {
    // Response: [[source_id, title, [null, null, null, null, type, ...]], ..., content_at_index_1]
    const session = makeSession([["src1", "My Note", [null,null,null,null,4]], "Hello full content"]);
    const api = new SourcesApi(session);
    const result = await api.getFulltext("nb1", "src1");
    expect(result.content).toBe("Hello full content");
    expect(result.title).toBe("My Note");
  });
});

describe("SourcesApi.delete", () => {
  it("calls with correct params", async () => {
    const session = makeSession(null);
    const api = new SourcesApi(session);
    await api.delete("nb1", "src1");
    expect(session.rpcCall).toHaveBeenCalledWith(
      "tGMBJ",
      [[["src1"]]],
      "/notebook/nb1"
    );
  });
});
```

**Step 2: Run to verify failure**
```bash
cd obsidian-plugin && npm test
```
Expected: FAIL.

**Step 3: Create `obsidian-plugin/src/api/sources.ts`**
```ts
import type { NlmSource, RpcSession } from "./types";

export interface SourceFulltext {
  title: string;
  content: string;
  sourceType?: number;
}

export class SourcesApi {
  constructor(private session: RpcSession) {}

  async list(notebookId: string): Promise<NlmSource[]> {
    const result = await this.session.rpcCall(
      "rLM1Ne",
      [notebookId, null, [2], null, 0],
      `/notebook/${notebookId}`
    ) as unknown[][];
    const nbInfo = result?.[0] as unknown[];
    const sourcesRaw = nbInfo?.[1] as unknown[][];
    if (!Array.isArray(sourcesRaw)) return [];
    return sourcesRaw.map((s) => {
      const idArr = s[0] as string[];
      return {
        id: idArr[0],
        title: s[1] as string,
        sourceType: (s[2] as unknown[])?.[4] as number | undefined,
      };
    });
  }

  async addText(notebookId: string, title: string, content: string): Promise<NlmSource> {
    const result = await this.session.rpcCall(
      "izAoDd",
      [[[null, [title, content], null, null, null, null, null, null]], notebookId, [2], null, null],
      `/notebook/${notebookId}`
    ) as unknown[];
    const idArr = result[0] as string[];
    return { id: idArr[0], title: result[1] as string };
  }

  async getFulltext(notebookId: string, sourceId: string): Promise<SourceFulltext> {
    const result = await this.session.rpcCall(
      "hizoJc",
      [[sourceId], [2], [2]],
      `/notebook/${notebookId}`
    ) as unknown[];
    const title = (result[0] as unknown[])?.[1] as string ?? "";
    const sourceType = ((result[0] as unknown[])?.[2] as unknown[])?.[4] as number | undefined;
    const content = result[1] as string ?? "";
    return { title, content, sourceType };
  }

  async delete(notebookId: string, sourceId: string): Promise<void> {
    await this.session.rpcCall(
      "tGMBJ",
      [[[sourceId]]],
      `/notebook/${notebookId}`
    );
  }
}
```

**Step 4: Run tests to verify passing**
```bash
cd obsidian-plugin && npm test
```
Expected: PASS.

**Step 5: Commit**
```bash
git add obsidian-plugin/src/api/sources.ts obsidian-plugin/tests/api/sources.test.ts
git commit -m "feat(obsidian): sources API (list, addText, getFulltext, delete)"
```

---

## Task 5: HTTP RPC session (wires auth into API calls)

**Files:**
- Create: `obsidian-plugin/src/api/session.ts`
- Create: `obsidian-plugin/tests/api/session.test.ts`

### What it does
Implements `RpcSession` with real `fetch` calls. Takes stored auth (cookies, csrfToken, sessionId) and makes authenticated batchexecute requests.

**Step 1: Write failing tests**

Create `obsidian-plugin/tests/api/session.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpRpcSession } from "../../src/api/session";

const makeAuth = () => ({
  cookieHeader: "SID=abc; HSID=def",
  csrfToken: "mycsrf",
  sessionId: "mysession",
});

describe("HttpRpcSession.rpcCall", () => {
  beforeEach(() => {
    const inner = JSON.stringify([["result"]]);
    const chunk = `[["wrb.fr","wXbhsf",${JSON.stringify(inner)},null,null,null,"generic"]]`;
    const raw = `)]}'\n${chunk}\n`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => raw,
    }));
  });

  it("sends Cookie header and at= csrf in body", async () => {
    const session = new HttpRpcSession(makeAuth());
    await session.rpcCall("wXbhsf", [null, 1, null, [2]]);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("rpcids=wXbhsf");
    expect(url).toContain("f.sid=mysession");
    expect((init as RequestInit).headers as Record<string,string>)
      .toMatchObject({ Cookie: "SID=abc; HSID=def" });
    expect((init as RequestInit).body as string).toContain("at=mycsrf");
  });
});
```

**Step 2: Run to verify failure**
```bash
cd obsidian-plugin && npm test
```
Expected: FAIL.

**Step 3: Create `obsidian-plugin/src/api/session.ts`**
```ts
import type { RpcSession } from "./types";
import {
  buildUrl,
  buildRequestBody,
  encodeRpcRequest,
  parseRpcResponse,
} from "./client";

export interface AuthTokens {
  cookieHeader: string;
  csrfToken: string;
  sessionId: string;
}

export class HttpRpcSession implements RpcSession {
  constructor(private auth: AuthTokens) {}

  async rpcCall(methodId: string, params: unknown[], sourcePath = "/"): Promise<unknown> {
    const url = buildUrl(methodId, this.auth.sessionId, sourcePath);
    const body = buildRequestBody(encodeRpcRequest(methodId, params), this.auth.csrfToken);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Cookie: this.auth.cookieHeader,
      },
      body,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("NotebookLMAuthError");
      }
      throw new Error(`HTTP ${response.status} for ${methodId}`);
    }
    const text = await response.text();
    return parseRpcResponse(text, methodId);
  }
}
```

**Step 4: Run tests**
```bash
cd obsidian-plugin && npm test
```
Expected: PASS.

**Step 5: Commit**
```bash
git add obsidian-plugin/src/api/session.ts obsidian-plugin/tests/api/session.test.ts
git commit -m "feat(obsidian): HTTP RPC session with auth headers"
```

---

## Task 6: Auth module — OAuth flow and token storage

**Files:**
- Create: `obsidian-plugin/src/auth.ts`

> No unit tests for this module — it depends entirely on Electron `BrowserWindow` and DOM, which are too tightly coupled to mock usefully. Tested manually.

**Create `obsidian-plugin/src/auth.ts`**

```ts
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
  const { BrowserWindow, session: electronSession } = (window as unknown as {
    require: (m: string) => { BrowserWindow: typeof import("electron").BrowserWindow; session: typeof import("electron").session }
  }).require("electron").remote ?? (window as unknown as {
    require: (m: string) => unknown
  }).require("@electron/remote");

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 500,
      height: 700,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    win.loadURL("https://accounts.google.com/ServiceLogin?service=notebooklm");

    win.webContents.on("did-navigate", async (_, url) => {
      if (!url.includes("notebooklm.google.com")) return;

      try {
        const ses = electronSession.fromPartition("persist:notebooklm") ?? win.webContents.session;
        const allCookies = await ses.cookies.get({ domain: ".google.com" });
        const cookieHeader = allCookies.map((c) => `${c.name}=${c.value}`).join("; ");

        // Fetch CSRF token and session ID from NotebookLM homepage
        const { csrfToken, sessionId } = await fetchTokens(cookieHeader);

        win.close();
        resolve({ cookieHeader, csrfToken, sessionId, connectedAt: Date.now() });
      } catch (err) {
        win.close();
        reject(err);
      }
    });

    win.on("closed", () => reject(new Error("Auth window closed by user")));
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
```

**Commit:**
```bash
git add obsidian-plugin/src/auth.ts
git commit -m "feat(obsidian): OAuth flow and CSRF/session token extraction"
```

---

## Task 7: Sync logic — push

**Files:**
- Create: `obsidian-plugin/src/sync/push.ts`
- Create: `obsidian-plugin/tests/sync/push.test.ts`

### Frontmatter schema
```
notebooklm_source_id: <source_id>
notebooklm_notebook_id: <notebook_id>
notebooklm_synced_hash: <sha256_hex_of_content_at_sync>
```

**Step 1: Write failing tests**

Create `obsidian-plugin/tests/sync/push.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { computeHash, stripFrontmatter, buildSyncFrontmatter } from "../../src/sync/push";

describe("computeHash", () => {
  it("returns consistent hex string for same input", async () => {
    const h1 = await computeHash("hello");
    const h2 = await computeHash("hello");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns different hash for different input", async () => {
    const h1 = await computeHash("hello");
    const h2 = await computeHash("world");
    expect(h1).not.toBe(h2);
  });
});

describe("stripFrontmatter", () => {
  it("removes notebooklm_ frontmatter fields for hashing", () => {
    const content = `---
title: My Note
notebooklm_source_id: abc
notebooklm_notebook_id: xyz
notebooklm_synced_hash: def
---
# Hello`;
    const stripped = stripFrontmatter(content);
    expect(stripped).not.toContain("notebooklm_");
    expect(stripped).toContain("# Hello");
    expect(stripped).toContain("title: My Note");
  });

  it("returns content unchanged if no frontmatter", () => {
    const content = "# Hello\nWorld";
    expect(stripFrontmatter(content)).toBe(content);
  });
});

describe("buildSyncFrontmatter", () => {
  it("injects notebooklm fields into existing frontmatter", () => {
    const content = `---
title: My Note
---
# Body`;
    const result = buildSyncFrontmatter(content, "src1", "nb1", "hash1");
    expect(result).toContain("notebooklm_source_id: src1");
    expect(result).toContain("notebooklm_notebook_id: nb1");
    expect(result).toContain("notebooklm_synced_hash: hash1");
    expect(result).toContain("title: My Note");
  });

  it("creates frontmatter block if none exists", () => {
    const content = "# Hello";
    const result = buildSyncFrontmatter(content, "src1", "nb1", "hash1");
    expect(result).toMatch(/^---\n/);
    expect(result).toContain("notebooklm_source_id: src1");
  });
});
```

**Step 2: Run to verify failure**
```bash
cd obsidian-plugin && npm test
```
Expected: FAIL.

**Step 3: Create `obsidian-plugin/src/sync/push.ts`**
```ts
export interface SyncMeta {
  sourceId?: string;
  notebookId?: string;
  syncedHash?: string;
}

export async function computeHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const NLM_FIELDS = /^notebooklm_(source_id|notebook_id|synced_hash):.+\n?/gm;

export function stripFrontmatter(content: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return content;
  const cleaned = fmMatch[1].replace(NLM_FIELDS, "").trim();
  const body = fmMatch[2];
  return cleaned ? `---\n${cleaned}\n---\n${body}` : body;
}

export function parseSyncMeta(content: string): SyncMeta {
  const sourceId = content.match(/^notebooklm_source_id:\s*(.+)$/m)?.[1]?.trim();
  const notebookId = content.match(/^notebooklm_notebook_id:\s*(.+)$/m)?.[1]?.trim();
  const syncedHash = content.match(/^notebooklm_synced_hash:\s*(.+)$/m)?.[1]?.trim();
  return { sourceId, notebookId, syncedHash };
}

export function buildSyncFrontmatter(
  content: string,
  sourceId: string,
  notebookId: string,
  hash: string
): string {
  const nlmFields = `notebooklm_source_id: ${sourceId}\nnotebooklm_notebook_id: ${notebookId}\nnotebooklm_synced_hash: ${hash}`;
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!fmMatch) {
    return `---\n${nlmFields}\n---\n${content}`;
  }

  // Remove existing notebooklm fields then append updated ones
  const existing = fmMatch[1].replace(NLM_FIELDS, "").trim();
  const body = fmMatch[2];
  const fm = existing ? `${existing}\n${nlmFields}` : nlmFields;
  return `---\n${fm}\n---\n${body}`;
}
```

**Step 4: Run tests**
```bash
cd obsidian-plugin && npm test
```
Expected: PASS.

**Step 5: Commit**
```bash
git add obsidian-plugin/src/sync/push.ts obsidian-plugin/tests/sync/push.test.ts
git commit -m "feat(obsidian): push sync utilities (hash, frontmatter)"
```

---

## Task 8: Sync logic — pull (conflict detection)

**Files:**
- Create: `obsidian-plugin/src/sync/pull.ts`
- Create: `obsidian-plugin/tests/sync/pull.test.ts`

**Step 1: Write failing tests**

Create `obsidian-plugin/tests/sync/pull.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { detectConflict, conflictFileName } from "../../src/sync/pull";

describe("detectConflict", () => {
  it("returns none when hashes match (unmodified locally)", () => {
    expect(detectConflict("abc", "abc")).toBe("none");
  });

  it("returns conflict when hashes differ (modified locally)", () => {
    expect(detectConflict("abc", "xyz")).toBe("conflict");
  });

  it("returns none when no stored hash (new note)", () => {
    expect(detectConflict(undefined, "xyz")).toBe("none");
  });
});

describe("conflictFileName", () => {
  it("generates dated conflict filename", () => {
    const result = conflictFileName("My Note.md", "2026-05-02");
    expect(result).toBe("My Note (NotebookLM 2026-05-02).md");
  });

  it("handles filename without extension", () => {
    const result = conflictFileName("My Note", "2026-05-02");
    expect(result).toBe("My Note (NotebookLM 2026-05-02)");
  });
});
```

**Step 2: Run to verify failure**
```bash
cd obsidian-plugin && npm test
```
Expected: FAIL.

**Step 3: Create `obsidian-plugin/src/sync/pull.ts`**
```ts
export type ConflictResult = "none" | "conflict";

export function detectConflict(storedHash: string | undefined, currentHash: string): ConflictResult {
  if (!storedHash) return "none";
  return storedHash === currentHash ? "none" : "conflict";
}

export function conflictFileName(originalName: string, date: string): string {
  const dotIdx = originalName.lastIndexOf(".");
  if (dotIdx === -1) return `${originalName} (NotebookLM ${date})`;
  const base = originalName.slice(0, dotIdx);
  const ext = originalName.slice(dotIdx);
  return `${base} (NotebookLM ${date})${ext}`;
}

export function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}
```

**Step 4: Run tests**
```bash
cd obsidian-plugin && npm test
```
Expected: PASS.

**Step 5: Commit**
```bash
git add obsidian-plugin/src/sync/pull.ts obsidian-plugin/tests/sync/pull.test.ts
git commit -m "feat(obsidian): pull sync utilities (conflict detection)"
```

---

## Task 9: Settings tab UI

**Files:**
- Create: `obsidian-plugin/src/ui/SettingsTab.ts`

> UI classes are tightly coupled to Obsidian's DOM APIs. No unit tests — covered by manual testing.

**Create `obsidian-plugin/src/ui/SettingsTab.ts`**
```ts
import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type NotebookLMPlugin from "../main";
import { runOAuthFlow } from "../auth";

export class NotebookLMSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: NotebookLMPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "NotebookLM Sync" });

    const auth = this.plugin.settings.auth;

    new Setting(containerEl)
      .setName("Google account")
      .setDesc(auth ? `Connected (${new Date(auth.connectedAt).toLocaleDateString()})` : "Not connected")
      .addButton((btn) => {
        btn.setButtonText(auth ? "Disconnect" : "Connect Google Account")
          .setCta()
          .onClick(async () => {
            if (auth) {
              this.plugin.settings.auth = null;
              await this.plugin.saveSettings();
              this.display();
            } else {
              try {
                this.plugin.settings.auth = await runOAuthFlow();
                await this.plugin.saveSettings();
                new Notice("Connected to NotebookLM");
                this.display();
              } catch (e) {
                new Notice(`Connection failed: ${(e as Error).message}`);
              }
            }
          });
      });

    new Setting(containerEl)
      .setName("Pull folder")
      .setDesc("Vault folder where pulled sources are saved")
      .addText((text) =>
        text
          .setPlaceholder("NotebookLM")
          .setValue(this.plugin.settings.pullFolder)
          .onChange(async (value) => {
            this.plugin.settings.pullFolder = value || "NotebookLM";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Clear sync metadata")
      .setDesc("Remove notebooklm_ frontmatter from all notes in the vault")
      .addButton((btn) =>
        btn.setButtonText("Clear all").setWarning().onClick(async () => {
          await this.plugin.clearAllSyncMetadata();
          new Notice("Sync metadata cleared from all notes");
        })
      );
  }
}
```

**Commit:**
```bash
git add obsidian-plugin/src/ui/SettingsTab.ts
git commit -m "feat(obsidian): settings tab UI"
```

---

## Task 10: SyncModal (push UI)

**Files:**
- Create: `obsidian-plugin/src/ui/SyncModal.ts`

**Create `obsidian-plugin/src/ui/SyncModal.ts`**
```ts
import { App, Modal, Setting, TFile, Notice, FuzzySuggestModal } from "obsidian";
import type NotebookLMPlugin from "../main";
import type { NlmNotebook } from "../api/types";
import { computeHash, stripFrontmatter, buildSyncFrontmatter, parseSyncMeta } from "../sync/push";

export class SyncModal extends Modal {
  private selectedFiles: TFile[] = [];
  private folderMode = false;
  private selectedFolder = "";
  private targetNotebook: NlmNotebook | null = null;
  private notebooks: NlmNotebook[] = [];

  constructor(app: App, private plugin: NotebookLMPlugin) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Push to NotebookLM" });

    this.notebooks = await this.plugin.getNotebooks();

    // Notebook picker
    new Setting(contentEl).setName("Target notebook").addDropdown((dd) => {
      dd.addOption("", "Select notebook…");
      this.notebooks.forEach((nb) => dd.addOption(nb.id, nb.title));
      dd.addOption("__new__", "+ Create new notebook…");
      dd.onChange((val) => {
        if (val === "__new__") this.promptNewNotebook();
        else this.targetNotebook = this.notebooks.find((n) => n.id === val) ?? null;
      });
    });

    // Folder vs file toggle
    new Setting(contentEl)
      .setName("Sync mode")
      .addToggle((toggle) => {
        toggle.setValue(this.folderMode).onChange((v) => {
          this.folderMode = v;
          this.renderFileSelector(contentEl);
        });
      })
      .setDesc(this.folderMode ? "Sync entire folder" : "Select individual files");

    this.renderFileSelector(contentEl);

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Push →").setCta().onClick(() => this.doPush())
    );
  }

  private renderFileSelector(containerEl: HTMLElement) {
    const existing = containerEl.querySelector(".nlm-file-selector");
    existing?.remove();
    const wrapper = containerEl.createDiv("nlm-file-selector");

    if (this.folderMode) {
      new Setting(wrapper).setName("Folder").addText((t) =>
        t.setPlaceholder("e.g. Research/").onChange((v) => (this.selectedFolder = v))
      );
    } else {
      const files = this.app.vault.getMarkdownFiles();
      files.forEach((file) => {
        new Setting(wrapper).setName(file.path).addToggle((toggle) =>
          toggle.onChange((v) => {
            if (v) this.selectedFiles.push(file);
            else this.selectedFiles = this.selectedFiles.filter((f) => f !== file);
          })
        );
      });
    }
  }

  private async promptNewNotebook() {
    const title = await new Promise<string | null>((resolve) => {
      // Simple prompt using a modal
      const m = new Modal(this.app);
      m.contentEl.createEl("h3", { text: "New notebook name" });
      let value = "";
      new Setting(m.contentEl).addText((t) => t.onChange((v) => (value = v)));
      new Setting(m.contentEl)
        .addButton((b) => b.setButtonText("Create").setCta().onClick(() => { m.close(); resolve(value || null); }))
        .addButton((b) => b.setButtonText("Cancel").onClick(() => { m.close(); resolve(null); }));
      m.open();
    });
    if (title) {
      this.targetNotebook = await this.plugin.createNotebook(title);
      new Notice(`Created notebook: ${title}`);
    }
  }

  private async doPush() {
    if (!this.targetNotebook) { new Notice("Select a target notebook first"); return; }

    const files = this.folderMode
      ? this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(this.selectedFolder))
      : this.selectedFiles;

    if (files.length === 0) { new Notice("No files selected"); return; }

    this.close();
    new Notice(`Pushing ${files.length} note(s)…`);
    let pushed = 0;

    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        const meta = parseSyncMeta(content);
        const contentForHash = stripFrontmatter(content);
        const hash = await computeHash(contentForHash);

        let sourceId = meta.sourceId;

        if (sourceId) {
          // Re-push: delete old source first
          await this.plugin.deleteSource(this.targetNotebook!.id, sourceId);
        }

        const source = await this.plugin.addTextSource(
          this.targetNotebook!.id,
          file.basename,
          contentForHash
        );
        sourceId = source.id;

        const updated = buildSyncFrontmatter(content, sourceId, this.targetNotebook!.id, hash);
        await this.app.vault.modify(file, updated);
        pushed++;
      } catch (e) {
        new Notice(`Failed to push ${file.name}: ${(e as Error).message}`);
      }
    }

    new Notice(`Pushed ${pushed}/${files.length} note(s) to NotebookLM`);
  }

  onClose() {
    this.contentEl.empty();
  }
}
```

**Commit:**
```bash
git add obsidian-plugin/src/ui/SyncModal.ts
git commit -m "feat(obsidian): push SyncModal UI"
```

---

## Task 11: PullModal (pull UI)

**Files:**
- Create: `obsidian-plugin/src/ui/PullModal.ts`

**Create `obsidian-plugin/src/ui/PullModal.ts`**
```ts
import { App, Modal, Setting, Notice, TFile } from "obsidian";
import type NotebookLMPlugin from "../main";
import type { NlmNotebook, NlmSource } from "../api/types";
import { computeHash, buildSyncFrontmatter, parseSyncMeta } from "../sync/push";
import { detectConflict, conflictFileName, todayString } from "../sync/pull";

export class PullModal extends Modal {
  private notebook: NlmNotebook | null = null;
  private sources: NlmSource[] = [];
  private selected: Set<string> = new Set();

  constructor(app: App, private plugin: NotebookLMPlugin) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Pull from NotebookLM" });

    const notebooks = await this.plugin.getNotebooks();

    new Setting(contentEl).setName("Notebook").addDropdown(async (dd) => {
      dd.addOption("", "Select notebook…");
      notebooks.forEach((nb) => dd.addOption(nb.id, nb.title));
      dd.onChange(async (val) => {
        this.notebook = notebooks.find((n) => n.id === val) ?? null;
        if (this.notebook) await this.loadSources(contentEl);
      });
    });
  }

  private async loadSources(containerEl: HTMLElement) {
    containerEl.querySelector(".nlm-sources")?.remove();
    if (!this.notebook) return;

    this.sources = await this.plugin.listSources(this.notebook.id);
    const allNotes = this.app.vault.getMarkdownFiles();
    const trackedIds = new Map<string, TFile>();
    for (const note of allNotes) {
      const content = await this.app.vault.read(note);
      const { sourceId } = parseSyncMeta(content);
      if (sourceId) trackedIds.set(sourceId, note);
    }

    const wrapper = containerEl.createDiv("nlm-sources");
    wrapper.createEl("h3", { text: `${this.sources.length} sources` });

    this.sources.forEach((src) => {
      const isTracked = trackedIds.has(src.id);
      new Setting(wrapper)
        .setName(src.title)
        .setDesc(isTracked ? "↺ from vault" : "NEW")
        .addToggle((toggle) =>
          toggle.onChange((v) => {
            if (v) this.selected.add(src.id);
            else this.selected.delete(src.id);
          })
        );
    });

    new Setting(wrapper).addButton((btn) =>
      btn.setButtonText(`← Pull selected`).setCta().onClick(() => this.doPull(trackedIds))
    );
  }

  private async doPull(trackedIds: Map<string, TFile>) {
    if (!this.notebook || this.selected.size === 0) {
      new Notice("Select at least one source");
      return;
    }
    this.close();
    new Notice(`Pulling ${this.selected.size} source(s)…`);
    let pulled = 0;

    for (const src of this.sources.filter((s) => this.selected.has(s.id))) {
      try {
        const fulltext = await this.plugin.getSourceFulltext(this.notebook!.id, src.id);
        const hash = await computeHash(fulltext.content);
        const existingNote = trackedIds.get(src.id);

        if (existingNote) {
          const existingContent = await this.app.vault.read(existingNote);
          const { syncedHash } = parseSyncMeta(existingContent);
          const currentHash = await computeHash(stripFrontmatterForHash(existingContent));
          const conflict = detectConflict(syncedHash, currentHash);

          if (conflict === "conflict") {
            // Keep both: write NotebookLM version as a new file alongside
            const conflictName = conflictFileName(existingNote.name, todayString());
            const conflictPath = existingNote.parent
              ? `${existingNote.parent.path}/${conflictName}`
              : conflictName;
            const newContent = buildSyncFrontmatter(
              fulltext.content,
              src.id,
              this.notebook!.id,
              hash
            );
            await this.app.vault.create(conflictPath, newContent);
          } else {
            // No conflict — update in place
            const updated = buildSyncFrontmatter(
              fulltext.content,
              src.id,
              this.notebook!.id,
              hash
            );
            await this.app.vault.modify(existingNote, updated);
          }
        } else {
          // New source — create in NotebookLM/<notebook>/<title>.md
          const folder = `${this.plugin.settings.pullFolder}/${this.notebook!.title}`;
          await this.ensureFolder(folder);
          const path = `${folder}/${sanitizeFilename(src.title)}.md`;
          const newContent = buildSyncFrontmatter(
            fulltext.content,
            src.id,
            this.notebook!.id,
            hash
          );
          await this.app.vault.create(path, newContent);
        }
        pulled++;
      } catch (e) {
        new Notice(`Failed to pull ${src.title}: ${(e as Error).message}`);
      }
    }

    new Notice(`Pulled ${pulled}/${this.selected.size} source(s)`);
  }

  private async ensureFolder(path: string) {
    const parts = path.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "-").trim();
}

function stripFrontmatterForHash(content: string): string {
  const { stripFrontmatter } = require("../sync/push");
  return stripFrontmatter(content);
}
```

**Commit:**
```bash
git add obsidian-plugin/src/ui/PullModal.ts
git commit -m "feat(obsidian): pull PullModal UI"
```

---

## Task 12: Wire everything together in main.ts

**Files:**
- Modify: `obsidian-plugin/src/main.ts`

**Step 1: Replace `obsidian-plugin/src/main.ts` with full implementation**
```ts
import { Plugin, Notice, TFile } from "obsidian";
import type { StoredAuth } from "./auth";
import { storedAuthToTokens } from "./auth";
import { HttpRpcSession } from "./api/session";
import { NotebooksApi } from "./api/notebooks";
import { SourcesApi } from "./api/sources";
import type { NlmNotebook, NlmSource } from "./api/types";
import type { SourceFulltext } from "./api/sources";
import { NotebookLMSettingsTab } from "./ui/SettingsTab";
import { SyncModal } from "./ui/SyncModal";
import { PullModal } from "./ui/PullModal";
import { parseSyncMeta } from "./sync/push";
import { NotebookLMAuthError } from "./api/client";

export interface NotebookLMSettings {
  auth: StoredAuth | null;
  pullFolder: string;
}

const DEFAULT_SETTINGS: NotebookLMSettings = {
  auth: null,
  pullFolder: "NotebookLM",
};

export default class NotebookLMPlugin extends Plugin {
  settings!: NotebookLMSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new NotebookLMSettingsTab(this.app, this));

    this.addRibbonIcon("book-open", "NotebookLM Sync", () => {
      if (!this.settings.auth) {
        new Notice("Connect your Google account in NotebookLM Sync settings first");
        return;
      }
      new SyncModal(this.app, this).open();
    });

    this.addCommand({
      id: "push-to-notebooklm",
      name: "Push notes to NotebookLM",
      callback: () => {
        if (!this.requireAuth()) return;
        new SyncModal(this.app, this).open();
      },
    });

    this.addCommand({
      id: "pull-from-notebooklm",
      name: "Pull from NotebookLM",
      callback: () => {
        if (!this.requireAuth()) return;
        new PullModal(this.app, this).open();
      },
    });
  }

  onunload() {}

  private requireAuth(): boolean {
    if (!this.settings.auth) {
      new Notice("Connect your Google account in NotebookLM Sync settings first");
      return false;
    }
    return true;
  }

  private getSession(): HttpRpcSession {
    if (!this.settings.auth) throw new Error("Not authenticated");
    return new HttpRpcSession(storedAuthToTokens(this.settings.auth));
  }

  private async withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof NotebookLMAuthError) {
        new Notice("Session expired — reconnect in settings");
        this.settings.auth = null;
        await this.saveSettings();
      }
      throw e;
    }
  }

  async getNotebooks(): Promise<NlmNotebook[]> {
    return this.withAuthRetry(() => new NotebooksApi(this.getSession()).list());
  }

  async createNotebook(title: string): Promise<NlmNotebook> {
    return this.withAuthRetry(() => new NotebooksApi(this.getSession()).create(title));
  }

  async listSources(notebookId: string): Promise<NlmSource[]> {
    return this.withAuthRetry(() => new SourcesApi(this.getSession()).list(notebookId));
  }

  async addTextSource(notebookId: string, title: string, content: string): Promise<NlmSource> {
    return this.withAuthRetry(() =>
      new SourcesApi(this.getSession()).addText(notebookId, title, content)
    );
  }

  async getSourceFulltext(notebookId: string, sourceId: string): Promise<SourceFulltext> {
    return this.withAuthRetry(() =>
      new SourcesApi(this.getSession()).getFulltext(notebookId, sourceId)
    );
  }

  async deleteSource(notebookId: string, sourceId: string): Promise<void> {
    return this.withAuthRetry(() =>
      new SourcesApi(this.getSession()).delete(notebookId, sourceId)
    );
  }

  async clearAllSyncMetadata() {
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const content = await this.app.vault.read(file);
      const { sourceId } = parseSyncMeta(content);
      if (sourceId) {
        const { buildSyncFrontmatter, stripFrontmatter } = await import("./sync/push");
        // Remove notebooklm fields by stripping and re-writing without them
        const stripped = stripFrontmatter(content);
        await this.app.vault.modify(file, stripped);
      }
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
```

**Step 2: Build to verify no TypeScript errors**
```bash
cd obsidian-plugin && npm run build
```
Expected: `main.js` created, no errors.

**Step 3: Run all tests**
```bash
cd obsidian-plugin && npm test
```
Expected: All tests pass.

**Step 4: Commit**
```bash
git add obsidian-plugin/src/main.ts
git commit -m "feat(obsidian): wire plugin entry point with all commands and APIs"
```

---

## Task 13: Fix import in PullModal and final build check

**Files:**
- Modify: `obsidian-plugin/src/ui/PullModal.ts` — replace dynamic `require` with static import

**Step 1:** Replace the `stripFrontmatterForHash` helper at the bottom of `PullModal.ts` with a static import.

Add to top of file:
```ts
import { stripFrontmatter } from "../sync/push";
```

Replace the `stripFrontmatterForHash` function and its usages:
```ts
// Remove the function entirely, use stripFrontmatter directly
const currentHash = await computeHash(stripFrontmatter(existingContent));
```

**Step 2: Final build and test**
```bash
cd obsidian-plugin && npm run build && npm test
```
Expected: clean build, all tests passing.

**Step 3: Final commit**
```bash
git add obsidian-plugin/src/ui/PullModal.ts
git commit -m "fix(obsidian): use static import for stripFrontmatter in PullModal"
```

---

## Completion checklist

- [ ] Scaffold builds with `npm run build`
- [ ] All unit tests pass with `npm test`
- [ ] Plugin can be loaded in Obsidian (copy `main.js` + `manifest.json` to vault `.obsidian/plugins/notebooklm-sync/`)
- [ ] Connect Google Account flow opens browser window
- [ ] Push modal lists vault notes and pushes to NotebookLM
- [ ] Pull modal lists sources and creates notes under `NotebookLM/<notebook>/`
- [ ] Conflict creates a `(NotebookLM YYYY-MM-DD)` copy
- [ ] Session expiry shows reconnect notice
