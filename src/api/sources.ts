import type { NlmSource, RpcSession } from "./types";

export interface SourceFulltext {
  title: string;
  content: string;
  sourceType?: number;
}

export class SourcesApi {
  constructor(private session: RpcSession) {}

  /**
   * List all sources in a notebook.
   * Uses GET_NOTEBOOK rpc (rLM1Ne).
   * Response structure: result[0][1] = sources array.
   * Each source raw entry: [id_array, title, metadata_array]
   *   id_array[0] = source id string
   *   metadata_array[4] = sourceType code
   */
  async list(notebookId: string): Promise<NlmSource[]> {
    const result = await this.session.rpcCall(
      "rLM1Ne",
      [notebookId, null, [2], null, 0],
      `/notebook/${notebookId}`
    ) as unknown[][] | null;

    if (!Array.isArray(result) || result.length === 0) return [];

    const nbInfo = result[0] as unknown[];
    if (!Array.isArray(nbInfo) || nbInfo.length <= 1) return [];

    const sourcesRaw = nbInfo[1] as unknown[][];
    if (!Array.isArray(sourcesRaw)) return [];

    return sourcesRaw.map((s) => {
      const idArr = s[0] as string[];
      const metadata = s[2] as unknown[] | null | undefined;
      return {
        id: Array.isArray(idArr) ? idArr[0] : (idArr as unknown as string),
        title: s[1] as string,
        sourceType: Array.isArray(metadata) && metadata.length > 4 && typeof metadata[4] === "number"
          ? (metadata[4] as number)
          : undefined,
      };
    });
  }

  /**
   * Add a text source to a notebook.
   * Uses ADD_SOURCE rpc (izAoDd).
   * Response is deeply nested: [[[[id], title, metadata]]]
   */
  async addText(notebookId: string, title: string, content: string): Promise<NlmSource> {
    const result = await this.session.rpcCall(
      "izAoDd",
      [[[null, [title, content], null, null, null, null, null, null]], notebookId, [2], null, null],
      `/notebook/${notebookId}`
    ) as unknown[][][];

    // Deeply nested: [[[[id], title, metadata]]]
    // result[0][0] = [[id], title, metadata]
    if (!Array.isArray(result) || !Array.isArray(result[0]) || !Array.isArray(result[0][0])) {
      throw new Error("Unexpected addText response structure");
    }
    const entry = result[0][0] as unknown[];
    const idArr = entry[0] as string[];
    const sourceId = Array.isArray(idArr) ? idArr[0] : (idArr as unknown as string);
    const sourceTitle = entry[1] as string;

    return { id: sourceId, title: sourceTitle };
  }

  /**
   * Get the full indexed text of a source.
   * Uses GET_SOURCE rpc (hizoJc) with params [[source_id], [2], [2]].
   * Response structure:
   *   result[0][1] = title
   *   result[0][2][4] = sourceType
   *   result[3][0] = content blocks (nested arrays, extract all strings)
   */
  async getFulltext(notebookId: string, sourceId: string): Promise<SourceFulltext> {
    const result = await this.session.rpcCall(
      "hizoJc",
      [[sourceId], [2], [2]],
      `/notebook/${notebookId}`
    ) as unknown[];

    if (!result || !Array.isArray(result)) {
      throw new Error(`Source ${sourceId} not found in notebook ${notebookId}`);
    }

    // title at result[0][1]
    const sourceInfo = result[0] as unknown[];
    const title = Array.isArray(sourceInfo) && sourceInfo.length > 1
      ? (sourceInfo[1] as string ?? "")
      : "";

    // sourceType at result[0][2][4]
    const metadata = Array.isArray(sourceInfo) && sourceInfo.length > 2
      ? (sourceInfo[2] as unknown[])
      : null;
    const sourceType = Array.isArray(metadata) && metadata.length > 4 && typeof metadata[4] === "number"
      ? (metadata[4] as number)
      : undefined;

    // content blocks at result[3][0] — recursively extract all strings
    let content = "";
    if (result.length > 3 && Array.isArray(result[3])) {
      const contentBlocks = (result[3] as unknown[])[0];
      if (Array.isArray(contentBlocks)) {
        content = extractAllText(contentBlocks as unknown[]).join("\n");
      }
    }

    return { title, content, sourceType };
  }

  /**
   * Delete a source from a notebook.
   * Uses DELETE_SOURCE rpc (tGMBJ) with params [[[source_id]]].
   */
  async delete(notebookId: string, sourceId: string): Promise<void> {
    await this.session.rpcCall(
      "tGMBJ",
      [[[sourceId]]],
      `/notebook/${notebookId}`
    );
  }
}

/** Recursively extract all non-empty strings from a nested array structure. */
function extractAllText(data: unknown[], maxDepth = 100): string[] {
  if (maxDepth <= 0) return [];
  const texts: string[] = [];
  for (const item of data) {
    if (typeof item === "string" && item.length > 0) {
      texts.push(item);
    } else if (Array.isArray(item)) {
      texts.push(...extractAllText(item as unknown[], maxDepth - 1));
    }
  }
  return texts;
}
