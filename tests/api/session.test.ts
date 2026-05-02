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

  it("throws on HTTP 401 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    }));
    const session = new HttpRpcSession(makeAuth());
    await expect(session.rpcCall("wXbhsf", [])).rejects.toThrow();
  });

  it("throws on HTTP 500 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }));
    const session = new HttpRpcSession(makeAuth());
    await expect(session.rpcCall("wXbhsf", [])).rejects.toThrow("HTTP 500");
  });
});
