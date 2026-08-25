export type FieldType =
  | 'text'
  | 'number'
  | 'select'
  | 'multiSelect'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'image'
  | 'audio'
  | 'relation'
  | 'rating'
  | 'attachment'

export type ChoiceColor =
  | 'gray'
  | 'red'
  | 'orange'
  | 'amber'
  | 'green'
  | 'teal'
  | 'blue'
  | 'indigo'
  | 'purple'
  | 'pink'

export interface SelectChoice {
  id: string
  name: string
  color: ChoiceColor
}

/** Where a `relation` field's linked record ids come from. */
export interface RelationOptions {
  /** Table in the same project the links point into; a table may point at
   *  itself (a task with sub-tasks, say). */
  tableId: string
  /** Whether a cell may hold more than one link. */
  multiple: boolean
  /** The relation field in `tableId` that stores the same links in reverse. */
  inverseFieldId: string
}

export interface Field {
  id: string
  name: string
  type: FieldType
  options?: {
    choices: SelectChoice[]
  }
  /** Only on `relation` fields: which table this one links to. */
  relation?: RelationOptions
}

/** Ceiling on one attachment imported by drag-and-drop. That path carries the
 *  file's bytes through renderer memory, the IPC structured clone and a Buffer
 *  in the main process — roughly three copies at once — so it needs a limit.
 *  The file picker copies on disk instead and isn't bound by it. */
export const MAX_ATTACHMENT_BYTES = 256 * 1024 * 1024

/** One file attached to an `attachment` cell — a cell holds an array of these.
 *  `url` is always an `app-attachment:///<projectId>/<file>` url: unlike
 *  `image`/`audio`, an attachment is only ever a file the app has copied into
 *  its own store, since it is handed to the OS to open rather than rendered.
 *  The on-disk file is stored under a generated name, so `name` keeps the
 *  original file name for display. */
export interface AttachmentValue {
  url: string
  name: string
  /** Bytes, when known — absent only for a url written by hand into a
   *  project file rather than imported through the app or CLI. */
  size?: number
}

export interface RecordRow {
  id: string
  createdAt: string
  values: Record<string, unknown>
}

/** Sentinel used by Calendar views for the record's built-in creation timestamp. */
export const CREATED_AT_DATE_SOURCE = '__createdAt__'

export type ViewType = 'table' | 'kanban' | 'gallery' | 'calendar'

export type FilterOperator =
  | 'contains'
  | 'notContains'
  | 'is'
  | 'isNot'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'gt'
  | 'lt'

export interface FilterRule {
  id: string
  fieldId: string
  operator: FilterOperator
  value?: unknown
}

export type FilterMatch = 'all' | 'any'

export interface SortRule {
  fieldId: string
  direction: 'asc' | 'desc'
}

export type RowHeight = 'short' | 'medium' | 'tall'
export type AudioRepeatMode = 'off' | 'one' | 'all'
export type AudioShuffleMode = 'off' | 'on'
export interface AudioPlaybackConfig {
  autoPlayNext: boolean
  repeatMode: AudioRepeatMode
  shuffleMode: AudioShuffleMode
}

/** A column footer statistic. Every field type offers the counting ones;
 *  `sum`…`range` are number-only and `earliest`…`dateRange` date-only
 *  (see `summaryOptions`). */
export type SummaryKey =
  | 'none'
  | 'empty'
  | 'filled'
  | 'unique'
  | 'percentEmpty'
  | 'percentFilled'
  | 'percentUnique'
  | 'sum'
  | 'average'
  | 'median'
  | 'min'
  | 'max'
  | 'range'
  | 'earliest'
  | 'latest'
  | 'dateRange'

/** Record selection and ordering, which every view type applies the same way
 *  before laying its records out. */
export interface ViewRules {
  filters: FilterRule[]
  filterMatch: FilterMatch
  sorts: SortRule[]
}

export interface TableViewConfig extends ViewRules {
  hiddenFieldIds: string[]
  groupByFieldId?: string
  rowHeight?: RowHeight
  /** Column width in pixels per field id; unset falls back to the default width. */
  columnWidths?: Record<string, number>
  /** Summary shown in the bottom bar per field id; unset (or `none`) shows nothing. */
  summaries?: Record<string, SummaryKey>
  /** Playlist behavior per audio field; unset auto-plays in order without repeating. */
  audioPlayback?: Record<string, AudioPlaybackConfig>
}

/** Aspect ratio (width:height) for a card's featured image, in Kanban,
 *  Gallery and Calendar views. */
export type ImageAspectRatio = '3:5' | '1:1' | '5:3'

export interface KanbanViewConfig extends ViewRules {
  groupByFieldId?: string
  hiddenFieldIds: string[]
  imageFieldId?: string
  imageAspectRatio?: ImageAspectRatio
}

export interface GalleryViewConfig extends ViewRules {
  coverFieldId?: string
  hiddenFieldIds: string[]
  imageAspectRatio?: ImageAspectRatio
}

export interface CalendarViewConfig extends ViewRules {
  dateFieldId?: string
  hiddenFieldIds: string[]
  mode?: 'month' | 'week' | 'day'
  /** Use the hourly agenda in Week mode; false uses the compact per-day list. */
  showHours?: boolean
  imageFieldId?: string
  imageAspectRatio?: ImageAspectRatio
}

export type View =
  | { id: string; name: string; type: 'table'; config: TableViewConfig }
  | { id: string; name: string; type: 'kanban'; config: KanbanViewConfig }
  | { id: string; name: string; type: 'gallery'; config: GalleryViewConfig }
  | { id: string; name: string; type: 'calendar'; config: CalendarViewConfig }

/** One table inside a project: its own schema, rows, and saved views.
 *  Tables are independent — a field id only means something within its own
 *  table, and nothing is shared across them but the project's media folder. */
export interface Table {
  id: string
  name: string
  fields: Field[]
  records: RecordRow[]
  views: View[]
}

export interface Project {
  id: string
  name: string
  icon?: string
  createdAt: string
  updatedAt: string
  tables: Table[]
}

/** Shape of a project saved before multi-table support, still readable from
 *  disk and from `.crow` files (see `migrateProject`). */
export interface LegacyProject {
  id: string
  name: string
  icon?: string
  createdAt: string
  updatedAt: string
  fields: Field[]
  records: RecordRow[]
  views: View[]
}

/** Where an asset sits inside a `.crow` archive, and which project folder it
 *  is restored to. The archive mirrors the project's own layout. */
export type ProjectAssetKind = 'image' | 'audio' | 'attachment'

/** One image/audio file carried inside a version ≤2 export, base64-encoded.
 *  Archives store the bytes as their own entries instead. */
export interface ProjectBundleAsset {
  kind: ProjectAssetKind
  /** Bare file name as stored in the project's `images/`/`audio/` folder. */
  name: string
  data: string
}

/** `project.json` inside a `.crow` archive: the schema, records and views, but
 *  none of the bytes. Images, audio and attachments are separate entries in the
 *  archive, stored as themselves. */
export interface ProjectManifest {
  format: 'crow-project'
  version: number
  exportedAt: string
  project: Project
}

/** A version ≤2 export: one JSON document with every asset base64'd into it.
 *  Still read on import, never written — see `docs/crow-format.md`. */
export interface LegacyProjectBundle extends ProjectManifest {
  assets: ProjectBundleAsset[]
}

export interface ProjectMeta {
  id: string
  name: string
  icon?: string
  /** Records across every table in the project. */
  recordCount: number
  tableCount: number
  createdAt: string
  updatedAt: string
}

export interface ContextMenuItem {
  id: string
  label: string
  type?: 'separator'
  danger?: boolean
}

export interface ConfirmDialogOptions {
  title: string
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Styles the dialog as a warning and puts Cancel first/default, matching native destructive-confirm prompts. */
  destructive?: boolean
  /** Shows a single dismiss button rather than a confirm/cancel pair, for
   *  something the user can only acknowledge. Always resolves false. */
  alert?: boolean
}

/** A CSV file read in from disk, ready to be parsed by the renderer. */
export interface CsvFile {
  /** File name without its extension, used to name the table it becomes. */
  name: string
  text: string
}

export interface Api {
  /** Shows a native OS context menu at the cursor; resolves with the clicked item's id, or null if dismissed. */
  showContextMenu: (items: ContextMenuItem[]) => Promise<string | null>
  /** Shows a native OS confirm dialog; resolves true if the user picked the confirm button. */
  showConfirmDialog: (options: ConfirmDialogOptions) => Promise<boolean>
  listProjects: () => Promise<ProjectMeta[]>
  createProject: (name: string) => Promise<Project>
  getProject: (id: string) => Promise<Project>
  saveProject: (project: Project) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  /** Writes the project and its media to a `.crow` file the user picks;
   *  resolves with the saved path, or null if cancelled. */
  exportProject: (id: string) => Promise<string | null>
  /** Reads a `.crow` file the user picks in as a new project (fresh id, so
   *  importing the same bundle twice gives two projects); null if cancelled. */
  importProject: () => Promise<Project | null>
  /** Writes already-serialized CSV text to a file the user picks; resolves
   *  with the saved path, or null if cancelled. */
  exportCsv: (suggestedName: string, content: string) => Promise<string | null>
  /** Reads a CSV/TSV file the user picks as raw text — the renderer parses it,
   *  since the clipboard needs the same parser; null if cancelled. */
  importCsv: () => Promise<CsvFile | null>
  /** Images, audio and attachments are stored alongside the project that owns
   *  them, so every picker/import call needs to know which project it's for. */
  pickImage: (projectId: string) => Promise<string | null>
  pickAudio: (projectId: string) => Promise<string | null>
  /** Copies or downloads the current media file to a path the user picks. */
  saveImageAs: (url: string) => Promise<boolean>
  saveAudioAs: (url: string) => Promise<boolean>
  /** Lets the user pick one or more arbitrary files; null if cancelled. */
  pickAttachments: (projectId: string) => Promise<AttachmentValue[] | null>
  /** Writes dropped file bytes (e.g. from a drag-and-drop) into local storage. */
  importImageData: (projectId: string, name: string, data: ArrayBuffer) => Promise<string | null>
  importAudioData: (projectId: string, name: string, data: ArrayBuffer) => Promise<string | null>
  importAttachmentData: (
    projectId: string,
    name: string,
    data: ArrayBuffer
  ) => Promise<AttachmentValue | null>
  /** Opens a stored attachment with the OS default app. The renderer must not
   *  link to `app-attachment:` urls directly — a top-level navigation to one
   *  would run the preload against that file's contents. False if the url
   *  doesn't name a stored file, or the OS refused to open it. */
  openAttachment: (url: string) => Promise<boolean>
  /** Copies a stored attachment out to a path the user picks; false if cancelled. */
  saveAttachmentAs: (url: string, name: string) => Promise<boolean>
  /** Fires when project files change on disk outside the app; returns unsubscribe. */
  onProjectsChanged: (callback: () => void) => () => void
  /** Version of an already-downloaded update ready to install, if any. */
  getUpdateStatus: () => Promise<string | null>
  /** Installs a downloaded update and restarts the app. */
  installUpdate: () => Promise<void>
  /** Fires once an update has finished downloading in the background; returns unsubscribe. */
  onUpdateReady: (callback: (version: string) => void) => () => void
  /** Current and default root folders where projects/images are stored. */
  getDataDir: () => Promise<{ current: string; default: string }>
  /** Opens a native folder picker; returns the chosen path, or null if cancelled. */
  pickDataDir: () => Promise<string | null>
  /**
   * Stores new projects/images at `dir` from now on. When `move` is true
   * (the default a caller should pass explicitly), existing data is moved
   * there first; otherwise the app just switches over and leaves it in place.
   */
  setDataDir: (dir: string, move: boolean) => Promise<void>
}
