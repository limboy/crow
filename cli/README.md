# crow CLI

A zero-dependency command-line interface to the Crow desktop app, built for
scripts and AI agents. It reads and writes the same JSON project files the app
uses, so it works whether or not the app is running — and when the app **is**
open, a file watcher makes CLI changes appear in the UI immediately.

## Setup

No install needed — run it with Node (>= 18):

```bash
node cli/crow.mjs help
```

Or link it as a global `crow` command:

```bash
npm link
```

## Pointing an AI agent at it

Tell the agent where the CLI lives and let it discover the rest itself:

> You can manage my Crow projects with `node /path/to/crow/cli/crow.mjs`.
> Run it with `help` first to learn the commands. All output is JSON.

The help text documents every command, the value format for each field type,
and examples, so it works as a self-contained tool description (e.g. for a
custom tool/MCP wrapper or a `CLAUDE.md` / `AGENTS.md` snippet).

## Commands

| Command | Purpose |
| --- | --- |
| `list-projects` | List all projects |
| `create-project <name> [--fields JSON] [--table NAME]` | Create a project with one table |
| `delete-project <project> --yes` | Delete a project (requires `--yes`) |
| `schema <project> [--table NAME]` | Fields, choices, views, record count |
| `list-tables <project>` | List the project's tables |
| `create-table <project> <name> [--fields JSON]` | Add a table |
| `rename-table <project> <table> --to <new-name>` | Rename a table |
| `delete-table <project> <table> --yes` | Delete a table (requires `--yes`) |
| `add-field <project> <name> <type> [--choices "A,B,C"]` | Add a field |
| `delete-field <project> <name>` | Remove a field everywhere |
| `list-records <project> [--where JSON] [--limit N] [--offset N]` | Query records |
| `get-record <project> <record-id>` | Show one record |
| `add-record <project> <values-json>` | Create one record (or an array of them) |
| `update-record <project> <record-id> <values-json>` | Merge values into a record |
| `delete-record <project> <record-id>` | Delete a record |
| `info` | Show the resolved data directory |

Projects can be referenced by name or id; record ids accept unique prefixes.
Record values are keyed by **field name**, with select/multi-select choices
referenced by **choice name** (unknown choices are created automatically):

```bash
crow add-record "My Tasks" '{"Name":"Buy milk","Status":"Todo","Due":"2026-08-10"}'
crow list-records "My Tasks" --where '{"Status":"Todo"}' --limit 20
crow update-record "My Tasks" 3f2a '{"Status":"Done"}'
```

## Tables

A project holds one or more tables, each with its own fields, records and
views. Every field/record command takes `--table <name or id>`; it can be
omitted when the project has a single table, and is **required** once it has
several — rather than guess, the CLI refuses and lists the tables, so a script
can't silently write into the wrong one.

```bash
crow create-table "My Tasks" People --fields '[{"name":"Name","type":"text"}]'
crow add-record "My Tasks" '{"Name":"Ada"}' --table People
crow list-records "My Tasks" --table People
```

Projects saved before multi-table support are read as a single table named
after the project; the file itself is upgraded the next time it's written.

## Data location

By default the CLI uses the app's own data directory
(`~/Library/Application Support/crow` on macOS). Override with the
`CROW_DIR` environment variable or `--data-dir` — handy for testing
against a scratch directory without touching real data.
