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
        throw new NotebookLMAuthError();
      }
      throw new Error(`HTTP ${response.status} for ${methodId}`);
    }
    const text = await response.text();
    return parseRpcResponse(text, methodId);
  }
}
