# crow CLI

A zero-dependency command-line interface to the Crow desktop app, built for
scripts and AI agents. Every command takes the path of a `.crow` document —
the same files the app opens and saves — so it works whether or not the app is
running, and when the document **is** open, the app notices the file changed
and shows the CLI's edits immediately.

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

> You can manage my Crow documents (`.crow` files) with `node /path/to/crow/cli/crow.mjs`.
> Run it with `help` first to learn the commands. All output is JSON.

The help text documents every command, the value format for each field type,
and examples, so it works as a self-contained tool description (e.g. for a
custom tool/MCP wrapper or a `CLAUDE.md` / `AGENTS.md` snippet).

## Commands

| Command | Purpose |
| --- | --- |
| `create-project <file.crow> [--fields JSON] [--table NAME]` | Create a new document with one table |
| `schema <file.crow> [--table NAME]` | Fields, choices, views, record count |
| `list-tables <file.crow>` | List the project's tables |
| `create-table <file.crow> <name> [--fields JSON]` | Add a table |
| `rename-table <file.crow> <table> --to <new-name>` | Rename a table |
| `delete-table <file.crow> <table> --yes` | Delete a table (requires `--yes`) |
| `add-field <file.crow> <name> <type> [--choices "A,B,C"] [--link-table NAME]` | Add a field |
| `delete-field <file.crow> <name>` | Remove a field everywhere |
| `list-records <file.crow> [--where JSON] [--limit N] [--offset N]` | Query records |
| `get-record <file.crow> <record-id>` | Show one record |
| `add-record <file.crow> <values-json>` | Create one record (or an array of them) |
| `update-record <file.crow> <record-id> <values-json>` | Merge values into a record |
| `delete-record <file.crow> <record-id>` | Delete a record |

Documents are referenced by file path; record ids accept unique prefixes.
Record values are keyed by **field name**, with select/multi-select choices
referenced by **choice name** (unknown choices are created automatically):

```bash
crow add-record tasks.crow '{"Name":"Buy milk","Status":"Todo","Due":"2026-08-10"}'
crow list-records tasks.crow --where '{"Status":"Todo"}' --limit 20
crow update-record tasks.crow 3f2a '{"Status":"Done"}'
```

## Tables

A document holds one or more tables, each with its own fields, records and
views. Every field/record command takes `--table <name or id>`; it can be
omitted when the document has a single table, and is **required** once it has
several — rather than guess, the CLI refuses and lists the tables, so a script
can't silently write into the wrong one.

```bash
crow create-table tasks.crow People --fields '[{"name":"Name","type":"text"}]'
crow add-record tasks.crow '{"Name":"Ada"}' --table People
crow list-records tasks.crow --table People
```

## Linking tables

A `relation` field links records to records in another table of the same
project (or in its own — sub-tasks, replies). `--link-table` names the target,
and `--single` limits a cell to one link:

```bash
crow add-field tasks.crow Owner relation --link-table People --single
crow add-record tasks.crow '{"Name":"Ship 1.0","Owner":"Ada"}'
```

Links are written by record id or by the text of the linked record's first
field (`"Ada"` above), and read back as those names. A `--fields` spec says the
same thing as `{"name":"Owner","type":"relation","linkTable":"People","multiple":false}`.

Documents saved before multi-table support are read as a single table named
after the project; the file itself is upgraded the next time it's written.

## How it writes

A `.crow` document is a folder holding `data.json` and its media, and the CLI
edits it in place: media files are copied into the document's folders, then
`data.json` is replaced atomically (written beside it, then renamed). You can
pass the document folder or the `data.json` inside it.

Single-file `.crow` exports from before version 3 aren't read — open one in
the app once and it's converted.
