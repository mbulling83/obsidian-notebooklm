import { requestUrl } from "obsidian";
import type { RpcSession } from "./types";
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
    console.log(`[NotebookLM] ${methodId} → HTTP ${response.status}, body[0:200]: ${response.text?.slice(0, 200)}`);
    if (response.status === 401 || response.status === 403) {
      throw new NotebookLMAuthError();
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status} for ${methodId}`);
    }
    return parseRpcResponse(response.text, methodId);
  }
}
