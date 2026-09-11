import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { resolve } from 'node:path'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  resolve: { alias: { '@': resolve('src/renderer/src'), '@shared': resolve('src/shared') } }
})
after(() => server.close())
const { chartData } = await server.ssrLoadModule('/src/renderer/src/lib/charts.ts')
const { applyFilters } = await server.ssrLoadModule('/src/renderer/src/lib/derive.ts')
const { deleteField, duplicateChart } = await server.ssrLoadModule('/src/renderer/src/lib/ops.ts')
const { migrateProject } = await server.ssrLoadModule('/src/shared/migrate.ts')
const fields = [
  { id: 'name', name: 'Name', type: 'text' },
  { id: 'value', name: 'Value', type: 'number' },
  { id: 'date', name: 'Date', type: 'date' },
  {
    id: 'tags',
    name: 'Tags',
    type: 'multiSelect',
    options: { choices: ['a', 'b', 'c'].map((id) => ({ id, name: id })) }
  }
]
const record = (id, value, date, tags = []) => ({ id, values: { name: id, value, date, tags } })
const records = [
  record('one', 10, '2026-01-01', ['a', 'b']),
  record('two', 20, '2026-03-01', ['a', 'c']),
  record('three', 30, '2026-03-02', ['b', 'c'])
]
const rule = (fieldId, operator, value) => ({ id: `${fieldId}-${value}`, fieldId, operator, value })
const spec = { id: 'chart', name: '', type: 'metric', aggregate: 'sum', valueFieldId: 'value' }

test('chart any/all rules narrow the dashboard slice without affecting siblings', () => {
  const visible = applyFilters(records, [rule('value', 'gt', 10)], fields)
  const filters = [rule('name', 'is', 'one'), rule('value', 'gt', 20)]
  const any = chartData({ ...spec, filters, filterMatch: 'any' }, fields, visible)
  assert.equal(any.total, 30)
  assert.deepEqual(any.recordIds, ['three'])
  assert.equal(chartData({ ...spec, filters, filterMatch: 'all' }, fields, visible).recordCount, 0)
  assert.equal(chartData(spec, fields, visible).total, 50)
  assert.equal(records.length, 3)
})

test('date drill-down includes only the filtered rows and preserves empty buckets', () => {
  const data = chartData(
    {
      ...spec,
      type: 'line',
      aggregate: 'count',
      groupByFieldId: 'date',
      filters: [rule('value', 'lt', 30)]
    },
    fields,
    records
  )
  assert.deepEqual(
    data.buckets.map((b) => b.recordIds),
    [['one'], [], ['two']]
  )
  assert.deepEqual(
    data.buckets.map((b) => b.value),
    [1, 0, 1]
  )
})

test('Other drill-down deduplicates rows shared by multiple folded categories', () => {
  const data = chartData(
    { ...spec, type: 'bar', aggregate: 'count', groupByFieldId: 'tags', limit: 2 },
    fields,
    records
  )
  const other = data.buckets.find((b) => b.key === '__other__')
  assert.equal(other.count, 4)
  assert.deepEqual([...other.recordIds].sort(), ['one', 'three', 'two'])
  assert.deepEqual(data.buckets[0].recordIds, ['one', 'two'])
})

test('relation buckets carry source record IDs, not linked record IDs', () => {
  const relation = { id: 'link', name: 'Link', type: 'relation', relation: { tableId: 'target' } }
  const rows = [{ id: 'source', values: { link: ['linked'] } }]
  const data = chartData(
    { ...spec, type: 'donut', aggregate: 'count', groupByFieldId: 'link' },
    [relation],
    rows,
    [{ id: 'target', fields, records: [record('linked', 1)] }]
  )
  assert.deepEqual(data.buckets[0].recordIds, ['source'])
})

test('saved chart filters survive migration and duplication, and field deletion cleans them', () => {
  const chart = { ...spec, filters: [rule('value', 'gt', 10)], filterMatch: 'any' }
  const table = {
    id: 'table',
    name: 'Table',
    fields,
    records,
    views: [
      {
        id: 'view',
        name: 'Dashboard',
        type: 'dashboard',
        config: {
          charts: [chart],
          filters: [],
          filterMatch: 'all',
          sorts: [],
          hiddenFieldIds: []
        }
      }
    ]
  }
  const migrated = migrateProject(JSON.parse(JSON.stringify({ id: 'project', tables: [table] })))
    .tables[0]
  assert.deepEqual(migrated.views[0].config.charts[0].filters, chart.filters)
  assert.equal(migrated.views[0].config.charts[0].filterMatch, 'any')
  const duplicated = duplicateChart(migrated, 'view', 'chart')
  assert.deepEqual(duplicated.views[0].config.charts[1].filters, chart.filters)
  assert.notEqual(duplicated.views[0].config.charts[1].id, chart.id)
  assert.deepEqual(
    deleteField(duplicated, 'value').views[0].config.charts.map((c) => c.filters),
    [[], []]
  )
  table.views[0].config.charts = [spec]
  const legacy = migrateProject({ id: 'project', tables: [table] }).tables[0].views[0].config
    .charts[0]
  assert.deepEqual(legacy.filters, [])
  assert.equal(legacy.filterMatch, 'all')
})
