export interface SyncMeta {
  sourceId?: string;
  noteId?: string;
  notebookId?: string;
  syncedHash?: string;
}

export async function computeHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const NLM_FIELDS = /^notebooklm_(source_id|note_id|notebook_id|synced_hash):.+\n?/gm;

export function stripFrontmatter(content: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return content;
  const cleaned = fmMatch[1].replace(NLM_FIELDS, "").trim();
  const body = fmMatch[2];
  return cleaned ? `---\n${cleaned}\n---\n${body}` : body;
}

export function parseSyncMeta(content: string): SyncMeta {
  const sourceId = content.match(/^notebooklm_source_id:\s*(.+)$/m)?.[1]?.trim();
  const noteId = content.match(/^notebooklm_note_id:\s*(.+)$/m)?.[1]?.trim();
  const notebookId = content.match(/^notebooklm_notebook_id:\s*(.+)$/m)?.[1]?.trim();
  const syncedHash = content.match(/^notebooklm_synced_hash:\s*(.+)$/m)?.[1]?.trim();
  return { sourceId, noteId, notebookId, syncedHash };
}

export function buildSyncFrontmatter(
  content: string,
  sourceId: string,
  notebookId: string,
  hash: string
): string {
  const nlmFields = `notebooklm_source_id: ${sourceId}\nnotebooklm_notebook_id: ${notebookId}\nnotebooklm_synced_hash: ${hash}`;
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!fmMatch) {
    return `---\n${nlmFields}\n---\n${content}`;
  }

  // Remove existing notebooklm fields then append updated ones
  const existing = fmMatch[1].replace(NLM_FIELDS, "").trim();
  const body = fmMatch[2];
  const fm = existing ? `${existing}\n${nlmFields}` : nlmFields;
  return `---\n${fm}\n---\n${body}`;
}

export function buildNoteFrontmatter(content: string, noteId: string, notebookId: string): string {
  const nlmFields = `notebooklm_note_id: ${noteId}\nnotebooklm_notebook_id: ${notebookId}`;
  return `---\n${nlmFields}\n---\n${content}`;
}
