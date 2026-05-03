import { Plugin, Notice, TFile } from "obsidian";
import type { StoredAuth } from "./auth";
import { storedAuthToTokens } from "./auth";
import { HttpRpcSession } from "./api/session";
import { NotebooksApi } from "./api/notebooks";
import { SourcesApi } from "./api/sources";
import { NotesApi } from "./api/notes";
import type { NlmNotebook, NlmSource, NlmNote } from "./api/types";
import type { SourceFulltext } from "./api/sources";
import { NotebookLMSettingsTab } from "./ui/SettingsTab";
import { SyncModal } from "./ui/SyncModal";
import { PullModal } from "./ui/PullModal";
import { parseSyncMeta, stripFrontmatter } from "./sync/push";
import { NotebookLMAuthError } from "./api/client";

export interface NotebookLMSettings {
  auth: StoredAuth | null;
  pullFolder: string;
  sourceRegistry: Record<string, string>; // sourceId → original vault file path
}

const DEFAULT_SETTINGS: NotebookLMSettings = {
  auth: null,
  pullFolder: "NotebookLM",
  sourceRegistry: {},
};

export default class NotebookLMPlugin extends Plugin {
  settings!: NotebookLMSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new NotebookLMSettingsTab(this.app, this));

    this.addRibbonIcon("book-open", "NotebookLM Sync", () => {
      if (!this.settings.auth) {
        new Notice("Connect your Google account in NotebookLM Sync settings first");
        return;
      }
      new SyncModal(this.app, this).open();
    });

    this.addCommand({
      id: "push-to-notebooklm",
      name: "Push notes to NotebookLM",
      callback: () => {
        if (!this.requireAuth()) return;
        new SyncModal(this.app, this).open();
      },
    });

    this.addCommand({
      id: "pull-from-notebooklm",
      name: "Pull from NotebookLM",
      callback: () => {
        if (!this.requireAuth()) return;
        new PullModal(this.app, this).open();
      },
    });
  }

  onunload() {}

  private requireAuth(): boolean {
    if (!this.settings.auth) {
      new Notice("Connect your Google account in NotebookLM Sync settings first");
      return false;
    }
    return true;
  }

  private getSession(): HttpRpcSession {
    if (!this.settings.auth) throw new Error("Not authenticated");
    return new HttpRpcSession(storedAuthToTokens(this.settings.auth));
  }

  private async withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof NotebookLMAuthError) {
        // Only clear auth if it looks like a genuine token expiry (not a transient 401)
        // For now surface the error without clearing, so users don't have to re-authenticate
        // on every network hiccup
        new Notice("NotebookLM request failed — if this persists, reconnect in settings");
      }
      throw e;
    }
  }

  async getNotebooks(): Promise<NlmNotebook[]> {
    return this.withAuthRetry(() => new NotebooksApi(this.getSession()).list());
  }

  async createNotebook(title: string): Promise<NlmNotebook> {
    return this.withAuthRetry(() => new NotebooksApi(this.getSession()).create(title));
  }

  async listSources(notebookId: string): Promise<NlmSource[]> {
    return this.withAuthRetry(() => new SourcesApi(this.getSession()).list(notebookId));
  }

  async addTextSource(notebookId: string, title: string, content: string): Promise<NlmSource> {
    return this.withAuthRetry(() =>
      new SourcesApi(this.getSession()).addText(notebookId, title, content)
    );
  }

  async getSourceFulltext(notebookId: string, sourceId: string): Promise<SourceFulltext> {
    return this.withAuthRetry(() =>
      new SourcesApi(this.getSession()).getFulltext(notebookId, sourceId)
    );
  }

  async deleteSource(notebookId: string, sourceId: string): Promise<void> {
    return this.withAuthRetry(() =>
      new SourcesApi(this.getSession()).delete(notebookId, sourceId)
    );
  }

  async listNotes(notebookId: string): Promise<NlmNote[]> {
    return this.withAuthRetry(() => new NotesApi(this.getSession()).list(notebookId));
  }

  async clearAllSyncMetadata() {
    const files = this.app.vault.getMarkdownFiles();
    let cleared = 0;
    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        const { sourceId } = parseSyncMeta(content);
        if (sourceId) {
          await this.app.vault.modify(file, stripFrontmatter(content));
          cleared++;
        }
      } catch (e) {
        new Notice(`Could not clear metadata from ${file.name}: ${(e as Error).message}`);
      }
    }
    if (cleared > 0) new Notice(`Cleared sync metadata from ${cleared} note${cleared !== 1 ? "s" : ""}`);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
