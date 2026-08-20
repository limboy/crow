# Crow

![](screenshot.webp)

A lite Airtable-style desktop app built with Electron. Create multiple projects, each holding one or more tables with their own fields, records, and views.

- **Table view** — show/hide fields, filter rules, multi-sort, group by field, inline cell editing
- **Kanban view** — group by any single-select field, drag cards between columns
- **Gallery view** — pick any image field as the card cover
- **Field types** — text, number, single select, multi select, date, checkbox, URL, image (local file or URL), audio, link to records
- **Linked records** — a `relation` field points a table's rows at rows in another table of the same project (Articles → Comments), single or multiple links per cell
- **Multiple tables** — switch between a project's tables from the header; each keeps its own schema and views
- **Import / export** — move a whole project (its tables, records, views, and images/audio) between machines as a single `.crow` file

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

`cli/crow.mjs` is a zero-dependency CLI that lets scripts and AI agents read and write projects — see [cli/README.md](cli/README.md). It edits the same JSON files the app uses, and the app picks up external changes live via a file watcher. Run `node cli/crow.mjs help` for the full agent-oriented reference, or `npm link` to get a global `crow` command.

## Import / export

Right-click a project in the sidebar and choose **Export…** to write it to a
single `.crow` file — plain JSON holding the project plus every image and audio
file it owns, base64-encoded, so the export is self-contained. The **+** button
above the project list offers **Import project…**, which reads a `.crow` file
back in as a new project with a fresh id: importing the same file twice gives
you two independent copies rather than overwriting anything.

A `.crow` file is plain JSON, so scripts and agents can generate one directly —
[docs/crow-format.md](docs/crow-format.md) documents the whole format, with a
minimal importable example and a Node generator.

## Data

Projects are stored as JSON files in Electron's `userData` directory (`~/Library/Application Support/crow/projects/` on macOS). Locally picked images are copied to `userData/images/` and served through a custom `app-image://` protocol. A demo project is seeded on first launch.
