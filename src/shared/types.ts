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

export interface Field {
  id: string
  name: string
  type: FieldType
  options?: {
    choices: SelectChoice[]
  }
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

export interface SortRule {
  fieldId: string
  direction: 'asc' | 'desc'
}

export type RowHeight = 'short' | 'medium' | 'tall'

export interface TableViewConfig {
  hiddenFieldIds: string[]
  filters: FilterRule[]
  sorts: SortRule[]
  groupByFieldId?: string
  rowHeight?: RowHeight
  /** Column width in pixels per field id; unset falls back to the default width. */
  columnWidths?: Record<string, number>
}

export interface KanbanViewConfig {
  groupByFieldId?: string
  hiddenFieldIds: string[]
}

export interface GalleryViewConfig {
  coverFieldId?: string
  hiddenFieldIds: string[]
}

export interface CalendarViewConfig {
  dateFieldId?: string
  hiddenFieldIds: string[]
  mode?: 'month' | 'week'
}

export type View =
  | { id: string; name: string; type: 'table'; config: TableViewConfig }
  | { id: string; name: string; type: 'kanban'; config: KanbanViewConfig }
  | { id: string; name: string; type: 'gallery'; config: GalleryViewConfig }
  | { id: string; name: string; type: 'calendar'; config: CalendarViewConfig }

export interface Project {
  id: string
  name: string
  icon?: string
  createdAt: string
  updatedAt: string
  fields: Field[]
  records: RecordRow[]
  views: View[]
}

/** One image/audio file carried inside an exported bundle, base64-encoded. */
export interface ProjectBundleAsset {
  kind: 'image' | 'audio'
  /** Bare file name as stored in the project's `images/`/`audio/` folder. */
  name: string
  data: string
}

/** A whole project — schema, records, views, and its local media — in one
 *  self-contained JSON file (`.crow`), so it can be shared or backed up. */
export interface ProjectBundle {
  format: 'crow-project'
  version: number
  exportedAt: string
  project: Project
  assets: ProjectBundleAsset[]
}

export interface ProjectMeta {
  id: string
  name: string
  icon?: string
  recordCount: number
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
  /** Images and audio are stored alongside the project that owns them, so
   *  every picker/import call needs to know which project it's for. */
  pickImage: (projectId: string) => Promise<string | null>
  pickAudio: (projectId: string) => Promise<string | null>
  /** Writes dropped file bytes (e.g. from a drag-and-drop) into local storage. */
  importImageData: (projectId: string, name: string, data: ArrayBuffer) => Promise<string | null>
  importAudioData: (projectId: string, name: string, data: ArrayBuffer) => Promise<string | null>
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
