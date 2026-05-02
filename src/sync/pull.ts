export type ConflictResult = "none" | "conflict";

export function detectConflict(storedHash: string | undefined, currentHash: string): ConflictResult {
  if (!storedHash) return "none";
  return storedHash === currentHash ? "none" : "conflict";
}

export function conflictFileName(originalName: string, date: string): string {
  const dotIdx = originalName.lastIndexOf(".");
  if (dotIdx === -1) return `${originalName} (NotebookLM ${date})`;
  const base = originalName.slice(0, dotIdx);
  const ext = originalName.slice(dotIdx);
  return `${base} (NotebookLM ${date})${ext}`;
}

export function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}
