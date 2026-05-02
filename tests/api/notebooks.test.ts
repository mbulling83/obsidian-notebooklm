import { describe, it, expect, vi } from "vitest";
import { NotebooksApi } from "../../src/api/notebooks";
import type { RpcSession } from "../../src/api/types";

const makeSession = (responsePayload: unknown): RpcSession => ({
  rpcCall: vi.fn().mockResolvedValue(responsePayload),
});

describe("NotebooksApi.list", () => {
  it("returns parsed notebooks", async () => {
    // list response: [[nb1, nb2]] where each nb is [title, null, id, ...]
    const rawNb = ["My Notebook", null, "nb123"];
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
    const rawNb = ["New Notebook", null, "nb456"];
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
