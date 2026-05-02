import { App, Modal, Setting, TFile, Notice } from "obsidian";
import type NotebookLMPlugin from "../main";
import type { NlmNotebook } from "../api/types";
import { computeHash, stripFrontmatter, buildSyncFrontmatter, parseSyncMeta } from "../sync/push";

export class SyncModal extends Modal {
  private selectedFiles: TFile[] = [];
  private folderMode = false;
  private selectedFolder = "";
  private targetNotebook: NlmNotebook | null = null;
  private notebooks: NlmNotebook[] = [];

  constructor(app: App, private plugin: NotebookLMPlugin) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Push to NotebookLM" });

    this.notebooks = await this.plugin.getNotebooks();

    // Notebook picker
    new Setting(contentEl).setName("Target notebook").addDropdown((dd) => {
      dd.addOption("", "Select notebook…");
      this.notebooks.forEach((nb) => dd.addOption(nb.id, nb.title));
      dd.addOption("__new__", "+ Create new notebook…");
      dd.onChange((val) => {
        if (val === "__new__") this.promptNewNotebook();
        else this.targetNotebook = this.notebooks.find((n) => n.id === val) ?? null;
      });
    });

    // Folder vs file toggle
    new Setting(contentEl)
      .setName("Sync mode")
      .addToggle((toggle) => {
        toggle.setValue(this.folderMode).onChange((v) => {
          this.folderMode = v;
          this.renderFileSelector(contentEl);
        });
      })
      .setDesc(this.folderMode ? "Sync entire folder" : "Select individual files");

    this.renderFileSelector(contentEl);

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Push →").setCta().onClick(() => this.doPush())
    );
  }

  private renderFileSelector(containerEl: HTMLElement) {
    const existing = containerEl.querySelector(".nlm-file-selector");
    existing?.remove();
    const wrapper = containerEl.createDiv("nlm-file-selector");

    if (this.folderMode) {
      new Setting(wrapper).setName("Folder").addText((t) =>
        t.setPlaceholder("e.g. Research/").onChange((v) => (this.selectedFolder = v))
      );
    } else {
      const files = this.app.vault.getMarkdownFiles();
      files.forEach((file) => {
        new Setting(wrapper).setName(file.path).addToggle((toggle) =>
          toggle.onChange((v) => {
            if (v) this.selectedFiles.push(file);
            else this.selectedFiles = this.selectedFiles.filter((f) => f !== file);
          })
        );
      });
    }
  }

  private async promptNewNotebook() {
    const title = await new Promise<string | null>((resolve) => {
      // Simple prompt using a modal
      const m = new Modal(this.app);
      m.contentEl.createEl("h3", { text: "New notebook name" });
      let value = "";
      new Setting(m.contentEl).addText((t) => t.onChange((v) => (value = v)));
      new Setting(m.contentEl)
        .addButton((b) => b.setButtonText("Create").setCta().onClick(() => { m.close(); resolve(value || null); }))
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

    const files = this.folderMode
      ? this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(this.selectedFolder))
      : this.selectedFiles;

    if (files.length === 0) { new Notice("No files selected"); return; }

    this.close();
    new Notice(`Pushing ${files.length} note(s)…`);
    let pushed = 0;

    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        const meta = parseSyncMeta(content);
        const contentForHash = stripFrontmatter(content);
        const hash = await computeHash(contentForHash);

        let sourceId = meta.sourceId;

        if (sourceId) {
          // Re-push: delete old source first
          await this.plugin.deleteSource(this.targetNotebook!.id, sourceId);
        }

        const source = await this.plugin.addTextSource(
          this.targetNotebook!.id,
          file.basename,
          contentForHash
        );
        sourceId = source.id;

        const updated = buildSyncFrontmatter(content, sourceId, this.targetNotebook!.id, hash);
        await this.app.vault.modify(file, updated);
        pushed++;
      } catch (e) {
        new Notice(`Failed to push ${file.name}: ${(e as Error).message}`);
      }
    }

    new Notice(`Pushed ${pushed}/${files.length} note(s) to NotebookLM`);
  }

  onClose() {
    this.contentEl.empty();
  }
}
