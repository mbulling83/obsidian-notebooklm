import { describe, it, expect, vi } from "vitest";
import { computeHash, stripFrontmatter, buildSyncFrontmatter } from "../../src/sync/push";

describe("computeHash", () => {
  it("returns consistent hex string for same input", async () => {
    const h1 = await computeHash("hello");
    const h2 = await computeHash("hello");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns different hash for different input", async () => {
    const h1 = await computeHash("hello");
    const h2 = await computeHash("world");
    expect(h1).not.toBe(h2);
  });
});

describe("stripFrontmatter", () => {
  it("removes notebooklm_ frontmatter fields for hashing", () => {
    const content = `---
title: My Note
notebooklm_source_id: abc
notebooklm_notebook_id: xyz
notebooklm_synced_hash: def
---
# Hello`;
    const stripped = stripFrontmatter(content);
    expect(stripped).not.toContain("notebooklm_");
    expect(stripped).toContain("# Hello");
    expect(stripped).toContain("title: My Note");
  });

  it("returns content unchanged if no frontmatter", () => {
    const content = "# Hello\nWorld";
    expect(stripFrontmatter(content)).toBe(content);
  });
});

describe("buildSyncFrontmatter", () => {
  it("injects notebooklm fields into existing frontmatter", () => {
    const content = `---
title: My Note
---
# Body`;
    const result = buildSyncFrontmatter(content, "src1", "nb1", "hash1");
    expect(result).toContain("notebooklm_source_id: src1");
    expect(result).toContain("notebooklm_notebook_id: nb1");
    expect(result).toContain("notebooklm_synced_hash: hash1");
    expect(result).toContain("title: My Note");
  });

  it("creates frontmatter block if none exists", () => {
    const content = "# Hello";
    const result = buildSyncFrontmatter(content, "src1", "nb1", "hash1");
    expect(result).toMatch(/^---\n/);
    expect(result).toContain("notebooklm_source_id: src1");
  });
});
