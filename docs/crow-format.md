# The `.crow` file format

A `.crow` file is one project — its tables, their schemas, records and views,
and every image/audio/attachment file it owns. It's what **Export…** writes and
**Import project…** reads.

It's an ordinary **zip archive**: a `project.json` describing the project,
plus each media file stored as itself. Rename one to `.zip` and any unzip tool
will open it. Nothing is base64-encoded, so an archive is about the size of the
files it carries rather than a third larger, and neither end has to hold the
whole thing in memory.

```
Reading List.crow
├── project.json          ← the document below
├── images/
│   └── 8c1e…-40af.png    ← raw bytes, byte-identical to the original
├── audio/
│   └── 4b02…-77de.mp3
└── attachments/
    └── 3f9a…-91bc.pdf
```

The folder names inside the archive are exactly the ones the app uses on disk,
so an archive unzipped by hand drops straight into a project directory.

This page documents the format well enough to write a generator. If you'd rather
mutate an existing project than build one from scratch, `cli/crow.mjs` already
speaks a friendlier, name-based dialect — see [cli/README.md](../cli/README.md).

## `project.json`

```json
{
  "format": "crow-project",
  "version": 3,
  "exportedAt": "2026-08-20T09:15:00.000Z",
  "project": { "…": "see below" }
}
```

| Key | Required | Notes |
| --- | --- | --- |
| `format` | yes | Must be exactly `"crow-project"`, or the import is refused. |
| `version` | yes | Format version. The app accepts anything `<= 3` and refuses newer. |
| `exportedAt` | no | ISO-8601 timestamp; informational only. |
| `project` | yes | The project itself (below). |

### Older versions

Versions 1 and 2 were a **single JSON document** rather than an archive, with
every asset base64'd into an `assets` array inside it. Both still import — the
app sniffs the first four bytes, and reads anything that isn't a zip that older
way — but write version 3 in anything new. The rules for `project` are
unchanged across all three.

Version 1 additionally put a single table's `fields`, `records` and `views`
directly on the `project`. Those files still import too — they become a project
with one table, named after the project.

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
| `id` | yes | Any string matching `^[a-zA-Z0-9-]+$` — a UUID by convention. **Import replaces it** with a fresh id, so pick anything unique; it only has to match the `app-image:///<id>/…` (or `app-audio:///…`, `app-attachment:///…`) urls inside the same file. |
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
Media is the other shared thing: images, audio and attachments each live in
their own per-project folder, so any table can use any of them.

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
| `date` | `"YYYY-MM-DD"` (all day) or `"YYYY-MM-DDTHH:mm"` (local wall-clock time, no timezone) |
| `checkbox` | `true`; anything else counts as unchecked |
| `url` | string |
| `image` | an `app-image:///<projectId>/<file>` url, or any external `http(s)` url |
| `audio` | an `app-audio:///<projectId>/<file>` url, or any external `http(s)` url |
| `relation` | array of **record ids** from another table in the same project |
| `rating` | integer 1–5 (a 5-star scale) |
| `attachment` | array of `{ url, name, size? }` — `url` must be an `app-attachment:///<projectId>/<file>` url; unlike `image`/`audio` there is no external-url form, because an attachment is handed to the OS to open rather than rendered in the app. `name` is the original file name (the on-disk file name is a generated id, so the record keeps the real name separately); `size` is byte count, when known |
| `createdTime` | *nothing* — read from the record's own `createdAt` |
| `lastModifiedTime` | *nothing* — read from the record's own `updatedAt`, falling back to `createdAt` |

`createdTime` and `lastModifiedTime` are computed: they never appear in a
record's `values`, and the app won't let a cell edit, paste or CSV import write
to one. A key left in `values` under such a field's id is simply ignored, the
way any unknown key is. Both carry a `dateFormat` saying how the timestamp
renders — these are absolute instants, so they display in whatever time zone
the computer is currently in:

| `dateFormat` | Renders as |
| --- | --- |
| `slash` (default, and what an unset value means) | `2026/01/30` |
| `slashTime` | `2026/01/30 14:00` |
| `slashTimeZone` | `2026/01/30 14:00 (GMT+8)` |
| `dash` | `2026-01-30` |
| `dashTime` | `2026-01-30 14:00` |
| `dashTimeZone` | `2026-01-30 14:00 (GMT+8)` |

```json
{
  "id": "fld-added",
  "name": "Added",
  "type": "createdTime",
  "dateFormat": "slashTime"
}
```

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
  "updatedAt": "2026-08-24T17:31:02.114Z",
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
field. Keys that match no field are kept on disk but ignored by the app.

`createdAt` is required; `updatedAt` is optional and is what a
`lastModifiedTime` field reads, falling back to `createdAt` when it's absent —
which is how every record written before the app tracked modification reads.
The app rewrites `updatedAt` on each record an edit actually touched, so a file
written by hand can leave it out entirely.

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
    "config": { "dateFieldId": "fld-due", "hiddenFieldIds": [], "mode": "month", "showHours": true }
  }
]
```

| Config key | Views | Notes |
| --- | --- | --- |
| `hiddenFieldIds` | all | Required (use `[]`). Field ids to hide. |
| `filters` | table | `{ id, fieldId, operator, value? }`. Operators: `contains`, `notContains`, `is`, `isNot`, `isEmpty`, `isNotEmpty`, `gt`, `lt` — a rule whose operator doesn't apply to the field's type is ignored. `value` holds a choice id for `select`/`multiSelect`, or a `YYYY-MM-DD` string for dates (an `is` rule includes timed records on that day). |
| `sorts` | table | `{ fieldId, direction }` with `direction` of `asc` or `desc`. Applied in order; empty values always sink to the bottom. |
| `groupByFieldId` | table, kanban | Kanban wants a `select` field — without one the board has nothing to lay out. |
| `rowHeight` | table | `short` (default), `medium`, `tall`, or `extraTall`. |
| `columnWidths` | table | `{ "<fieldId>": 220 }` in pixels; unset fields use the default width. |
| `summaries` | table | `{ "<fieldId>": "sum" }` — the statistic that field's cell shows in the bottom bar. Any field takes `none` (the default), `empty`, `filled`, `unique`, `percentEmpty`, `percentFilled`, `percentUnique`; `number` and `rating` fields also take `sum`, `average`, `median`, `min`, `max`, `range`, and `date`, `createdTime` and `lastModifiedTime` fields `earliest`, `latest`, `dateRange`. A summary that doesn't apply to the field's type shows nothing. |
| `coverFieldId` | gallery | An `image` field id. |
| `dateFieldId` | calendar | A `date`, `createdTime` or `lastModifiedTime` field id; unset falls back to the table's first such field. Only a `date` field can be written to, so that's the only kind where clicking an empty day creates a record on it. The old `"__createdAt__"` sentinel is gone — a file still carrying it loads as unset, and a `createdTime` field replaces it. |
| `mode` | calendar | `month` (default), `week`, or `day`. |
| `showHours` | calendar | In Week and Day modes, `true` (default) uses an hourly agenda: date-only records appear in its all-day row and timed records are placed at their local start time. `false` uses a compact list inside each day. |

## Assets

Every other entry in the archive is a media file, stored **uncompressed and
byte-identical to the original**. Media is almost always in an already-compressed
format, so deflating it would cost real time to save almost nothing; storing it
means what you extract is exactly what was imported.

```
images/cover.png
audio/4b02…-77de.mp3
attachments/3f9a…-91bc.pdf
```

- The **folder** decides where the file is restored: `images/`, `audio/` or
  `attachments/`. Any other top-level folder is ignored on import.
- The **name** must be a bare file name — no nested directories. Names
  containing `/` or `\`, or starting with `.`, are skipped, so
  `attachments/../../evil.png` can't escape the project folder. The extension
  matters (it's what the browser sniffs); the stem doesn't, though the app
  itself uses UUIDs to avoid collisions.
- A record references an asset by url, not by path:
  `app-image:///<projectId>/<name>` (or `app-audio:///…`, `app-attachment:///…`).
  The `<projectId>` **must match `project.id` in `project.json`**.
- For attachments specifically, the name in `attachments/` is the generated
  (UUID-based) file name — the same one in the url — not the original file name
  a user picked. That original name lives on the record's `attachment` value
  (see the `fields` table above), which is why that value carries a `name` of
  its own.

Assets that nothing references are still imported — harmless, and it means an
export never silently drops a file.

## What import changes

Given an archive, the app:

1. Generates a **new project id**, so importing the same file twice yields two
   independent projects instead of overwriting the first.
2. Rewrites every `app-image:///<oldId>/`, `app-audio:///<oldId>/` and
   `app-attachment:///<oldId>/` prefix in the project to the new id. External
   `http(s)` urls are left alone.
3. Writes each asset to `<dataDir>/projects/<newId>/images|audio|attachments/<name>`.
4. Sets `updatedAt` to now, keeps `createdAt`.

`project.json` is read on its own pass before any of that, since entry order in
an archive is up to whoever wrote it and the assets can't be filed until the new
id is known.

Because of step 2, the project id you use while generating is arbitrary — it
just has to be internally consistent with your asset urls.

## A complete minimal file

Valid, importable, and about as small as a useful project gets. A project with
no media has nothing to put in an archive, so this is the version 1 single-
document form — still accepted, and the easiest thing to hand-write:

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

Build the `project` object, then zip it up with the files it references. This
turns a CSV-ish array into a project with a select field and one local image
(`fflate` here, but any zip library will do):

```js
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { zipSync } from 'fflate'

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

const manifest = {
  format: 'crow-project',
  version: 3,
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
  }
}

// Assets go in uncompressed (level 0) — they're already-compressed formats, and
// storing them keeps the extracted bytes identical to the originals.
const archive = zipSync({
  'project.json': new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  'images/cover.png': [readFileSync('cover.png'), { level: 0 }]
})

writeFileSync('reading-list.crow', archive)
```

Then open the app and use **+ → Import project…**, or drop the same
`project` object (without the envelope) straight into
`<dataDir>/projects/<id>/data.json` — that's the on-disk format, and the file
watcher picks up outside writes live.

## Checklist before importing

- `format` is `"crow-project"` and `version` is `3` (or `1`/`2` for the older
  single-document form, in which case the file is JSON rather than an archive).
- If it's an archive: `project.json` is at the root, and every other entry sits
  under `images/`, `audio/` or `attachments/`.
- `project.id` matches `^[a-zA-Z0-9-]+$` and matches every `app-*:///<id>/` url.
- Every `values` key is a field **id** that exists in `fields`.
- Every `select`/`multiSelect` value is a choice **id**, not a name; multiSelect
  values are arrays even when there's one choice.
- Every `relation` field has `relation.tableId` naming a table in the same file,
  and its values are arrays of record ids from that table — arrays even when
  the field isn't `multiple`.
- Every `attachment` value is an array of `{ url, name }` objects (even for one
  file), and each `url`'s asset `kind` is `attachment`, not `image`/`audio`.
- Dates are `"YYYY-MM-DD"` for all-day values or `"YYYY-MM-DDTHH:mm"` for local timed values; numbers are JSON numbers, checkboxes are booleans.
- Each view config includes `hiddenFieldIds`, and `groupByFieldId` /
  `coverFieldId` / `dateFieldId` name fields that exist and are of the right
  type.
- Asset `name`s are bare file names with the right extension.
