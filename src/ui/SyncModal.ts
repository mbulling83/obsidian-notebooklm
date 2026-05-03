import { App, Modal, Setting, TFile, Notice } from "obsidian";
import type NotebookLMPlugin from "../main";
import type { NlmNotebook } from "../api/types";
import { computeHash, stripFrontmatter, buildSyncFrontmatter, parseSyncMeta } from "../sync/push";

const MAX_RESULTS = 15;

export class SyncModal extends Modal {
  private selectedFiles: Set<TFile> = new Set();
  private targetNotebook: NlmNotebook | null = null;
  private notebooks: NlmNotebook[] = [];
  private searchQuery = "";
  private searchResultsEl: HTMLElement | null = null;
  private selectedPillsEl: HTMLElement | null = null;
  private pushBtnEl: HTMLButtonElement | null = null;

  constructor(app: App, private plugin: NotebookLMPlugin) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Push to NotebookLM" });

    const loadingEl = this.showLoading(contentEl, "Loading notebooks…");
    try {
      this.notebooks = await this.plugin.getNotebooks();
    } catch (e) {
      loadingEl.remove();
      contentEl.createEl("p", { text: `Failed to load notebooks: ${(e as Error).message}` });
      return;
    }
    loadingEl.remove();

    new Setting(contentEl).setName("Notebook").addDropdown((dd) => {
      dd.addOption("", "Select notebook…");
      this.notebooks.forEach((nb) => dd.addOption(nb.id, nb.title));
      dd.addOption("__new__", "+ Create new notebook…");
      dd.onChange((val) => {
        if (val === "__new__") this.promptNewNotebook();
        else this.targetNotebook = this.notebooks.find((n) => n.id === val) ?? null;
      });
    });

    this.buildSearchUI(contentEl);
  }

  private buildSearchUI(containerEl: HTMLElement) {
    new Setting(containerEl).setName("Search notes").addSearch((search) => {
      search.setPlaceholder("Type to search…").onChange((val) => {
        this.searchQuery = val;
        this.updateResults();
      });
      setTimeout(() => search.inputEl.focus(), 50);
    });

    this.selectedPillsEl = containerEl.createDiv("nlm-selected-pills");
    this.selectedPillsEl.style.display = "none";

    this.searchResultsEl = containerEl.createDiv("nlm-search-results");
    this.updateResults();

    const btnRow = containerEl.createDiv("nlm-push-btn-row");
    this.pushBtnEl = btnRow.createEl("button", { cls: "nlm-pull-btn" });
    this.pushBtnEl.disabled = true;
    this.updatePushBtn();
    this.pushBtnEl.onclick = () => this.doPush();
  }

  private getFilteredFiles(): TFile[] {
    const q = this.searchQuery.trim().toLowerCase();
    const pullPrefix = this.plugin.settings.pullFolder + "/";
    const all = this.app.vault
      .getMarkdownFiles()
      .filter((f) => !f.path.startsWith(pullPrefix));

    if (!q) return [];
    return all
      .filter((f) => f.path.toLowerCase().includes(q) || f.basename.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS);
  }

  private updateResults() {
    if (!this.searchResultsEl) return;
    this.searchResultsEl.empty();

    const q = this.searchQuery.trim();
    if (!q) {
      this.searchResultsEl.createEl("p", {
        text: "Start typing to search your vault.",
        cls: "nlm-hint",
      });
      return;
    }

    const files = this.getFilteredFiles();
    if (files.length === 0) {
      this.searchResultsEl.createEl("p", {
        text: `No notes matching "${q}".`,
        cls: "nlm-hint",
      });
      return;
    }

    files.forEach((file) => {
      const isSelected = this.selectedFiles.has(file);
      const row = this.searchResultsEl!.createDiv({
        cls: `nlm-result-row${isSelected ? " is-selected" : ""}`,
      });
      row.createEl("span", { text: file.basename, cls: "nlm-result-name" });
      if (file.parent && file.parent.path) {
        row.createEl("span", { text: file.parent.path, cls: "nlm-result-path" });
      }
      row.createEl("span", { text: isSelected ? "✓" : "+", cls: "nlm-result-icon" });
      row.onclick = () => {
        if (this.selectedFiles.has(file)) this.selectedFiles.delete(file);
        else this.selectedFiles.add(file);
        this.updateResults();
        this.updatePills();
        this.updatePushBtn();
      };
    });
  }

  private updatePills() {
    if (!this.selectedPillsEl) return;
    this.selectedPillsEl.empty();

    if (this.selectedFiles.size === 0) {
      this.selectedPillsEl.style.display = "none";
      return;
    }

    this.selectedPillsEl.style.display = "";
    for (const file of this.selectedFiles) {
      const pill = this.selectedPillsEl.createEl("span", { cls: "nlm-pill" });
      pill.createEl("span", { text: file.basename, cls: "nlm-pill-label" });
      const remove = pill.createEl("button", { text: "×", cls: "nlm-pill-remove" });
      remove.onclick = (e) => {
        e.stopPropagation();
        this.selectedFiles.delete(file);
        this.updatePills();
        this.updateResults();
        this.updatePushBtn();
      };
    }
  }

  private updatePushBtn() {
    if (!this.pushBtnEl) return;
    const n = this.selectedFiles.size;
    this.pushBtnEl.textContent = n > 0 ? `Push ${n} note${n !== 1 ? "s" : ""} →` : "Push →";
    this.pushBtnEl.disabled = n === 0;
  }

  private showLoading(container: HTMLElement, text: string): HTMLElement {
    const el = container.createDiv("nlm-loading");
    el.createDiv("nlm-spinner");
    el.createSpan({ text });
    return el;
  }

  private async promptNewNotebook() {
    const title = await new Promise<string | null>((resolve) => {
      const m = new Modal(this.app);
      m.contentEl.createEl("h3", { text: "New notebook name" });
      let value = "";
      new Setting(m.contentEl).addText((t) => t.onChange((v) => (value = v)));
      new Setting(m.contentEl)
        .addButton((b) =>
          b.setButtonText("Create").setCta().onClick(() => { m.close(); resolve(value || null); })
        )
        .addButton((b) => b.setButtonText("Cancel").onClick(() => { m.close(); resolve(null); }));
      m.open();
    });
    if (title) {
      this.targetNotebook = await this.plugin.createNotebook(title);
      new Notice(`Created notebook: ${title}`);
    }
  }

  private async doPush() {
    if (!this.targetNotebook) { new Notice("Select a target notebook first"); return; }
    const files = [...this.selectedFiles];
    if (files.length === 0) { new Notice("Select at least one note"); return; }

    this.close();
    new Notice(`Pushing ${files.length} note(s)…`);
    let pushed = 0;

    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        const meta = parseSyncMeta(content);
        const contentForHash = stripFrontmatter(content);
        const hash = await computeHash(contentForHash);

        const source = await this.plugin.addTextSource(
          this.targetNotebook!.id,
          file.basename,
          contentForHash
        );
        if (meta.sourceId && meta.notebookId === this.targetNotebook!.id) {
          try { await this.plugin.deleteSource(this.targetNotebook!.id, meta.sourceId); }
          catch { /* non-fatal: old source may already be gone */ }
        }

        await this.app.vault.modify(
          file,
          buildSyncFrontmatter(content, source.id, this.targetNotebook!.id, hash)
        );
        // Record original path in registry for pull-side backlinks
        this.plugin.settings.sourceRegistry[source.id] = file.path;
        pushed++;
      } catch (e) {
        new Notice(`Failed to push ${file.name}: ${(e as Error).message}`);
      }
    }

    await this.plugin.saveSettings();
    new Notice(`Pushed ${pushed}/${files.length} note(s) to NotebookLM`);
  }

  onClose() {
    this.contentEl.empty();
  }
}
