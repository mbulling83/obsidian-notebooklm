import type { NlmNotebook, RpcSession } from "./types";

function parseNotebook(raw: unknown[]): NlmNotebook {
  return { title: raw[0] as string, id: raw[2] as string };
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
      [title, null, null, [2], [1]],
      "/"
    ) as unknown[];
    return parseNotebook(result);
  }
}
