import type {
  CalendarViewConfig,
  ChartAggregate,
  ChartSpec,
  ChartType,
  DashboardViewConfig,
  LegacyProject,
  Project,
  Table,
  TableViewConfig,
  View
} from './types'

/** Calendar views used to offer the record's own creation timestamp as a
 *  built-in date source, under this id. That source is gone — a `createdTime`
 *  field is the way to put records on a calendar by when they were made — so
 *  views still pointing at it fall back to picking a real date field. */
const LEGACY_CREATED_AT_DATE_SOURCE = '__createdAt__'

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
    return normalizeRelationPairs({ ...(raw as Project), tables: legacy.tables.map(normalizeTable) })
  }

  const table: Table = normalizeTable({
    id: crypto.randomUUID(),
    name: legacy.name?.trim() || 'Table',
    fields: legacy.fields,
    records: legacy.records,
    views: legacy.views
  })
  const { fields: _f, records: _r, views: _v, ...rest } = legacy
  return normalizeRelationPairs({ ...(rest as Project), tables: [table] })
}

function normalizeTable(table: Partial<Table>): Table {
  return {
    id: table.id ?? crypto.randomUUID(),
    name: table.name ?? 'Table',
    fields: Array.isArray(table.fields)
      ? table.fields.map((field) => ({
          ...field,
          relation: field.relation ? { ...field.relation } : undefined
        }))
      : [],
    records: Array.isArray(table.records)
      ? table.records.map((record) => ({ ...record, values: { ...record.values } }))
      : [],
    views: Array.isArray(table.views) ? table.views.map(normalizeView) : []
  }
}

function relationIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === 'string')
}

function writeRelation(record: Table['records'][number], fieldId: string, ids: string[]): void {
  if (ids.length === 0) delete record.values[fieldId]
  else record.values[fieldId] = ids
}

function inverseName(table: Table, preferred: string): string {
  const names = new Set(table.fields.map((field) => field.name.toLowerCase()))
  if (!names.has(preferred.toLowerCase())) return preferred
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${preferred} ${suffix}`
    if (!names.has(candidate.toLowerCase())) return candidate
  }
}

/**
 * Older relation fields only stored their forward table id. Give each one a
 * concrete reverse field and backfill it from the links already on disk.
 * Existing paired data is merged from both sides so migration never discards
 * a link merely because one half was saved by an older client.
 */
function normalizeRelationPairs(project: Project): Project {
  for (const table of project.tables) {
    for (const field of [...table.fields]) {
      if (field.type !== 'relation' || !field.relation) continue
      const target = project.tables.find((candidate) => candidate.id === field.relation!.tableId)
      if (!target) {
        field.relation.inverseFieldId ||= crypto.randomUUID()
        continue
      }

      let inverseId = field.relation.inverseFieldId || crypto.randomUUID()
      field.relation.inverseFieldId = inverseId
      let inverse = target.fields.find((candidate) => candidate.id === inverseId)
      const usable =
        inverse?.type === 'relation' &&
        inverse.relation?.tableId === table.id &&
        (!inverse.relation.inverseFieldId || inverse.relation.inverseFieldId === field.id) &&
        !(target.id === table.id && inverse.id === field.id)
      if (inverse && !usable) {
        inverseId = crypto.randomUUID()
        field.relation.inverseFieldId = inverseId
        inverse = undefined
      }

      if (!inverse) {
        target.fields.push({
          id: inverseId,
          name: inverseName(target, table.name),
          type: 'relation',
          relation: { tableId: table.id, multiple: true, inverseFieldId: field.id }
        })
      } else if (inverse.type === 'relation' && inverse.relation) {
        inverse.relation.tableId = table.id
        inverse.relation.inverseFieldId = field.id
      }
    }
  }

  const processed = new Set<string>()
  for (const source of project.tables) {
    for (const field of source.fields) {
      if (field.type !== 'relation' || !field.relation) continue
      const target = project.tables.find((candidate) => candidate.id === field.relation!.tableId)
      const inverse = target?.fields.find(
        (candidate) =>
          candidate.id === field.relation!.inverseFieldId &&
          candidate.type === 'relation' &&
          candidate.relation?.tableId === source.id
      )
      if (!target || inverse?.type !== 'relation' || !inverse.relation) continue
      const key = [source.id, field.id, target.id, inverse.id].sort().join(':')
      if (processed.has(key)) continue
      processed.add(key)

      const sourceIds = new Set(source.records.map((record) => record.id))
      const targetIds = new Set(target.records.map((record) => record.id))
      const edges = new Map(source.records.map((record) => [record.id, [] as string[]]))
      source.records.forEach((record) => {
        const ids = [...new Set(relationIds(record.values[field.id]))].filter((id) =>
          targetIds.has(id)
        )
        edges.set(record.id, field.relation!.multiple ? ids : ids.slice(0, 1))
      })
      target.records.forEach((record) => {
        relationIds(record.values[inverse.id]).forEach((sourceId) => {
          if (!sourceIds.has(sourceId)) return
          const ids = edges.get(sourceId)!
          if (!ids.includes(record.id) && (field.relation!.multiple || ids.length === 0)) {
            ids.push(record.id)
          }
        })
      })

      if (!inverse.relation.multiple) {
        target.records.forEach((record) => {
          const sources = source.records.filter((candidate) =>
            edges.get(candidate.id)?.includes(record.id)
          )
          sources.slice(1).forEach((candidate) => {
            edges.set(
              candidate.id,
              (edges.get(candidate.id) ?? []).filter((id) => id !== record.id)
            )
          })
        })
      }

      source.records.forEach((record) => writeRelation(record, field.id, edges.get(record.id) ?? []))
      const reverse = new Map(target.records.map((record) => [record.id, [] as string[]]))
      source.records.forEach((record) => {
        for (const targetId of edges.get(record.id) ?? []) {
          reverse.get(targetId)?.push(record.id)
        }
      })
      target.records.forEach((record) =>
        writeRelation(record, inverse.id, reverse.get(record.id) ?? [])
      )
    }
  }
  return project
}

function normalizeAudioPlayback(value: unknown): TableViewConfig['audioPlayback'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const normalized: NonNullable<TableViewConfig['audioPlayback']> = {}
  for (const [fieldId, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const entry = raw as Record<string, unknown>
    const repeatMode =
      entry.repeatMode === 'one' || entry.repeatMode === 'all'
        ? entry.repeatMode
        : entry.loop === true
          ? 'one'
          : 'off'
    const shuffleMode =
      entry.shuffleMode === 'on' || entry.shuffle === true ? 'on' : 'off'
    normalized[fieldId] = {
      autoPlayNext: entry.autoPlayNext !== false,
      repeatMode,
      shuffleMode
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

const CHART_TYPES: ChartType[] = ['metric', 'bar', 'column', 'line', 'donut']
const CHART_AGGREGATES: ChartAggregate[] = ['count', 'sum', 'average', 'median', 'min', 'max']

/** A dashboard's charts, with anything malformed dropped rather than left to
 *  throw at render time — a chart is small enough that losing one broken tile
 *  beats refusing to open the view. Everything optional is left alone; the
 *  renderer already treats an unset field as "not configured yet". */
function normalizeCharts(value: unknown): ChartSpec[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const chart = raw as Partial<ChartSpec>
    if (!CHART_TYPES.includes(chart.type as ChartType)) return []
    return [
      {
        ...chart,
        id: typeof chart.id === 'string' && chart.id !== '' ? chart.id : crypto.randomUUID(),
        name: typeof chart.name === 'string' ? chart.name : '',
        type: chart.type as ChartType,
        filters: Array.isArray(chart.filters) ? chart.filters : [],
        filterMatch: chart.filterMatch === 'any' ? 'any' : 'all',
        aggregate: CHART_AGGREGATES.includes(chart.aggregate as ChartAggregate)
          ? (chart.aggregate as ChartAggregate)
          : 'count'
      }
    ]
  })
}

/** View rules evolved after plenty of projects had already been written to
 *  disk, so fill in the filter defaults the rest of the app expects. */
function normalizeView(view: View): View {
  const config = (view.config ?? {}) as Partial<TableViewConfig>
  return {
    ...view,
    config: {
      ...config,
      hiddenFieldIds: Array.isArray(config.hiddenFieldIds) ? config.hiddenFieldIds : [],
      filters: Array.isArray(config.filters) ? config.filters : [],
      filterMatch: config.filterMatch === 'any' ? 'any' : 'all',
      sorts: Array.isArray(config.sorts) ? config.sorts : [],
      ...(view.type === 'table'
        ? { audioPlayback: normalizeAudioPlayback(config.audioPlayback) }
        : {}),
      ...(view.type === 'dashboard'
        ? { charts: normalizeCharts((config as Partial<DashboardViewConfig>).charts) }
        : {}),
      ...(view.type === 'calendar' &&
      (config as Partial<CalendarViewConfig>).dateFieldId === LEGACY_CREATED_AT_DATE_SOURCE
        ? { dateFieldId: undefined }
        : {})
    }
  } as View
}

/** Records across every table — what the sidebar and project cards show. */
export function projectRecordCount(project: Project): number {
  return project.tables.reduce((total, table) => total + table.records.length, 0)
}
