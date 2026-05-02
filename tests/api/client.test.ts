import { describe, it, expect } from "vitest";
import { encodeRpcRequest, buildRequestBody, buildUrl, parseRpcResponse } from "../../src/api/client";

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

describe("buildUrl", () => {
  it("includes hl=en in query params", () => {
    const url = buildUrl("wXbhsf", "session123");
    expect(url).toContain("hl=en");
  });

  it("includes rpcids, f.sid, source-path and rt=c", () => {
    const url = buildUrl("wXbhsf", "session123", "/notebooks");
    expect(url).toContain("rpcids=wXbhsf");
    expect(url).toContain("f.sid=session123");
    expect(url).toContain("source-path=");
    expect(url).toContain("rt=c");
  });
});

describe("parseRpcResponse", () => {
  it("handles real chunked format with byte-count lines", () => {
    // Realistic chunked batchexecute response (rt=c) with byte-count lines
    const inner = JSON.stringify([[{ id: "nb1", title: "Test" }]]);
    const wrbLine = `[["wrb.fr","wXbhsf",${JSON.stringify(inner)},null,null,null,"generic"]]`;
    const diLine = `[["di",152]]`;
    const heartbeat = `[["e",4,null,null,3232]]`;
    const raw = [
      `)]}'\n`,
      `${wrbLine.length}\n`,
      `${wrbLine}\n`,
      `${diLine.length}\n`,
      `${diLine}\n`,
      `${heartbeat.length}\n`,
      `${heartbeat}\n`,
    ].join("");
    const result = parseRpcResponse(raw, "wXbhsf");
    expect(result).toEqual([[{ id: "nb1", title: "Test" }]]);
  });

  it("returns null when inner JSON is null", () => {
    const wrbLine = `[["wrb.fr","wXbhsf",null,null,null,null,"generic"]]`;
    const raw = `)]}'\n${wrbLine.length}\n${wrbLine}\n`;
    const result = parseRpcResponse(raw, "wXbhsf");
    expect(result).toBeNull();
  });

  it("throws RpcError when no wrb.fr chunk found", () => {
    const diLine = `[["di",152]]`;
    const raw = `)]}'\n${diLine.length}\n${diLine}\n`;
    expect(() => parseRpcResponse(raw, "wXbhsf")).toThrow("No wrb.fr response found");
  });

  it("throws RpcError on body-level er error chunk", () => {
    const errLine = `[["er","wXbhsf",null,null,5]]`;
    const raw = `)]}'\n${errLine.length}\n${errLine}\n`;
    expect(() => parseRpcResponse(raw, "wXbhsf")).toThrow("RPC error for wXbhsf");
  });
});
