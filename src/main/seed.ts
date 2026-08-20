import { newRecord, newView } from '@shared/defaults'
import type { Field, Project, SelectChoice } from '@shared/types'
import { listProjectIds, saveProject } from './storage'

const uuid = (): string => crypto.randomUUID()
const now = (): string => new Date().toISOString()

const choice = (name: string, color: SelectChoice['color']): SelectChoice => ({
  id: uuid(),
  name,
  color
})

// Seeds one demo project on first launch so every view has something to show.
export async function seedIfEmpty(): Promise<void> {
  if ((await listProjectIds()).length > 0) return

  const name: Field = { id: uuid(), name: 'Name', type: 'text' }
  const status: Field = {
    id: uuid(),
    name: 'Status',
    type: 'select',
    options: { choices: [choice('Backlog', 'gray'), choice('In Progress', 'blue'), choice('Shipped', 'green')] }
  }
  const priority: Field = {
    id: uuid(),
    name: 'Priority',
    type: 'select',
    options: { choices: [choice('Low', 'teal'), choice('Medium', 'amber'), choice('High', 'red')] }
  }
  const tags: Field = {
    id: uuid(),
    name: 'Tags',
    type: 'multiSelect',
    options: {
      choices: [choice('Design', 'purple'), choice('Engineering', 'indigo'), choice('Marketing', 'pink'), choice('Research', 'orange')]
    }
  }
  const due: Field = { id: uuid(), name: 'Due date', type: 'date' }
  const approved: Field = { id: uuid(), name: 'Approved', type: 'checkbox' }
  const spec: Field = { id: uuid(), name: 'Spec', type: 'url' }
  const cover: Field = { id: uuid(), name: 'Cover', type: 'image' }

  const c = (statusIdx: number, priorityIdx: number, tagIdxs: number[]): Record<string, unknown> => ({
    [status.id]: status.options!.choices[statusIdx].id,
    [priority.id]: priority.options!.choices[priorityIdx].id,
    [tags.id]: tagIdxs.map((i) => tags.options!.choices[i].id)
  })

  const rows: Array<Record<string, unknown>> = [
    {
      [name.id]: 'Onboarding redesign',
      ...c(1, 2, [0, 1]),
      [due.id]: '2026-08-21',
      [approved.id]: true,
      [spec.id]: 'https://example.com/specs/onboarding',
      [cover.id]: 'https://picsum.photos/seed/onboarding/640/400'
    },
    {
      [name.id]: 'Dark mode',
      ...c(2, 1, [0]),
      [due.id]: '2026-07-30',
      [approved.id]: true,
      [cover.id]: 'https://picsum.photos/seed/darkmode/640/400'
    },
    {
      [name.id]: 'Mobile app beta',
      ...c(1, 2, [1]),
      [due.id]: '2026-09-15',
      [approved.id]: false,
      [cover.id]: 'https://picsum.photos/seed/mobile/640/400'
    },
    {
      [name.id]: 'Launch newsletter',
      ...c(0, 0, [2]),
      [due.id]: '2026-10-01',
      [approved.id]: false,
      [cover.id]: 'https://picsum.photos/seed/newsletter/640/400'
    },
    {
      [name.id]: 'User interviews round 2',
      ...c(1, 1, [3]),
      [due.id]: '2026-08-12',
      [approved.id]: true,
      [cover.id]: 'https://picsum.photos/seed/interviews/640/400'
    },
    {
      [name.id]: 'Pricing page A/B test',
      ...c(0, 1, [2, 3]),
      [due.id]: '2026-09-05',
      [approved.id]: false,
      [cover.id]: 'https://picsum.photos/seed/pricing/640/400'
    },
    {
      [name.id]: 'API rate limiting',
      ...c(2, 2, [1]),
      [due.id]: '2026-07-18',
      [approved.id]: true,
      [spec.id]: 'https://example.com/specs/rate-limiting',
      [cover.id]: 'https://picsum.photos/seed/api/640/400'
    },
    {
      [name.id]: 'Design system audit',
      ...c(0, 0, [0]),
      [due.id]: '2026-11-02',
      [approved.id]: false,
      [cover.id]: 'https://picsum.photos/seed/audit/640/400'
    }
  ]

  const kanban = newView('kanban', 'Board')
  if (kanban.type === 'kanban') kanban.config.groupByFieldId = status.id
  const gallery = newView('gallery')
  if (gallery.type === 'gallery') gallery.config.coverFieldId = cover.id

  const project: Project = {
    id: uuid(),
    name: 'Product Roadmap',
    createdAt: now(),
    updatedAt: now(),
    tables: [
      {
        id: uuid(),
        name: 'Roadmap',
        fields: [name, status, priority, tags, due, approved, spec, cover],
        records: rows.map((values) => newRecord(values)),
        views: [newView('table', 'All items'), kanban, gallery]
      }
    ]
  }

  await saveProject(project)
}
