import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { resolve } from 'node:path'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
  resolve: { alias: { '@': resolve('src/renderer/src') } }
})
after(() => server.close())
const { updateRowSelection } = await server.ssrLoadModule(
  '/src/renderer/src/lib/rowSelection.ts'
)

const rows = ['a', 'b', 'c', 'd', 'e']

test('shift selection checks an inclusive range in displayed order', () => {
  const selected = updateRowSelection(new Set(['a']), rows, 'b', 'e', true, true)
  assert.deepEqual([...selected], ['a', 'b', 'c', 'd', 'e'])
})

test('shift selection works upward and preserves selections outside the range', () => {
  const selected = updateRowSelection(new Set(['e']), rows, 'd', 'b', true, true)
  assert.deepEqual([...selected], ['e', 'b', 'c', 'd'])
})

test('shift unchecking clears the range and a missing anchor toggles only the target', () => {
  const selected = updateRowSelection(new Set(rows), rows, 'b', 'd', false, true)
  assert.deepEqual([...selected], ['a', 'e'])

  const fallback = updateRowSelection(new Set(['a']), rows, 'hidden', 'c', true, true)
  assert.deepEqual([...fallback], ['a', 'c'])
})
