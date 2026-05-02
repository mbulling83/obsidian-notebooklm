import { Plugin } from "obsidian";

export default class NotebookLMPlugin extends Plugin {
  async onload() {
    console.log("NotebookLM Sync loaded");
  }
  onunload() {}
}
