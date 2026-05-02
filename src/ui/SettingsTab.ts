import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type NotebookLMPlugin from "../main";
import { runOAuthFlow } from "../auth";

export class NotebookLMSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: NotebookLMPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "NotebookLM Sync" });

    const auth = this.plugin.settings.auth;

    new Setting(containerEl)
      .setName("Google account")
      .setDesc(auth ? `Connected (${new Date(auth.connectedAt).toLocaleDateString()})` : "Not connected")
      .addButton((btn) => {
        btn.setButtonText(auth ? "Disconnect" : "Connect Google Account")
          .setCta()
          .onClick(async () => {
            if (auth) {
              this.plugin.settings.auth = null;
              await this.plugin.saveSettings();
              this.display();
            } else {
              try {
                this.plugin.settings.auth = await runOAuthFlow();
                await this.plugin.saveSettings();
                new Notice("Connected to NotebookLM");
                this.display();
              } catch (e) {
                new Notice(`Connection failed: ${(e as Error).message}`);
              }
            }
          });
      });

    new Setting(containerEl)
      .setName("Pull folder")
      .setDesc("Vault folder where pulled sources are saved")
      .addText((text) =>
        text
          .setPlaceholder("NotebookLM")
          .setValue(this.plugin.settings.pullFolder)
          .onChange(async (value) => {
            this.plugin.settings.pullFolder = value || "NotebookLM";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Clear sync metadata")
      .setDesc("Remove notebooklm_ frontmatter from all notes in the vault")
      .addButton((btn) =>
        btn.setButtonText("Clear all").setWarning().onClick(async () => {
          await this.plugin.clearAllSyncMetadata();
          new Notice("Sync metadata cleared from all notes");
        })
      );
  }
}
