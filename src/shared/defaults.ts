import {
  type Field,
  type Project,
  type RecordRow,
  type Table,
  type View
} from './types'

const uuid = (): string => crypto.randomUUID()
const now = (): string => new Date().toISOString()

export function newRecord(values: Record<string, unknown> = {}): RecordRow {
  return { id: uuid(), createdAt: now(), values }
}

export function newView(type: View['type'], name?: string): View {
  const base = {
    id: uuid(),
    name:
      name ??
      {
        table: 'Table',
        kanban: 'Kanban',
        gallery: 'Gallery',
        calendar: 'Calendar',
        dashboard: 'Dashboard'
      }[type]
  }
  switch (type) {
    case 'table':
      return {
        ...base,
        type,
        config: {
          hiddenFieldIds: [],
          filters: [],
          filterMatch: 'all',
          sorts: [],
          rowHeight: 'short'
        }
      }
    case 'kanban':
      return {
        ...base,
        type,
        config: { hiddenFieldIds: [], filters: [], filterMatch: 'all', sorts: [] }
      }
    case 'gallery':
      return {
        ...base,
        type,
        config: { hiddenFieldIds: [], filters: [], filterMatch: 'all', sorts: [] }
      }
    case 'calendar':
      return {
        ...base,
        type,
        config: {
          hiddenFieldIds: [],
          filters: [],
          filterMatch: 'all',
          sorts: [],
          mode: 'month',
          showHours: true
        }
      }
    case 'dashboard':
      return {
        ...base,
        type,
        config: { hiddenFieldIds: [], filters: [], filterMatch: 'all', sorts: [], charts: [] }
      }
  }
}

/** A fresh table with the starter schema every new project/table gets. */
export function newTable(name: string): Table {
  const nameField: Field = { id: uuid(), name: 'Name', type: 'text' }
  const statusField: Field = {
    id: uuid(),
    name: 'Status',
    type: 'select',
    options: {
      choices: [
        { id: uuid(), name: 'Todo', color: 'gray' },
        { id: uuid(), name: 'In Progress', color: 'blue' },
        { id: uuid(), name: 'Done', color: 'green' }
      ]
    }
  }
  const notesField: Field = { id: uuid(), name: 'Notes', type: 'text' }

  const kanban = newView('kanban')
  if (kanban.type === 'kanban') kanban.config.groupByFieldId = statusField.id

  return {
    id: uuid(),
    name,
    fields: [nameField, statusField, notesField],
    records: [newRecord(), newRecord(), newRecord()],
    views: [newView('table'), kanban, newView('gallery')]
  }
}

export function newProject(name: string): Project {
  return {
    id: uuid(),
    name,
    createdAt: now(),
    updatedAt: now(),
    tables: [newTable('Table')]
  }
}
