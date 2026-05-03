import type { NlmNote, RpcSession } from "./types";

export class NotesApi {
  constructor(private session: RpcSession) {}

  /**
   * List all text notes in a notebook (excludes mind maps and deleted items).
   * Uses GET_NOTES_AND_MIND_MAPS rpc (cFji9).
   * Response: result[0] = array of items, each [note_id, content_or_nested, status?, ...]
   *   Deleted: item[1] === null && item[2] === 2
   *   Mind maps: content contains '"children":' or '"nodes":'
   *   Old format: item[1] is string (content)
   *   New format: item[1] is list [note_id, content, metadata, null, title]
   */
  async list(notebookId: string): Promise<NlmNote[]> {
    const result = await this.session.rpcCall(
      "cFji9",
      [notebookId],
      `/notebook/${notebookId}`
    ) as unknown[] | null;

    if (!result || !Array.isArray(result) || !Array.isArray(result[0])) return [];

    const items = result[0] as unknown[][];
    const notes: NlmNote[] = [];

    for (const item of items) {
      if (!Array.isArray(item) || item.length === 0 || typeof item[0] !== "string") continue;

      // Skip deleted: item[1] is null and item[2] === 2
      if (item[1] === null && item[2] === 2) continue;

      const { content, title } = extractNoteContent(item);
      if (!content) continue;

      // Skip mind maps
      if (content.includes('"children":') || content.includes('"nodes":')) continue;

      notes.push({ id: item[0], title: title || "Untitled Note", content });
    }

    return notes;
  }
}

function extractNoteContent(item: unknown[]): { content: string; title: string } {
  if (item.length <= 1) return { content: "", title: "" };

  if (typeof item[1] === "string") {
    return { content: item[1], title: "" };
  }

  if (Array.isArray(item[1])) {
    const inner = item[1] as unknown[];
    const content = inner.length > 1 && typeof inner[1] === "string" ? inner[1] : "";
    const title = inner.length > 4 && typeof inner[4] === "string" ? inner[4] : "";
    return { content, title };
  }

  return { content: "", title: "" };
}
