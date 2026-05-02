# Obsidian NotebookLM Plugin — Design

**Date:** 2026-05-02

## Overview

A self-contained Obsidian plugin (TypeScript, no Python dependency at runtime) for two-way selective sync between an Obsidian vault and Google NotebookLM notebooks.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| API layer | TypeScript reimplementation of batchexecute RPC | Self-contained, no Python runtime needed |
| Authentication | Embedded OAuth via Electron BrowserWindow | Seamless UX, no manual cookie copying |
| Push unit | Multi-select modal + whole-folder option | Flexible for both targeted and bulk sync |
| Pull structure | `NotebookLM/<notebook-title>/<source-title>.md` | Clean vault organisation |
| Conflict resolution | Keep both — create `title (NotebookLM YYYY-MM-DD).md` | No data loss |
| State tracking | Frontmatter on each note | Source of truth for sync state |

---

## Architecture

```
obsidian-notebooklm/
├── src/
│   ├── main.ts                    # Plugin entry, commands, ribbon
│   ├── auth.ts                    # Electron OAuth flow + cookie storage
│   ├── api/
│   │   ├── client.ts              # batchexecute RPC client
│   │   ├── notebooks.ts           # list, create notebook
│   │   └── sources.ts             # list, add, delete, get-fulltext
│   ├── sync/
│   │   ├── push.ts                # push notes → NotebookLM sources
│   │   └── pull.ts                # pull sources → Obsidian notes
│   └── ui/
│       ├── SyncModal.ts           # file multi-select + folder picker
│       ├── NotebookPickerModal.ts
│       └── SettingsTab.ts
├── manifest.json
└── package.json
```

### Vault Structure (pulled content)

```
NotebookLM/
├── My Research Notebook/
│   ├── Source One.md
│   └── Source Two.md
└── Project Notes/
    └── Some Article.md
```

Notes pushed from elsewhere in the vault stay in their original location — frontmatter tracks the link back to the notebook/source.

---

## Frontmatter Schema

On push, the plugin writes to each synced note:

```yaml
---
notebooklm_source_id: abc123
notebooklm_notebook_id: xyz789
notebooklm_synced_hash: <sha256 of content at last sync>
---
```

This enables:
- In-place updates on pull (match by `notebooklm_source_id`)
- Conflict detection (compare current content hash vs `notebooklm_synced_hash`)

---

## Authentication

1. User clicks "Connect Google Account" in settings
2. Electron `BrowserWindow` opens at `accounts.google.com`
3. User completes normal Google login
4. Window navigates to `notebooklm.google.com`
5. Plugin captures cookies via `session.cookies.get({ domain: '.google.com' })`
6. Key cookies stored: `__Secure-1PSID`, `__Secure-1PSIDTS`, `SID`, `HSID`, `SSID`, `APISID`, `SAPISID`
7. Stored in plugin's `data.json`; `BrowserWindow` closes

Every API request sends cookies as a `Cookie:` header plus a computed `Authorization: SAPISIDHASH` (HMAC-SHA1 of timestamp + origin + `SAPISID`).

On 401/403 response, plugin shows "Session expired — reconnect" notice and re-triggers the OAuth flow.

---

## API Layer

Seven batchexecute RPC methods reimplemented in TypeScript:

| Method | Purpose |
|--------|---------|
| `ListNotebooks` | List all user notebooks |
| `CreateNotebook` | Create new notebook |
| `ListSources` | List sources in a notebook |
| `AddTextSource` | Push a note's markdown content (primary push method) |
| `GetSourceFulltext` | Pull source content back |
| `DeleteSource` | Remove source (on re-push / cleanup) |
| `StartResumableUpload` + upload | Push binary/non-markdown files |

**Request format:**
```
POST https://notebooklm.google.com/_/NotebookLmUi/data/batchexecute
Content-Type: application/x-www-form-urlencoded

f.req=[[["{methodId}","{jsonEncodedParams}",null,"1"]]]
```

**Response parsing:** strip `)]}'\n` prefix → parse outer JSON envelope → decode nested escaped JSON payload.

Most pushes use `AddTextSource` (markdown text). `StartResumableUpload` only needed for binary files selected via the folder picker.

---

## Sync Logic

### Push

```
User opens "Push to NotebookLM"
  → SyncModal opens
      ├── Folder picker: sync all .md files in a vault folder
      └── File tree: manually check individual notes
  → User picks target notebook (existing or + Create new)
  → For each selected note:
      ├── Has notebooklm_source_id?
      │     → Delete old source, AddTextSource → update frontmatter hash
      └── No source ID?
            → AddTextSource → write source ID, notebook ID, hash to frontmatter
```

### Pull

```
User opens "Pull from NotebookLM"
  → NotebookPickerModal: select notebook
  → ListSources → show source list with checkboxes
      ├── ↺  sources whose ID matches a local note's frontmatter
      └── NEW sources with no local match
  → For each selected source:
      ├── Matches local note frontmatter?
      │     ├── Local hash == stored hash (unmodified)?
      │     │     → Overwrite note in place, update hash
      │     └── Local hash != stored hash (conflict)?
      │           → Create "title (NotebookLM YYYY-MM-DD).md" alongside original
      │             Leave original untouched
      └── No local match?
            → Create NotebookLM/<notebook-title>/<source-title>.md
              Write source ID, notebook ID, hash to frontmatter
```

---

## UI

### Ribbon
Notebook icon → quick-action menu: **Push notes** / **Pull from notebook** / **Settings**

### SyncModal (push)
```
┌─ Push to NotebookLM ──────────────────────┐
│ Target notebook: [My Research    ▾] [+ New]│
│                                            │
│ ○ Sync folder:  [/Research/      ▾]        │
│ ● Select files:                            │
│   ☑ Research/paper-notes.md               │
│   ☑ Research/interview.md                 │
│   ☐ Research/todo.md                      │
│                                            │
│              [Cancel]  [Push 2 notes →]   │
└────────────────────────────────────────────┘
```

### PullModal
```
┌─ Pull from NotebookLM ────────────────────┐
│ Notebook: [My Research           ▾]        │
│                                            │
│   ☑ paper-notes (pushed from vault)  ↺    │
│   ☑ Some Web Article              NEW     │
│   ☐ PDF Upload                    NEW     │
│                                            │
│              [Cancel]  [← Pull 2 sources] │
└────────────────────────────────────────────┘
```

### Settings Tab
- Google account connection (Connect / Disconnect button + account email when connected)
- Pull folder (default: `NotebookLM/`)
- Auto-prefix for pulled notes (optional, e.g. `[NLM]`)
- Clear all sync metadata (bulk frontmatter cleanup)
