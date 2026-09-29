# Crow

![](screenshot.webp)

A lite Airtable-style desktop app built with Electron. It works like a document-based database app: each `.crow` file is one database, holding one or more tables with their own fields, records, and views. Open a file, edit it, and it's saved back to that file.

- **Table view** — show/hide fields, filter rules, multi-sort, group by field, inline cell editing
- **Kanban view** — group by any single-select field, drag cards between columns
- **Gallery view** — pick any image field as the card cover
- **Dashboard view** — compose charts from the table's own records: counts, sums and averages as numbers, bars, columns, lines or donuts
- **Field types** — text, number, single select, multi select, date, checkbox, URL, rating (1–5 stars), image (local file or URL), audio, attachment (any files, opened with the OS default app), link to records
- **Linked records** — a `relation` field points a table's rows at rows in another table of the same project (Articles → Comments), single or multiple links per cell
- **Multiple tables** — switch between a document's tables from the header; each keeps its own schema and views
- **Self-contained files** — a `.crow` file carries its tables, records, views, and every image, audio clip, video and attachment, so it can be copied, backed up, or shared like any other file

## Download

Download the latest macOS (Apple Silicon) build from the [Releases page](https://github.com/limboy/crow/releases/latest).

## Stack

Electron (electron-vite) · React · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui · TanStack Query · dnd-kit

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Agent CLI

`cli/crow.mjs` is a zero-dependency CLI that lets scripts and AI agents read and write `.crow` documents — see [cli/README.md](cli/README.md). If a document is open in the app while the CLI edits it, the app picks up the change live. Run `node cli/crow.mjs help` for the full agent-oriented reference, or `npm link` to get a global `crow` command.

## Documents

**File → New…** asks where to create a `.crow` document and opens it;
**Open…** (or double-clicking one) opens an existing one. Each document gets
its own window, and every edit is written straight into the document — there's
nothing to save. **Save As…** copies it somewhere new and carries on there.

A `.crow` document is a folder — shown by macOS as a single file — holding a
plain-JSON `data.json` plus every image, audio clip, video and attachment it
uses, each stored as itself (right-click → **Show Package Contents** to look
inside). Copy, back up, sync or share it like any other file. Scripts and
agents can generate one directly: [docs/crow-format.md](docs/crow-format.md)
documents the whole format, with a minimal example and a Node generator.

Single-file `.crow` exports from earlier versions still open: Crow converts
them to the folder format in place and keeps the original as `<name>.crow.zip`.

### Upgrading from 2.x

Earlier versions kept every project in one app-managed data folder. On first
launch the welcome window offers **Export as .crow Files…**, which copies each
of those projects into a folder you pick as a `.crow` document, then renames
the old data folder to `projects-exported` (it isn't deleted).
