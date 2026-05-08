import { requestUrl } from "obsidian";
import type { NlmSource, RpcSession } from "./types";
import {
  buildUrl,
  buildRequestBody,
  encodeRpcRequest,
  parseRpcResponse,
  NotebookLMAuthError,
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
    // Use Obsidian's requestUrl — unlike fetch(), it allows setting the Cookie header
    // (Cookie is a forbidden header in the browser Fetch API and gets silently stripped)
    const response = await requestUrl({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "Cookie": this.auth.cookieHeader,
        "Origin": "https://notebooklm.google.com",
        "Referer": "https://notebooklm.google.com/",
        "X-Same-Domain": "1",
      },
      body,
      throw: false,
    });
    if (response.status === 401 || response.status === 403) {
      throw new NotebookLMAuthError();
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status} for ${methodId}`);
    }
    return parseRpcResponse(response.text, methodId);
  }

  /**
   * Upload a binary file source (e.g. PDF) to a notebook via a 3-step flow:
   * 1. Register the file intent via the o4cbdc RPC → get source ID
   * 2. Start a Google resumable upload session → get upload URL
   * 3. Stream the file bytes to the upload URL
   */
  async uploadFileSource(notebookId: string, filename: string, data: ArrayBuffer): Promise<NlmSource> {
    // Step 1: register file intent
    const registerResult = await this.rpcCall(
      "o4cbdc",
      [[[filename]], notebookId, [2], [1, null, null, null, null, null, null, null, null, null, [1]]],
      `/notebook/${notebookId}`
    );
    const sourceId = extractFirstString(registerResult);
    if (!sourceId) throw new Error("File source registration returned no source ID");

    // Step 2: start resumable upload session
    const startResp = await requestUrl({
      url: "https://notebooklm.google.com/upload/_/?authuser=0",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "x-goog-upload-command": "start",
        "x-goog-upload-header-content-length": String(data.byteLength),
        "x-goog-upload-protocol": "resumable",
        "x-goog-authuser": "0",
        "Cookie": this.auth.cookieHeader,
        "Origin": "https://notebooklm.google.com",
        "Referer": "https://notebooklm.google.com/",
      },
      body: JSON.stringify({ PROJECT_ID: notebookId, SOURCE_NAME: filename, SOURCE_ID: sourceId }),
      throw: false,
    });
    if (startResp.status < 200 || startResp.status >= 300) {
      throw new Error(`Upload session start failed: HTTP ${startResp.status}`);
    }
    const uploadUrl = startResp.headers["x-goog-upload-url"];
    if (!uploadUrl) throw new Error("Server did not return an upload URL");

    // Step 3: upload file bytes
    const uploadResp = await requestUrl({
      url: uploadUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-goog-upload-command": "upload, finalize",
        "x-goog-upload-offset": "0",
        "x-goog-authuser": "0",
        "Cookie": this.auth.cookieHeader,
      },
      body: data,
      throw: false,
    });
    if (uploadResp.status < 200 || uploadResp.status >= 300) {
      throw new Error(`File upload failed: HTTP ${uploadResp.status}`);
    }

    return { id: sourceId, title: filename };
  }
}

function extractFirstString(data: unknown, maxDepth = 20): string | null {
  if (maxDepth <= 0) return null;
  if (typeof data === "string" && data.length > 0) return data;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = extractFirstString(item, maxDepth - 1);
      if (found) return found;
    }
  }
  return null;
}
