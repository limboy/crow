# The `.crow` document format

A `.crow` document is one Crow database — its tables, their schemas, records
and views, and every image/audio/video/attachment file it owns. It's what the
app opens (**File → Open…**) and edits in place.

It's a **directory** — a package, in macOS terms, so Finder shows it as a
single file (right-click → **Show Package Contents** to look inside). On other
platforms it's an ordinary folder whose name ends in `.crow`.

```
Reading List.crow/
├── data.json             ← the project (below)
├── images/
│   └── 8c1e…-40af.png    ← raw bytes, byte-identical to the original
├── audio/
│   └── 4b02…-77de.mp3
├── video/
│   └── 9d47…-2c10.mp4
└── attachments/
    └── 3f9a…-91bc.pdf
```

The app reads and writes inside the directory directly: each edit replaces
`data.json` (written beside it, then renamed over it, so it's never half
written), and adding a file to a cell copies it into the matching media
folder. There's no separate save step.

This page documents the format well enough to write a generator. If you'd rather
mutate an existing document than build one from scratch, `cli/crow.mjs` already
speaks a friendlier, name-based dialect — see [cli/README.md](../cli/README.md).

## `data.json`

`data.json` is the `project` object described below — nothing wraps it.

Opening validates only that `data.json` parses, has a string `name`, and has
either a `tables` array or (the pre-multi-table shape) array `fields`,
`records` and `views`. Everything past that is trusted, so a malformed field
type or a record pointing at a missing field id won't be caught when the
document is opened — it just renders as empty. Get it right in the generator.

A project saved before multi-table support put a single table's `fields`,
`records` and `views` directly on the project. That still opens — it becomes a
project with one table, named after the project — and is written back in the
current shape on the next edit.

### Older single-file documents

Before documents were packages, a `.crow` was one file: a zip holding a
`project.json` (the project wrapped as `{ "format": "crow-project", "version":
3, "project": … }`) plus the media folders, or, in versions 1–2, a single JSON
document with every asset base64'd into an `assets` array. The app still opens
both: it converts the file into a package of the same name and keeps the
original beside it as `<name>.crow.zip`. The CLI refuses them until that's
happened.

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
| `id` | yes | Any string matching `^[a-zA-Z0-9-]+$` — a UUID by convention. The app keeps it unless another open document already uses it, in which case that window works under a fresh id (and saves with it). Either way it only has to match the `app-image:///<id>/…` (or `app-audio:///…`, `app-video:///…`, `app-attachment:///…`) urls inside the same document. |
| `name` | yes | Informational: the app names a document after its `.crow` directory, and writes that name here on the next edit. |
| `icon` | no | Reserved — carried through saves but not rendered yet. |
| `createdAt` | yes | ISO-8601. Preserved. |
| `updatedAt` | yes | ISO-8601. Updated on each edit. |
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
| `views` | yes | Saved table/kanban/gallery/calendar/dashboard configurations. |

**Tables reference each other in exactly one place: `relation` fields.** Field,
record, choice and view ids only have to be unique *within* their own table;
the only ids that cross a table boundary are a relation field's `tableId` and
the record ids it stores (see [`relation` fields](#relation-fields) below).
Media is the other shared thing: images, audio, video and attachments each
live in the document's own media folders, so any table can use any of them.

Ids for fields, records, choices, tables and views are opaque strings — anything
unique within the table works. Only the **project** id is constrained by the
`^[a-zA-Z0-9-]+$` pattern, because it's part of every media url.

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
| `video` | `{ url, name?, poster? }` — `url` is an `app-video:///<projectId>/<file>` url or any external `http(s)` url; `name` is the original file name, for display (the on-disk file is named with a generated id); `poster` is an `app-image:///…` url for the cover frame. The app never plays a video inline — clicking hands the url to the OS player — so `poster` is what a cell, and any view featuring the field as a card cover, actually shows. It's captured by the app a quarter of the way into the video and stored as an ordinary image asset, so a value written by hand or by the CLI simply has none until the app captures one |
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

Relations survive opening and copying: at most the project id is rewritten,
so record ids — and the links pointing at them — stay as they are.

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
  },
  {
    "id": "vw-dash",
    "name": "Dashboard",
    "type": "dashboard",
    "config": {
      "hiddenFieldIds": [],
      "charts": [
        {
          "id": "cht-status",
          "name": "",
          "type": "column",
          "groupByFieldId": "fld-status",
          "aggregate": "count",
          "limit": 8
        },
        {
          "id": "cht-pages",
          "name": "Pages read",
          "type": "metric",
          "aggregate": "sum",
          "valueFieldId": "fld-pages"
        }
      ]
    }
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
| `coverFieldId` | gallery | An `image` or `video` field id — a video is featured by its captured `poster`. |
| `dateFieldId` | calendar | A `date`, `createdTime` or `lastModifiedTime` field id; unset falls back to the table's first such field. Only a `date` field can be written to, so that's the only kind where clicking an empty day creates a record on it. The old `"__createdAt__"` sentinel is gone — a file still carrying it loads as unset, and a `createdTime` field replaces it. |
| `mode` | calendar | `month` (default), `week`, or `day`. |
| `showHours` | calendar | In Week and Day modes, `true` (default) uses an hourly agenda: date-only records appear in its all-day row and timed records are placed at their local start time. `false` uses a compact list inside each day. |
| `charts` | dashboard | The charts the view composes, in the order they're laid out. Required (use `[]`, which opens on an empty state). See below. |

A dashboard's `hiddenFieldIds` is carried for uniformity and ignored — the view
shows aggregates rather than fields. Its `filters`/`filterMatch` do apply, and
scope every chart on it. Each chart can further narrow that slice with its own
filters; chart filters never include records excluded by the dashboard.

### `charts`

Each chart is one object. Only `id`, `type` and `aggregate` are required;
anything malformed is dropped on load rather than refusing the view, and
anything merely unset renders a "pick a field" prompt on the card.

| Key | Required | Notes |
| --- | --- | --- |
| `id` | yes | Opaque string, unique within the view. |
| `name` | no | The card's title. Empty (or absent) titles it from what it measures, e.g. `Records by Status`. |
| `type` | yes | `metric` (one headline figure), `bar` (horizontal), `column` (vertical), `line` (a trend over a date field), or `donut` (part-to-whole). |
| `aggregate` | yes | `count`, `sum`, `average`, `median`, `min` or `max`. |
| `valueFieldId` | for non-`count` | A `number` or `rating` field id. Ignored by `count`. |
| `groupByFieldId` | for non-`metric` | The field whose values become the chart's categories. Any field type but `image`/`audio`/`video`/`attachment`. A `multiSelect` or `relation` field buckets a record once per value it holds, so the buckets can count more records between them than the view shows. |
| `dateGrain` | no | Only when `groupByFieldId` is a `date`, `createdTime` or `lastModifiedTime` field: `day`, `week` (starting Monday), `month` (the default) or `year`. Periods with no records are still plotted — the gap is real. |
| `sort` | no | `category` (the field's own order), `valueDesc` or `valueAsc`. Unset sorts a date grouping chronologically and everything else by value, largest first. |
| `limit` | no | Most buckets to plot; unset is 8, and a donut is capped at 6 whatever this says. A categorical grouping folds its smallest categories into one trailing `Other`; a date grouping keeps the most recent periods instead. Either way the card says what it left out. |
| `size` | no | `half` (default) or `full` width in the dashboard grid. |
| `filters` | no | Additional filter rules in the same format as view filters; defaults to `[]`. Applied after dashboard filters. |
| `filterMatch` | no | `all` (default) or `any`, combining only this chart’s rules. |

Click a chart mark, number tile, or category in the values table to list its
source records, then select a record to open the editor. Drill-down respects
both filter scopes and includes every category folded into `Other`. Multi-value
groups list each source record once, even when the plotted count includes it
in several categories. Drill-down selection is transient and is not saved.

## Media

Media files live in the document's four media folders, each **byte-identical
to the file that was added**.

```
images/cover.png
audio/4b02…-77de.mp3
video/9d47…-2c10.mp4
attachments/3f9a…-91bc.pdf
```

- Only `images/`, `audio/`, `video/` and `attachments/` hold media; anything
  else in the directory is ignored.
- The **name** must be a bare file name — no nested directories, and not
  starting with `.`. The extension matters (it's what the browser sniffs); the
  stem doesn't, though the app itself uses UUIDs to avoid collisions.
- A record references a file by url, not by path:
  `app-image:///<projectId>/<name>` (or `app-audio:///…`, `app-video:///…`,
  `app-attachment:///…`), where `<name>` is the file in the matching folder.
  The `<projectId>` **must match `id` in `data.json`**.
- A `video` value's `poster` is an ordinary file under `images/`, not under
  `video/` — it's a still, and every view that features it treats it as any
  other image.
- For attachments specifically, the name in `attachments/` is the generated
  (UUID-based) file name — the same one in the url — not the original file name
  a user picked. That original name lives on the record's `attachment` value
  (see the `fields` table above), which is why that value carries a `name` of
  its own.

Files nothing references any more are deleted when the document's window
closes — not sooner, since an undo while it's open can bring a removed file
back. Files younger than a minute are always left alone, so a script can copy
a file in before it writes the `data.json` that points at it.

## What opening a document does

The app keeps `id` as it is — unless another open window already uses it (two
copies of one document, say). Then the copy gets a fresh id, and every
`app-image:///<oldId>/`, `app-audio:///<oldId>/`, `app-video:///<oldId>/` and
`app-attachment:///<oldId>/` prefix in its `data.json` is rewritten to match
and saved. External `http(s)` urls are left alone.

While a document is open, the app watches its `data.json`: if something else
replaces it — the CLI, say — the window reloads it.

Because of the id rule, the id you use while generating is arbitrary — it just
has to be internally consistent with your media urls.

## A complete minimal document

Valid, openable, and about as small as a useful document gets: a directory
named `Reading List.crow` holding just this `data.json` (no media, so no media
folders):

```json
{
  "id": "generated",
  "name": "Reading List",
  "createdAt": "2026-08-20T09:00:00.000Z",
  "updatedAt": "2026-08-20T09:00:00.000Z",
  "tables": [
    {
      "id": "tbl-books",
      "name": "Books",
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
    }
  ]
}
```

## Generating one in Node

Build the project, write it as `data.json`, and copy in the files it
references. This turns a CSV-ish array into a document with a select field and
one local image — no libraries needed:

```js
import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = 'Reading List.crow'
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

const project = {
  id: projectId,
  name: 'Reading List',
  createdAt: now,
  updatedAt: now,
  tables: [
    {
      id: randomUUID(),
      name: 'Books',
      fields: [titleField, statusField, coverField],
      records: rows.map((row) => ({
        id: randomUUID(),
        createdAt: now,
        values: {
          [titleField.id]: row.title,
          [statusField.id]: choiceId[row.status],
          // Points at images/cover.png below; must use the same id as project.id.
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
  ]
}

mkdirSync(join(dir, 'images'), { recursive: true })
copyFileSync('cover.png', join(dir, 'images', 'cover.png'))
writeFileSync(join(dir, 'data.json'), JSON.stringify(project, null, 2))
```

Then double-click `Reading List.crow`, or open it with **File → Open…**.

## Checklist before opening

- The document is a directory whose name ends in `.crow`, with `data.json` at
  its top level and media under `images/`, `audio/`, `video/` or `attachments/`.
- `id` in `data.json` matches `^[a-zA-Z0-9-]+$` and matches every `app-*:///<id>/` url.
- Every `values` key is a field **id** that exists in `fields`.
- Every `select`/`multiSelect` value is a choice **id**, not a name; multiSelect
  values are arrays even when there's one choice.
- Every `relation` field has `relation.tableId` naming a table in the same document,
  and its values are arrays of record ids from that table — arrays even when
  the field isn't `multiple`.
- Every `attachment` value is an array of `{ url, name }` objects (even for one
  file), each `url` an `app-attachment:///` one whose file sits under
  `attachments/`.
- Every `video` value is a single `{ url }` object — not a bare url string —
  whose file sits under `video/`, and whose `poster`, if it has one, sits under
  `images/`.
- Dates are `"YYYY-MM-DD"` for all-day values or `"YYYY-MM-DDTHH:mm"` for local timed values; numbers are JSON numbers, checkboxes are booleans.
- Each view config includes `hiddenFieldIds`, and `groupByFieldId` /
  `coverFieldId` / `dateFieldId` name fields that exist and are of the right
  type. A dashboard's `charts` is present (`[]` at minimum), and each chart's
  `groupByFieldId` / `valueFieldId` names a field that exists — a `number` or
  `rating` one for `valueFieldId`.
- Asset `name`s are bare file names with the right extension.
