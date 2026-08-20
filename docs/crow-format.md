# The `.crow` file format

A `.crow` file is one project — its tables, their schemas, records and views,
and every image/audio file it owns — in a single UTF-8 JSON document. It's what
**Export…** writes and **Import project…** reads, and it's plain JSON on
purpose: you can generate one from any language without linking against the
app.

This page documents the format well enough to write a generator. If you'd rather
mutate an existing project than build one from scratch, `cli/crow.mjs` already
speaks a friendlier, name-based dialect — see [cli/README.md](../cli/README.md).

## The envelope

```json
{
  "format": "crow-project",
  "version": 2,
  "exportedAt": "2026-08-20T09:15:00.000Z",
  "project": { "…": "see below" },
  "assets": []
}
```

| Key | Required | Notes |
| --- | --- | --- |
| `format` | yes | Must be exactly `"crow-project"`, or the import is refused. |
| `version` | yes | Format version. The app accepts anything `<= 2` and refuses newer. |
| `exportedAt` | no | ISO-8601 timestamp; informational only. |
| `project` | yes | The project itself (below). |
| `assets` | no | Base64 media (below). Omit or use `[]` when there's none. |

Version 1 put a single table's `fields`, `records` and `views` directly on the
`project`. Those files still import — they become a project with one table,
named after the project — but write version 2 in anything new.

Import validates only the envelope and that `project` has a string `name` plus
either a `tables` array or (for version 1) array `fields`, `records`, and
`views`. Everything past that is trusted, so a malformed field type or a record
pointing at a missing field id won't be caught at import time — it just renders
as empty. Get it right in the generator.

## `project`

```json
{
  "id": "6f7a1c1e-6c1e-4c4a-9f0e-3a0b6a2f8d11",
  "name": "Reading List",
  "createdAt": "2026-08-20T09:00:00.000Z",
  "updatedAt": "2026-08-20T09:00:00.000Z",
  "tables": []
}
```

| Key | Required | Notes |
| --- | --- | --- |
| `id` | yes | Any string matching `^[a-zA-Z0-9-]+$` — a UUID by convention. **Import replaces it** with a fresh id, so pick anything unique; it only has to match the `app-image:///<id>/…` urls inside the same file. |
| `name` | yes | Shown in the sidebar. Trimmed; falls back to `Untitled` if blank. |
| `icon` | no | Reserved — carried through saves but not rendered yet. |
| `createdAt` | yes | ISO-8601. Preserved on import. |
| `updatedAt` | yes | ISO-8601. Overwritten with the import time. |
| `tables` | yes | The project's tables (below). A project needs at least one; they show as tabs in the app's header, in array order. |

## `tables`

```json
{
  "id": "tbl-books",
  "name": "Books",
  "fields": [],
  "records": [],
  "views": []
}
```

| Key | Required | Notes |
| --- | --- | --- |
| `id` | yes | Unique within the project. |
| `name` | yes | The tab label. |
| `fields` | yes | Column definitions. |
| `records` | yes | Rows. |
| `views` | yes | Saved table/kanban/gallery/calendar configurations. |

**Tables reference each other in exactly one place: `relation` fields.** Field,
record, choice and view ids only have to be unique *within* their own table;
the only ids that cross a table boundary are a relation field's `tableId` and
the record ids it stores (see [`relation` fields](#relation-fields) below).
Media is the other shared thing: images and audio live in a single per-project
folder, so any table can use any of them.

Ids for fields, records, choices, tables and views are opaque strings — anything
unique within the table works. Only the **project** id is constrained by the
`^[a-zA-Z0-9-]+$` pattern, because it becomes a directory name on disk.

## `fields`

```json
{
  "id": "fld-title",
  "name": "Title",
  "type": "text"
}
```

`type` is one of:

| `type` | Stored value in a record |
| --- | --- |
| `text` | string |
| `number` | JSON number (a numeric string is treated as empty) |
| `select` | the **choice id** (not its name) |
| `multiSelect` | array of choice ids |
| `date` | `"YYYY-MM-DD"` string — date only, no time, no timezone |
| `checkbox` | `true`; anything else counts as unchecked |
| `url` | string |
| `image` | an `app-image:///<projectId>/<file>` url, or any external `http(s)` url |
| `audio` | an `app-audio:///<projectId>/<file>` url, or any external `http(s)` url |
| `relation` | array of **record ids** from another table in the same project |

`select` and `multiSelect` fields carry their choices inline:

```json
{
  "id": "fld-status",
  "name": "Status",
  "type": "select",
  "options": {
    "choices": [
      { "id": "ch-todo",  "name": "Todo",  "color": "gray" },
      { "id": "ch-doing", "name": "Doing", "color": "blue" },
      { "id": "ch-done",  "name": "Done",  "color": "green" }
    ]
  }
}
```

`color` must be one of `gray`, `red`, `orange`, `amber`, `green`, `teal`,
`blue`, `indigo`, `purple`, `pink`. Choice **order** is meaningful: it sets the
column order in kanban and the sort order when sorting by that field.

> This is the one place the raw format differs sharply from the CLI. `crow
> add-record` lets you write `"Status": "Todo"` and resolves the name for you;
> a `.crow` file must contain the choice **id**, and a value that matches no
> choice renders as empty.

### `relation` fields

A relation field links records to records in another table of the same project
— an Articles row pointing at its Comments, say. It carries a `relation` key
naming that table:

```json
{
  "id": "fld-comments",
  "name": "Comments",
  "type": "relation",
  "relation": { "tableId": "tbl-comments", "multiple": true }
}
```

| Key | Required | Notes |
| --- | --- | --- |
| `tableId` | yes | A `tables[].id` **in the same project**. A table may link to itself (sub-tasks, replies). A field pointing at a table that isn't there renders as empty. |
| `multiple` | yes | `true` lets a cell hold several links; `false` caps it at one. Only the editor enforces it — the stored value is an array either way. |

The stored value is **always an array of record ids**, even for a single link:

```json
{ "fld-comments": ["rec-c1", "rec-c2"] }
```

Order is the link order and is preserved. An id that matches no record in the
linked table is simply skipped when rendering (deleting a record doesn't go
hunting for links to it), so a half-written generator degrades to an empty
cell rather than an error. A cell shows each linked record by the text of its
table's **first field**; that first field can itself be a relation, which
isn't followed — such a row just reads `Untitled`.

Relations survive export/import: only the project id is rewritten on the way
in, so record ids — and the links pointing at them — stay as they are. Builds
of the app older than relation support read such a file without complaint and
render those cells as empty, which is why the format version stays at 2.

## `records`

```json
{
  "id": "rec-1",
  "createdAt": "2026-08-20T09:00:00.000Z",
  "values": {
    "fld-title": "Дом, in which…",
    "fld-status": "ch-doing",
    "fld-tags": ["ch-fiction", "ch-long"],
    "fld-due": "2026-09-01",
    "fld-done": false,
    "fld-cover": "app-image:///6f7a1c1e-6c1e-4c4a-9f0e-3a0b6a2f8d11/cover.png"
  }
}
```

`values` is keyed by **field id**, from the same table. Omit a key (or use
`null`) for an empty cell — there's no requirement that every record carry every
field. Keys that match no field are kept on disk but ignored by the app, and `createdAt` is what a Calendar
view falls back to when it has no date field selected.

## `views`

Every view is `{ id, name, type, config }`, and belongs to the table that holds
it. A table with no views opens on an empty state, so include at least one. Each `type` takes its own `config`:

```json
[
  {
    "id": "vw-table",
    "name": "All books",
    "type": "table",
    "config": {
      "hiddenFieldIds": [],
      "filters": [],
      "sorts": [{ "fieldId": "fld-due", "direction": "asc" }],
      "rowHeight": "short"
    }
  },
  {
    "id": "vw-board",
    "name": "Board",
    "type": "kanban",
    "config": { "groupByFieldId": "fld-status", "hiddenFieldIds": [] }
  },
  {
    "id": "vw-covers",
    "name": "Covers",
    "type": "gallery",
    "config": { "coverFieldId": "fld-cover", "hiddenFieldIds": [] }
  },
  {
    "id": "vw-cal",
    "name": "Calendar",
    "type": "calendar",
    "config": { "dateFieldId": "fld-due", "hiddenFieldIds": [], "mode": "month" }
  }
]
```

| Config key | Views | Notes |
| --- | --- | --- |
| `hiddenFieldIds` | all | Required (use `[]`). Field ids to hide. |
| `filters` | table | `{ id, fieldId, operator, value? }`. Operators: `contains`, `notContains`, `is`, `isNot`, `isEmpty`, `isNotEmpty`, `gt`, `lt` — a rule whose operator doesn't apply to the field's type is ignored. `value` holds a choice id for `select`/`multiSelect`, a `YYYY-MM-DD` string for dates. |
| `sorts` | table | `{ fieldId, direction }` with `direction` of `asc` or `desc`. Applied in order; empty values always sink to the bottom. |
| `groupByFieldId` | table, kanban | Kanban wants a `select` field — without one the board has nothing to lay out. |
| `rowHeight` | table | `short` (default), `medium`, or `tall`. |
| `columnWidths` | table | `{ "<fieldId>": 220 }` in pixels; unset fields use the default width. |
| `coverFieldId` | gallery | An `image` field id. |
| `dateFieldId` | calendar | A `date` field id, or the sentinel `"__createdAt__"` to place records by their creation time. |
| `mode` | calendar | `month` (default) or `week`. |

## `assets`

Local images and audio ride along base64-encoded, which is what makes an export
self-contained:

```json
{
  "kind": "image",
  "name": "cover.png",
  "data": "iVBORw0KGgoAAAANSUhEUgAA…"
}
```

- `kind` is `image` or `audio`; anything else is filed as an image.
- `name` is a bare file name — no directories. Names containing `/` or `\`, or
  starting with `.`, are skipped on import, so `../../evil.png` can't escape the
  project folder. The extension matters (it's what the browser sniffs); the stem
  doesn't, though the app itself uses UUIDs to avoid collisions.
- `data` is standard base64 of the raw file bytes, no data-url prefix.
- A record references an asset by url, not by index:
  `app-image:///<projectId>/<name>` (or `app-audio:///…`). The `<projectId>`
  **must match `project.id` in the same file**.

Assets that nothing references are still imported — harmless, and it means an
export never silently drops a file.

## What import changes

Given a bundle, the app:

1. Generates a **new project id**, so importing the same file twice yields two
   independent projects instead of overwriting the first.
2. Rewrites every `app-image:///<oldId>/` and `app-audio:///<oldId>/` prefix in
   the project to the new id. External `http(s)` urls are left alone.
3. Writes each asset to `<dataDir>/projects/<newId>/images|audio/<name>`.
4. Sets `updatedAt` to now, keeps `createdAt`.

Because of step 2, the project id you use while generating is arbitrary — it
just has to be internally consistent with your asset urls.

## A complete minimal file

Valid, importable, and about as small as a useful project gets:

```json
{
  "format": "crow-project",
  "version": 1,
  "project": {
    "id": "generated-import",
    "name": "Reading List",
    "createdAt": "2026-08-20T09:00:00.000Z",
    "updatedAt": "2026-08-20T09:00:00.000Z",
    "fields": [
      { "id": "fld-title", "name": "Title", "type": "text" },
      {
        "id": "fld-status",
        "name": "Status",
        "type": "select",
        "options": {
          "choices": [
            { "id": "ch-todo", "name": "Todo", "color": "gray" },
            { "id": "ch-done", "name": "Done", "color": "green" }
          ]
        }
      }
    ],
    "records": [
      {
        "id": "rec-1",
        "createdAt": "2026-08-20T09:00:00.000Z",
        "values": { "fld-title": "The Dispossessed", "fld-status": "ch-todo" }
      }
    ],
    "views": [
      {
        "id": "vw-table",
        "name": "Table",
        "type": "table",
        "config": { "hiddenFieldIds": [], "filters": [], "sorts": [], "rowHeight": "short" }
      },
      {
        "id": "vw-board",
        "name": "Board",
        "type": "kanban",
        "config": { "groupByFieldId": "fld-status", "hiddenFieldIds": [] }
      }
    ]
  },
  "assets": []
}
```

## Generating one in Node

The whole job is building an object and writing it out. This turns a CSV-ish
array into a project with a select field and one local image:

```js
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const projectId = randomUUID()
const now = new Date().toISOString()

const rows = [
  { title: 'The Dispossessed', status: 'Done' },
  { title: 'Piranesi', status: 'Todo' }
]

// One choice per distinct value, ids generated up front so records can point at them.
const palette = ['gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink']
const choices = [...new Set(rows.map((r) => r.status))].map((name, i) => ({
  id: randomUUID(),
  name,
  color: palette[i % palette.length]
}))
const choiceId = Object.fromEntries(choices.map((c) => [c.name, c.id]))

const titleField = { id: randomUUID(), name: 'Title', type: 'text' }
const statusField = { id: randomUUID(), name: 'Status', type: 'select', options: { choices } }
const coverField = { id: randomUUID(), name: 'Cover', type: 'image' }

const bundle = {
  format: 'crow-project',
  version: 1,
  exportedAt: now,
  project: {
    id: projectId,
    name: 'Reading List',
    createdAt: now,
    updatedAt: now,
    fields: [titleField, statusField, coverField],
    records: rows.map((row) => ({
      id: randomUUID(),
      createdAt: now,
      values: {
        [titleField.id]: row.title,
        [statusField.id]: choiceId[row.status],
        // Points at the asset below; the app remaps the id half on import.
        [coverField.id]: `app-image:///${projectId}/cover.png`
      }
    })),
    views: [
      {
        id: randomUUID(),
        name: 'Table',
        type: 'table',
        config: { hiddenFieldIds: [], filters: [], sorts: [], rowHeight: 'short' }
      },
      {
        id: randomUUID(),
        name: 'Board',
        type: 'kanban',
        config: { groupByFieldId: statusField.id, hiddenFieldIds: [] }
      }
    ]
  },
  assets: [
    { kind: 'image', name: 'cover.png', data: readFileSync('cover.png').toString('base64') }
  ]
}

writeFileSync('reading-list.crow', JSON.stringify(bundle, null, 2))
```

Then open the app and use **+ → Import project…**, or drop the same
`project` object (without the envelope) straight into
`<dataDir>/projects/<id>/data.json` — that's the on-disk format, and the file
watcher picks up outside writes live.

## Checklist before importing

- `format` is `"crow-project"` and `version` is `1`.
- `project.id` matches `^[a-zA-Z0-9-]+$` and matches every `app-*:///<id>/` url.
- Every `values` key is a field **id** that exists in `fields`.
- Every `select`/`multiSelect` value is a choice **id**, not a name; multiSelect
  values are arrays even when there's one choice.
- Every `relation` field has `relation.tableId` naming a table in the same file,
  and its values are arrays of record ids from that table — arrays even when
  the field isn't `multiple`.
- Dates are `"YYYY-MM-DD"`, numbers are JSON numbers, checkboxes are booleans.
- Each view config includes `hiddenFieldIds`, and `groupByFieldId` /
  `coverFieldId` / `dateFieldId` name fields that exist and are of the right
  type.
- Asset `name`s are bare file names with the right extension.
