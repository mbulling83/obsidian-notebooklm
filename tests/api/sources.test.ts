import { describe, it, expect, vi } from "vitest";
import { SourcesApi } from "../../src/api/sources";
import type { RpcSession } from "../../src/api/types";

const makeSession = (payload: unknown): RpcSession => ({
  rpcCall: vi.fn().mockResolvedValue(payload),
});

describe("SourcesApi.list", () => {
  it("returns sources from GET_NOTEBOOK response", async () => {
    // GET_NOTEBOOK response: [[nb_info]] where nb_info[1] = sources array
    // Each source: [[src_id], title, metadata_array]
    // metadata_array[4] = sourceType
    const rawSrc = [["src1"], "My Source", [null, null, null, null, 4]];
    const session = makeSession([[null, [rawSrc]]]);
    const api = new SourcesApi(session);
    const result = await api.list("nb1");
    expect(result).toEqual([{ id: "src1", title: "My Source", sourceType: 4 }]);
  });

  it("uses rLM1Ne method with correct params", async () => {
    const session = makeSession([[null, []]]);
    const api = new SourcesApi(session);
    await api.list("nb1");
    expect(session.rpcCall).toHaveBeenCalledWith(
      "rLM1Ne",
      ["nb1", null, [2], null, 0],
      "/notebook/nb1"
    );
  });

  it("returns empty array when no sources", async () => {
    const session = makeSession([[null, []]]);
    const api = new SourcesApi(session);
    expect(await api.list("nb1")).toEqual([]);
  });

  it("returns empty array when response is null", async () => {
    const session = makeSession(null);
    const api = new SourcesApi(session);
    expect(await api.list("nb1")).toEqual([]);
  });
});

describe("SourcesApi.addText", () => {
  it("calls izAoDd with correct params", async () => {
    // ADD_SOURCE response is deeply nested: [[[[id], title, metadata]]]
    const session = makeSession([[[["src2"], "My Note", [null, null, null, null, 4]]]]);
    const api = new SourcesApi(session);
    await api.addText("nb1", "My Note", "Hello content");
    expect(session.rpcCall).toHaveBeenCalledWith(
      "izAoDd",
      [[[null, ["My Note", "Hello content"], null, null, null, null, null, null]], "nb1", [2], null, null],
      "/notebook/nb1"
    );
  });

  it("returns parsed source from deeply nested add response", async () => {
    // ADD_SOURCE returns: [[[[id], title, metadata]]]
    const session = makeSession([[[["src2"], "My Note", [null, null, null, null, 4]]]]);
    const api = new SourcesApi(session);
    const result = await api.addText("nb1", "My Note", "Hello content");
    expect(result.id).toBe("src2");
    expect(result.title).toBe("My Note");
  });

  it("throws on unexpected response structure", async () => {
    const session = makeSession(null);
    const api = new SourcesApi(session);
    await expect(api.addText("nb1", "My Note", "Hello content")).rejects.toThrow(
      "Unexpected addText response structure"
    );
  });
});

describe("SourcesApi.getFulltext", () => {
  it("calls hizoJc with correct params", async () => {
    // GET_SOURCE response: [[source_id, title, metadata], null, null, [content_blocks]]
    const session = makeSession([["src1", "My Note", [null, null, null, null, 4]], null, null, [["Hello full content"]]]);
    const api = new SourcesApi(session);
    await api.getFulltext("nb1", "src1");
    expect(session.rpcCall).toHaveBeenCalledWith(
      "hizoJc",
      [["src1"], [2], [2]],
      "/notebook/nb1"
    );
  });

  it("returns title from result[0][1] and content from result[3][0]", async () => {
    // Python: title at result[0][1], content blocks at result[3][0]
    const session = makeSession([["src1", "My Note", [null, null, null, null, 4]], null, null, [["Hello full content"]]]);
    const api = new SourcesApi(session);
    const result = await api.getFulltext("nb1", "src1");
    expect(result.title).toBe("My Note");
    expect(result.content).toBe("Hello full content");
    expect(result.sourceType).toBe(4);
  });

  it("extracts sourceType from result[0][2][4]", async () => {
    const session = makeSession([["src1", "My Note", [null, null, null, null, 9]], null, null, [["YouTube content"]]]);
    const api = new SourcesApi(session);
    const result = await api.getFulltext("nb1", "src1");
    expect(result.sourceType).toBe(9);
  });

  it("returns empty string content when result[3] is missing", async () => {
    const session = makeSession([["src1", "My Note", [null, null, null, null, 4]]]);
    const api = new SourcesApi(session);
    const result = await api.getFulltext("nb1", "src1");
    expect(result.content).toBe("");
    expect(result.title).toBe("My Note");
  });

  it("throws when response is null", async () => {
    const session = makeSession(null);
    const api = new SourcesApi(session);
    await expect(api.getFulltext("nb1", "src1")).rejects.toThrow(
      "Source src1 not found in notebook nb1"
    );
  });
});

describe("SourcesApi.delete", () => {
  it("calls tGMBJ with correct params", async () => {
    const session = makeSession(null);
    const api = new SourcesApi(session);
    await api.delete("nb1", "src1");
    expect(session.rpcCall).toHaveBeenCalledWith(
      "tGMBJ",
      [[["src1"]]],
      "/notebook/nb1"
    );
  });

  it("resolves without error on success", async () => {
    const session = makeSession(null);
    const api = new SourcesApi(session);
    await expect(api.delete("nb1", "src1")).resolves.toBeUndefined();
  });
});
