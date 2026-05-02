import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpRpcSession } from "../../src/api/session";
import { NotebookLMAuthError } from "../../src/api/client";

import { requestUrl } from "obsidian";
const mockRequestUrl = requestUrl as ReturnType<typeof vi.fn>;

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
    mockRequestUrl.mockResolvedValue({ status: 200, text: raw });
  });

  it("sends Cookie header and at= csrf in body", async () => {
    const session = new HttpRpcSession(makeAuth());
    await session.rpcCall("wXbhsf", [null, 1, null, [2]]);
    const { url, headers, body } = mockRequestUrl.mock.calls[0][0];
    expect(url).toContain("rpcids=wXbhsf");
    expect(url).toContain("f.sid=mysession");
    expect(headers).toMatchObject({ Cookie: "SID=abc; HSID=def" });
    expect(body).toContain("at=mycsrf");
  });

  it("throws NotebookLMAuthError on 401", async () => {
    mockRequestUrl.mockResolvedValue({ status: 401, text: "" });
    const session = new HttpRpcSession(makeAuth());
    await expect(session.rpcCall("wXbhsf", [])).rejects.toThrow(NotebookLMAuthError);
  });

  it("throws NotebookLMAuthError on 403", async () => {
    mockRequestUrl.mockResolvedValue({ status: 403, text: "" });
    const session = new HttpRpcSession(makeAuth());
    await expect(session.rpcCall("wXbhsf", [])).rejects.toThrow(NotebookLMAuthError);
  });

  it("throws on HTTP 500 response", async () => {
    mockRequestUrl.mockResolvedValue({ status: 500, text: "" });
    const session = new HttpRpcSession(makeAuth());
    await expect(session.rpcCall("wXbhsf", [])).rejects.toThrow("HTTP 500");
  });
});
