# NotebookLM Sync

An [Obsidian](https://obsidian.md) plugin for two-way selective sync between your vault and [Google NotebookLM](https://notebooklm.google.com).

## Features

- **Push notes to NotebookLM** — search your vault, select notes, and push them as sources to any notebook. Creates a new notebook on the fly if needed.
- **Pull sources back** — pull NotebookLM sources back into your vault as Markdown files, with conflict detection when both sides have changed.
- **Pull AI notes** — pull NotebookLM's generated notes into a dedicated folder in your vault.
- **Sync tracking** — pushed notes get frontmatter metadata (`notebooklm_source_id`, `notebooklm_notebook_id`, `notebooklm_hash`) so the plugin can detect updates and conflicts on subsequent syncs.
- **Source backlinks** — when a pulled source was originally pushed from your vault, the plugin prepends a `[[wikilink]]` back to the original note.

## Requirements

- Obsidian 1.4.0 or later (desktop only)
- A Google account with access to NotebookLM

## Installation

This plugin is not yet listed in the Obsidian Community Plugins directory. To install manually:

1. Build the plugin (see [Development](#development)).
2. Copy `main.js`, `manifest.json`, and `styles.css` to `<your-vault>/.obsidian/plugins/notebooklm-sync/`.
3. Enable the plugin in **Settings → Community Plugins**.

## Setup

1. Open **Settings → NotebookLM Sync**.
2. Click **Connect Google Account** and complete the OAuth flow in your browser.
3. Optionally change the **Pull folder** (default: `NotebookLM`) where pulled content is saved.

## Usage

### Push notes

1. Click the **book** icon in the ribbon, or run the command **Push notes to NotebookLM**.
2. Select a target notebook from the dropdown (or create a new one).
3. Search your vault and click notes to select them.
4. Click **Push N notes →**.

### Pull sources and notes

1. Run the command **Pull from NotebookLM**.
2. Select a notebook.
3. Toggle the sources or notes you want to pull.
4. Click **Pull selected**.

Pulled files land in `<Pull folder>/<Notebook title>/` for sources and `<Pull folder>/<Notebook title>/notes/` for AI notes.

### Conflict handling

When pulling a source that already exists in your vault and both the local file and the NotebookLM source have changed since the last sync, the plugin creates a conflict copy named `<original> (conflict YYYY-MM-DD HH-MM-SS).md` alongside the original rather than overwriting it.

### Clear sync metadata

**Settings → NotebookLM Sync → Clear all** strips `notebooklm_*` frontmatter from every note in your vault, effectively unlinking them from NotebookLM without deleting anything.

## Development

```bash
npm install
npm run dev      # watch mode
npm run build    # production build
npm test         # run tests
```

The plugin is written in TypeScript and bundled with esbuild. Tests use Vitest.

## License

MIT
