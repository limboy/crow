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
  const chart = {
    ...spec,
    filters: [rule('value', 'gt', 10)],
    filterMatch: 'any',
    pageByFieldId: 'date'
  }
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
  assert.equal(migrated.views[0].config.charts[0].pageByFieldId, 'date')
  const duplicated = duplicateChart(migrated, 'view', 'chart')
  assert.deepEqual(duplicated.views[0].config.charts[1].filters, chart.filters)
  assert.notEqual(duplicated.views[0].config.charts[1].id, chart.id)
  assert.deepEqual(
    deleteField(duplicated, 'value').views[0].config.charts.map((c) => c.filters),
    [[], []]
  )
  assert.deepEqual(
    deleteField(duplicated, 'date').views[0].config.charts.map((c) => c.pageByFieldId),
    [undefined, undefined]
  )
  table.views[0].config.charts = [spec]
  const legacy = migrateProject({ id: 'project', tables: [table] }).tables[0].views[0].config
    .charts[0]
  assert.deepEqual(legacy.filters, [])
  assert.equal(legacy.filterMatch, 'all')
})

test('a trimmed timeline pages back through the run, newest window first', () => {
  const rows = ['01', '02', '03', '04', '05'].map((month, i) =>
    record(`r${i}`, 1, `2026-${month}-01`)
  )
  const timeline = {
    ...spec,
    type: 'column',
    aggregate: 'count',
    groupByFieldId: 'date',
    limit: 2
  }
  const latest = chartData(timeline, fields, rows)
  assert.deepEqual(latest.buckets.map((b) => b.key), ['2026-04', '2026-05'])
  assert.deepEqual([latest.trimmedBefore, latest.trimmedAfter, latest.page], [3, 0, 0])
  const back = chartData(timeline, fields, rows, [], 1)
  assert.deepEqual(back.buckets.map((b) => b.key), ['2026-02', '2026-03'])
  assert.deepEqual([back.trimmedBefore, back.trimmedAfter, back.page], [1, 2, 1])
  // A page past the end clamps to the oldest window and reports where it landed,
  // so the next step forward still moves.
  const oldest = chartData(timeline, fields, rows, [], 9)
  assert.deepEqual(oldest.buckets.map((b) => b.key), ['2026-01'])
  assert.deepEqual([oldest.trimmedBefore, oldest.trimmedAfter, oldest.page], [0, 4, 2])
})

test('donut and line charts paginate under different days with distinct slice colors', () => {
  const rows = ['01', '02', '03', '04', '05'].map((day, i) =>
    record(`r${i}`, 1, `2026-09-${day}`)
  )
  const donutSpec = {
    ...spec,
    type: 'donut',
    aggregate: 'count',
    groupByFieldId: 'date',
    dateGrain: 'day',
    limit: 3
  }
  const donutData = chartData(donutSpec, fields, rows)
  assert.deepEqual(donutData.buckets.map((b) => b.key), ['2026-09-03', '2026-09-04', '2026-09-05'])
  assert.deepEqual([donutData.trimmedBefore, donutData.trimmedAfter, donutData.page], [2, 0, 0])
  // Each chronological slice must have a distinct colorIndex
  assert.deepEqual(donutData.buckets.map((b) => b.colorIndex), [0, 1, 2])
  const olderDonutData = chartData(donutSpec, fields, rows, [], 1)
  assert.deepEqual(olderDonutData.buckets.map((b) => b.key), ['2026-09-01', '2026-09-02'])
  assert.deepEqual(
    [olderDonutData.trimmedBefore, olderDonutData.trimmedAfter, olderDonutData.page],
    [0, 3, 1]
  )

  const lineSpec = {
    ...spec,
    type: 'line',
    aggregate: 'count',
    groupByFieldId: 'date',
    dateGrain: 'day',
    limit: 3
  }
  const lineData = chartData(lineSpec, fields, rows)
  assert.deepEqual(lineData.buckets.map((b) => b.key), ['2026-09-03', '2026-09-04', '2026-09-05'])
  assert.deepEqual([lineData.trimmedBefore, lineData.trimmedAfter, lineData.page], [2, 0, 0])
  const olderLineData = chartData(lineSpec, fields, rows, [], 1)
  assert.deepEqual(olderLineData.buckets.map((b) => b.key), ['2026-09-01', '2026-09-02'])
  assert.deepEqual(
    [olderLineData.trimmedBefore, olderLineData.trimmedAfter, olderLineData.page],
    [0, 3, 1]
  )
})

test('categorical donut and line charts page through a separate date field week by week', () => {
  const rows = [
    record('older-ten', 10, '2026-09-07'),
    record('older-twenty', 20, '2026-09-08'),
    record('latest-thirty-a', 30, '2026-09-14'),
    record('latest-thirty-b', 30, '2026-09-15'),
    record('latest-forty', 40, '2026-09-16')
  ]
  const pagedCategories = {
    ...spec,
    aggregate: 'count',
    groupByFieldId: 'value',
    pageByFieldId: 'date',
    dateGrain: 'week',
    limit: 6
  }

  const latestDonut = chartData({ ...pagedCategories, type: 'donut' }, fields, rows)
  assert.equal(latestDonut.pageLabel, 'Sep 14–20, 2026')
  assert.deepEqual(
    latestDonut.buckets.map((bucket) => [bucket.label, bucket.value]),
    [
      ['30', 2],
      ['40', 1]
    ]
  )
  assert.deepEqual([latestDonut.trimmedBefore, latestDonut.trimmedAfter], [1, 0])

  const olderDonut = chartData({ ...pagedCategories, type: 'donut' }, fields, rows, [], 1)
  assert.equal(olderDonut.pageLabel, 'Sep 7–13, 2026')
  assert.deepEqual(
    olderDonut.buckets.map((bucket) => [bucket.label, bucket.value]),
    [
      ['10', 1],
      ['20', 1]
    ]
  )
  assert.deepEqual([olderDonut.trimmedBefore, olderDonut.trimmedAfter], [0, 1])

  const olderLine = chartData({ ...pagedCategories, type: 'line' }, fields, rows, [], 1)
  assert.equal(olderLine.pageLabel, 'Sep 7–13, 2026')
  assert.deepEqual(
    olderLine.buckets.map((bucket) => [bucket.label, bucket.value]),
    [
      ['10', 1],
      ['20', 1]
    ]
  )

  const emptyMiddleWeek = chartData(
    { ...pagedCategories, type: 'donut' },
    fields,
    [record('first', 10, '2026-09-07'), record('last', 20, '2026-09-21')],
    [],
    1
  )
  assert.equal(emptyMiddleWeek.pageLabel, 'Sep 14–20, 2026')
  assert.deepEqual(emptyMiddleWeek.buckets, [])
  assert.deepEqual(
    [emptyMiddleWeek.trimmedBefore, emptyMiddleWeek.trimmedAfter, emptyMiddleWeek.page],
    [1, 1, 1]
  )
})
