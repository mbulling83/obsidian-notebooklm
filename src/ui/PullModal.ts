import { App, Modal, Setting, Notice, TFile } from "obsidian";
import type NotebookLMPlugin from "../main";
import type { NlmNotebook, NlmSource } from "../api/types";
import { computeHash, buildSyncFrontmatter, parseSyncMeta, stripFrontmatter } from "../sync/push";
import { detectConflict, conflictFileName, todayString } from "../sync/pull";

export class PullModal extends Modal {
  private notebook: NlmNotebook | null = null;
  private sources: NlmSource[] = [];
  private selected: Set<string> = new Set();

  constructor(app: App, private plugin: NotebookLMPlugin) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Pull from NotebookLM" });

    const notebooks = await this.plugin.getNotebooks();

    new Setting(contentEl).setName("Notebook").addDropdown(async (dd) => {
      dd.addOption("", "Select notebook…");
      notebooks.forEach((nb) => dd.addOption(nb.id, nb.title));
      dd.onChange(async (val) => {
        this.notebook = notebooks.find((n) => n.id === val) ?? null;
        if (this.notebook) await this.loadSources(contentEl);
      });
    });
  }

  private async loadSources(containerEl: HTMLElement) {
    containerEl.querySelector(".nlm-sources")?.remove();
    if (!this.notebook) return;

    this.sources = await this.plugin.listSources(this.notebook.id);
    const allNotes = this.app.vault.getMarkdownFiles();
    const trackedIds = new Map<string, TFile>();
    for (const note of allNotes) {
      const content = await this.app.vault.read(note);
      const { sourceId } = parseSyncMeta(content);
      if (sourceId) trackedIds.set(sourceId, note);
    }

    const wrapper = containerEl.createDiv("nlm-sources");
    wrapper.createEl("h3", { text: `${this.sources.length} sources` });

    this.sources.forEach((src) => {
      const isTracked = trackedIds.has(src.id);
      new Setting(wrapper)
        .setName(src.title)
        .setDesc(isTracked ? "↺ from vault" : "NEW")
        .addToggle((toggle) =>
          toggle.onChange((v) => {
            if (v) this.selected.add(src.id);
            else this.selected.delete(src.id);
          })
        );
    });

    new Setting(wrapper).addButton((btn) =>
      btn.setButtonText(`← Pull selected`).setCta().onClick(() => this.doPull(trackedIds))
    );
  }

  private async doPull(trackedIds: Map<string, TFile>) {
    if (!this.notebook || this.selected.size === 0) {
      new Notice("Select at least one source");
      return;
    }
    this.close();
    new Notice(`Pulling ${this.selected.size} source(s)…`);
    let pulled = 0;

    for (const src of this.sources.filter((s) => this.selected.has(s.id))) {
      try {
        const fulltext = await this.plugin.getSourceFulltext(this.notebook!.id, src.id);
        const hash = await computeHash(fulltext.content);
        const existingNote = trackedIds.get(src.id);

        if (existingNote) {
          const existingContent = await this.app.vault.read(existingNote);
          const { syncedHash } = parseSyncMeta(existingContent);
          const currentHash = await computeHash(stripFrontmatter(existingContent));
          const conflict = detectConflict(syncedHash, currentHash);

          if (conflict === "conflict") {
            // Keep both: write NotebookLM version as a new file alongside
            const conflictName = conflictFileName(existingNote.name, todayString());
            const conflictPath = existingNote.parent
              ? `${existingNote.parent.path}/${conflictName}`
              : conflictName;
            const newContent = buildSyncFrontmatter(
              fulltext.content,
              src.id,
              this.notebook!.id,
              hash
            );
            await this.app.vault.create(conflictPath, newContent);
          } else {
            // No conflict — update in place
            const updated = buildSyncFrontmatter(
              fulltext.content,
              src.id,
              this.notebook!.id,
              hash
            );
            await this.app.vault.modify(existingNote, updated);
          }
        } else {
          // New source — create in NotebookLM/<notebook>/<title>.md
          const folder = `${this.plugin.settings.pullFolder}/${this.notebook!.title}`;
          await this.ensureFolder(folder);
          const path = `${folder}/${sanitizeFilename(src.title)}.md`;
          const newContent = buildSyncFrontmatter(
            fulltext.content,
            src.id,
            this.notebook!.id,
            hash
          );
          await this.app.vault.create(path, newContent);
        }
        pulled++;
      } catch (e) {
        new Notice(`Failed to pull ${src.title}: ${(e as Error).message}`);
      }
    }

    new Notice(`Pulled ${pulled}/${this.selected.size} source(s)`);
  }

  private async ensureFolder(path: string) {
    const parts = path.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "-").trim();
}
