import type { LegacyProject, Project, Table, TableViewConfig, View } from './types'

/**
 * Reads a project written by any version of the app. Projects saved before
 * multi-table support keep `fields`/`records`/`views` at the top level; those
 * become the project's single table, named after the project so the tab bar
 * reads sensibly. Anything already carrying `tables` is returned as-is.
 *
 * Kept deliberately tolerant: a hand-written or half-broken file is normalised
 * into something openable rather than rejected, matching the app's habit of
 * skipping bad data instead of failing the whole load.
 */
export function migrateProject(raw: Project | LegacyProject): Project {
  const legacy = raw as Partial<LegacyProject> & Partial<Project>
  if (Array.isArray(legacy.tables)) {
    return { ...(raw as Project), tables: legacy.tables.map(normalizeTable) }
  }

  const table: Table = normalizeTable({
    id: crypto.randomUUID(),
    name: legacy.name?.trim() || 'Table',
    fields: legacy.fields,
    records: legacy.records,
    views: legacy.views
  })
  const { fields: _f, records: _r, views: _v, ...rest } = legacy
  return { ...(rest as Project), tables: [table] }
}

function normalizeTable(table: Partial<Table>): Table {
  return {
    id: table.id ?? crypto.randomUUID(),
    name: table.name ?? 'Table',
    fields: Array.isArray(table.fields) ? table.fields : [],
    records: Array.isArray(table.records) ? table.records : [],
    views: Array.isArray(table.views) ? table.views.map(normalizeView) : []
  }
}

/** Kanban/gallery/calendar views gained filters and sorts after plenty of them
 *  had already been written to disk, so fill in the lists the rest of the app
 *  expects to always be there. */
function normalizeView(view: View): View {
  const config = (view.config ?? {}) as Partial<TableViewConfig>
  return {
    ...view,
    config: {
      ...config,
      hiddenFieldIds: Array.isArray(config.hiddenFieldIds) ? config.hiddenFieldIds : [],
      filters: Array.isArray(config.filters) ? config.filters : [],
      sorts: Array.isArray(config.sorts) ? config.sorts : []
    }
  } as View
}

/** Records across every table — what the sidebar and project cards show. */
export function projectRecordCount(project: Project): number {
  return project.tables.reduce((total, table) => total + table.records.length, 0)
}
