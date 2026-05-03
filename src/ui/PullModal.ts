import { App, Modal, Setting, Notice, TFile } from "obsidian";
import type { ToggleComponent } from "obsidian";
import type NotebookLMPlugin from "../main";
import type { NlmNotebook, NlmSource, NlmNote } from "../api/types";
import { computeHash, buildSyncFrontmatter, buildNoteFrontmatter, parseSyncMeta, stripFrontmatter } from "../sync/push";
import { detectConflict, conflictFileName, todayString } from "../sync/pull";

export class PullModal extends Modal {
  private notebook: NlmNotebook | null = null;
  private sources: NlmSource[] = [];
  private notes: NlmNote[] = [];
  private selectedSources: Set<string> = new Set();
  private selectedNotes: Set<string> = new Set();
  private trackedSourceIds: Map<string, TFile> = new Map();
  private trackedNoteIds: Map<string, TFile> = new Map();
  private activeTab: "sources" | "notes" = "sources";

  constructor(app: App, private plugin: NotebookLMPlugin) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Pull from NotebookLM" });

    const loadingEl = this.showLoading(contentEl, "Loading notebooks…");
    let notebooks: NlmNotebook[];
    try {
      notebooks = await this.plugin.getNotebooks();
    } catch (e) {
      loadingEl.remove();
      contentEl.createEl("p", { text: `Failed to load notebooks: ${(e as Error).message}` });
      return;
    }
    loadingEl.remove();

    const pullPrefix = this.plugin.settings.pullFolder + "/";
    for (const file of this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(pullPrefix))) {
      const content = await this.app.vault.read(file);
      const meta = parseSyncMeta(content);
      if (meta.sourceId) this.trackedSourceIds.set(meta.sourceId, file);
      if (meta.noteId) this.trackedNoteIds.set(meta.noteId, file);
    }

    new Setting(contentEl).setName("Notebook").addDropdown((dd) => {
      dd.addOption("", "Select notebook…");
      notebooks.forEach((nb) => dd.addOption(nb.id, nb.title));
      dd.onChange(async (val) => {
        this.notebook = notebooks.find((n) => n.id === val) ?? null;
        this.selectedSources.clear();
        this.selectedNotes.clear();
        if (this.notebook) await this.loadContent(contentEl);
      });
    });
  }

  private async loadContent(containerEl: HTMLElement) {
    containerEl.querySelector(".nlm-content")?.remove();
    if (!this.notebook) return;

    const wrapper = containerEl.createDiv("nlm-content");
    const loadingEl = this.showLoading(wrapper, "Loading sources and notes…");

    const [sourcesResult, notesResult] = await Promise.allSettled([
      this.plugin.listSources(this.notebook.id),
      this.plugin.listNotes(this.notebook.id),
    ]);

    loadingEl.remove();

    this.sources = sourcesResult.status === "fulfilled" ? sourcesResult.value : [];
    this.notes = notesResult.status === "fulfilled" ? notesResult.value : [];

    // Toolbar: tabs left, action buttons right
    const toolbar = wrapper.createDiv("nlm-toolbar");
    const tabBar = toolbar.createDiv("nlm-tab-bar");
    const sourcesTabBtn = tabBar.createEl("button", {
      text: `Sources (${this.sources.length})`,
      cls: "nlm-tab",
    });
    const notesTabBtn = tabBar.createEl("button", {
      text: `Notes (${this.notes.length})`,
      cls: "nlm-tab",
    });

    const toolbarRight = toolbar.createDiv("nlm-toolbar-right");
    const sourcesSelectAllBtn = toolbarRight.createEl("button", {
      text: "Select All",
      cls: "nlm-select-all-btn",
    });
    const notesSelectAllBtn = toolbarRight.createEl("button", {
      text: "Select All",
      cls: "nlm-select-all-btn",
    });
    const sourcesPullBtn = toolbarRight.createEl("button", {
      text: "Pull selected",
      cls: "nlm-pull-btn",
    });
    const notesPullBtn = toolbarRight.createEl("button", {
      text: "Pull selected",
      cls: "nlm-pull-btn",
    });

    // Tab panels
    const sourcesPanel = wrapper.createDiv("nlm-tab-panel");
    const notesPanel = wrapper.createDiv("nlm-tab-panel");

    this.buildSourcesPanel(sourcesPanel, sourcesSelectAllBtn);
    this.buildNotesPanel(notesPanel, notesSelectAllBtn);

    sourcesPullBtn.onclick = () => this.doPullSources();
    notesPullBtn.onclick = () => this.doPullNotes();

    const showTab = (tab: "sources" | "notes") => {
      this.activeTab = tab;
      sourcesPanel.style.display = tab === "sources" ? "" : "none";
      notesPanel.style.display = tab === "notes" ? "" : "none";
      sourcesTabBtn.classList.toggle("is-active", tab === "sources");
      notesTabBtn.classList.toggle("is-active", tab === "notes");
      sourcesSelectAllBtn.style.display = tab === "sources" ? "" : "none";
      notesSelectAllBtn.style.display = tab === "notes" ? "" : "none";
      sourcesPullBtn.style.display = tab === "sources" ? "" : "none";
      notesPullBtn.style.display = tab === "notes" ? "" : "none";
    };

    sourcesTabBtn.onclick = () => showTab("sources");
    notesTabBtn.onclick = () => showTab("notes");
    showTab(this.activeTab);
  }

  private buildSourcesPanel(panel: HTMLElement, selectAllBtn: HTMLButtonElement) {
    if (this.sources.length === 0) {
      panel.createEl("p", { text: "No sources in this notebook." });
      selectAllBtn.style.display = "none";
      return;
    }

    const sourceToggles: Map<string, ToggleComponent> = new Map();

    selectAllBtn.onclick = () => {
      const allSelected = this.selectedSources.size === this.sources.length;
      if (allSelected) {
        this.selectedSources.clear();
        sourceToggles.forEach((t) => t.setValue(false));
        selectAllBtn.textContent = "Select All";
      } else {
        this.sources.forEach((s) => this.selectedSources.add(s.id));
        sourceToggles.forEach((t) => t.setValue(true));
        selectAllBtn.textContent = "Deselect All";
      }
    };

    this.sources.forEach((src) => {
      const isTracked = this.trackedSourceIds.has(src.id);
      new Setting(panel)
        .setName(src.title)
        .setDesc(isTracked ? "↺ from vault" : "NEW")
        .addToggle((toggle) => {
          sourceToggles.set(src.id, toggle);
          toggle.onChange((v) => {
            if (v) this.selectedSources.add(src.id);
            else this.selectedSources.delete(src.id);
            selectAllBtn.textContent =
              this.selectedSources.size === this.sources.length ? "Deselect All" : "Select All";
          });
        });
    });
  }

  private buildNotesPanel(panel: HTMLElement, selectAllBtn: HTMLButtonElement) {
    if (this.notes.length === 0) {
      panel.createEl("p", { text: "No notes in this notebook." });
      selectAllBtn.style.display = "none";
      return;
    }

    const noteToggles: Map<string, ToggleComponent> = new Map();

    selectAllBtn.onclick = () => {
      const allSelected = this.selectedNotes.size === this.notes.length;
      if (allSelected) {
        this.selectedNotes.clear();
        noteToggles.forEach((t) => t.setValue(false));
        selectAllBtn.textContent = "Select All";
      } else {
        this.notes.forEach((n) => this.selectedNotes.add(n.id));
        noteToggles.forEach((t) => t.setValue(true));
        selectAllBtn.textContent = "Deselect All";
      }
    };

    this.notes.forEach((note) => {
      const isTracked = this.trackedNoteIds.has(note.id);
      new Setting(panel)
        .setName(note.title || "Untitled Note")
        .setDesc(isTracked ? "↺ from vault" : "NEW")
        .addToggle((toggle) => {
          noteToggles.set(note.id, toggle);
          toggle.onChange((v) => {
            if (v) this.selectedNotes.add(note.id);
            else this.selectedNotes.delete(note.id);
            selectAllBtn.textContent =
              this.selectedNotes.size === this.notes.length ? "Deselect All" : "Select All";
          });
        });
    });
  }

  private showLoading(container: HTMLElement, text: string): HTMLElement {
    const el = container.createDiv("nlm-loading");
    el.createDiv("nlm-spinner");
    el.createSpan({ text });
    return el;
  }

  private async doPullSources() {
    if (!this.notebook || this.selectedSources.size === 0) {
      new Notice("Select at least one source");
      return;
    }
    this.close();
    new Notice(`Pulling ${this.selectedSources.size} source(s)…`);
    let pulled = 0;

    for (const src of this.sources.filter((s) => this.selectedSources.has(s.id))) {
      try {
        const fulltext = await this.plugin.getSourceFulltext(this.notebook!.id, src.id);
        const hash = await computeHash(fulltext.content);
        const existingFile = this.trackedSourceIds.get(src.id);

        if (existingFile) {
          const existingContent = await this.app.vault.read(existingFile);
          const { syncedHash } = parseSyncMeta(existingContent);
          const currentHash = await computeHash(stripFrontmatter(existingContent));
          const conflict = detectConflict(syncedHash, currentHash);

          if (conflict === "conflict") {
            const conflictName = conflictFileName(existingFile.name, todayString());
            const conflictPath = existingFile.parent
              ? `${existingFile.parent.path}/${conflictName}`
              : conflictName;
            await this.app.vault.create(
              conflictPath,
              buildSyncFrontmatter(fulltext.content, src.id, this.notebook!.id, hash)
            );
          } else {
            await this.app.vault.modify(
              existingFile,
              buildSyncFrontmatter(fulltext.content, src.id, this.notebook!.id, hash)
            );
          }
        } else {
          const folder = `${this.plugin.settings.pullFolder}/${this.notebook!.title}`;
          await this.ensureFolder(folder);
          const path = `${folder}/${sanitizeFilename(src.title)}.md`;
          // If this source was originally pushed from a vault file, prepend a backlink
          const originalPath = this.plugin.settings.sourceRegistry[src.id];
          const body = originalPath
            ? `> Source: [[${originalPath.replace(/\.md$/, "")}]]\n\n${fulltext.content}`
            : fulltext.content;
          await this.app.vault.create(
            path,
            buildSyncFrontmatter(body, src.id, this.notebook!.id, hash)
          );
        }
        pulled++;
      } catch (e) {
        new Notice(`Failed to pull "${src.title}": ${(e as Error).message}`);
      }
    }

    new Notice(`Pulled ${pulled}/${this.selectedSources.size} source(s)`);
  }

  private async doPullNotes() {
    if (!this.notebook || this.selectedNotes.size === 0) {
      new Notice("Select at least one note");
      return;
    }
    this.close();
    new Notice(`Pulling ${this.selectedNotes.size} note(s)…`);
    let pulled = 0;

    for (const note of this.notes.filter((n) => this.selectedNotes.has(n.id))) {
      try {
        const noteContent = buildNoteFrontmatter(note.content, note.id, this.notebook!.id);
        const existingFile = this.trackedNoteIds.get(note.id);

        if (existingFile) {
          await this.app.vault.modify(existingFile, noteContent);
        } else {
          const folder = `${this.plugin.settings.pullFolder}/${this.notebook!.title}/notes`;
          await this.ensureFolder(folder);
          const path = `${folder}/${sanitizeFilename(note.title || "Untitled Note")}.md`;
          await this.app.vault.create(path, noteContent);
        }
        pulled++;
      } catch (e) {
        new Notice(`Failed to pull note "${note.title}": ${(e as Error).message}`);
      }
    }

    new Notice(`Pulled ${pulled}/${this.selectedNotes.size} note(s)`);
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
