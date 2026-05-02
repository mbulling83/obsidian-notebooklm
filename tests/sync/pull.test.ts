import { describe, it, expect } from "vitest";
import { detectConflict, conflictFileName } from "../../src/sync/pull";

describe("detectConflict", () => {
  it("returns none when hashes match (unmodified locally)", () => {
    expect(detectConflict("abc", "abc")).toBe("none");
  });

  it("returns conflict when hashes differ (modified locally)", () => {
    expect(detectConflict("abc", "xyz")).toBe("conflict");
  });

  it("returns none when no stored hash (new note)", () => {
    expect(detectConflict(undefined, "xyz")).toBe("none");
  });
});

describe("conflictFileName", () => {
  it("generates dated conflict filename", () => {
    const result = conflictFileName("My Note.md", "2026-05-02");
    expect(result).toBe("My Note (NotebookLM 2026-05-02).md");
  });

  it("handles filename without extension", () => {
    const result = conflictFileName("My Note", "2026-05-02");
    expect(result).toBe("My Note (NotebookLM 2026-05-02)");
  });
});
