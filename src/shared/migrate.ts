import type { LegacyProject, Project, Table } from './types'

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
    views: Array.isArray(table.views) ? table.views : []
  }
}

/** Records across every table — what the sidebar and project cards show. */
export function projectRecordCount(project: Project): number {
  return project.tables.reduce((total, table) => total + table.records.length, 0)
}
