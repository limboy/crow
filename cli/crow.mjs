#!/usr/bin/env node
/**
 * crow CLI — lets scripts and AI agents read and write Crow projects.
 *
 * It operates directly on the same JSON files the desktop app uses
 * (userData/projects/<project-id>/data.json, with that project's
 * images/audio/video alongside it). The app watches the projects directory, so changes made here
 * show up live in an open window. All output is JSON on stdout; errors are
 * JSON on stderr with a non-zero exit code. Run `crow help` for the full
 * command reference.
 */
import { promises as fs, existsSync, readFileSync } from 'fs'
import { join, extname, basename } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'

const SAFE_ID = /^[a-zA-Z0-9-]+$/

const FIELD_TYPES = ['text', 'number', 'select', 'multiSelect', 'date', 'checkbox', 'url', 'image', 'audio', 'video', 'relation', 'rating', 'attachment', 'createdTime', 'lastModifiedTime']

/** Field types the app fills in from the record's own timestamps. They have no
 *  stored value, so nothing may write to them. */
const COMPUTED_FIELD_TYPES = ['createdTime', 'lastModifiedTime']

/** How a createdTime/lastModifiedTime field renders in the app; the CLI only
 *  stores the choice, and always reads the value back as its ISO instant. */
const DATE_FORMATS = ['slash', 'slashTime', 'slashTimeZone', 'dash', 'dashTime', 'dashTimeZone']

const isComputedField = (type) => COMPUTED_FIELD_TYPES.includes(type)

/** The value a field reads for a record, whether it's stored or derived. */
function cellValue(field, record) {
  if (field.type === 'createdTime') return record.createdAt
  if (field.type === 'lastModifiedTime') return record.updatedAt ?? record.createdAt
  return record.values[field.id]
}

const CHOICE_COLORS = ['gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink']

const uuid = () => randomUUID()
const now = () => new Date().toISOString()

// ---------------------------------------------------------------------------
// Data directory (must match Electron's app.getPath('userData') for "crow")
// ---------------------------------------------------------------------------

// Electron's userData path — fixed regardless of where the user points the
// app's data at. This is also where the app's config.json (which records
// that choice) always lives, so it doubles as the anchor for finding it.
function platformDefaultDir() {
  const home = homedir()
  switch (process.platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'crow')
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'crow')
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'crow')
  }
}

// Mirrors src/main/config.ts: the app lets the user relocate its data
// directory (e.g. into Dropbox), recording the choice in a config.json that
// always lives at the platform-default path. Follow the same rule here so
// the CLI reads/writes wherever the app actually is right now.
function configuredDataDir() {
  try {
    const config = JSON.parse(readFileSync(join(platformDefaultDir(), 'config.json'), 'utf-8'))
    if (config.dataDir && existsSync(config.dataDir)) return config.dataDir
  } catch {
    // no config.json, or it's unreadable/malformed — fall through to default
  }
  return null
}

function dataDir() {
  if (process.env.CROW_DIR) return process.env.CROW_DIR
  return configuredDataDir() ?? platformDefaultDir()
}

const projectsRootDir = () => join(dataDir(), 'projects')
const projectDir = (id) => join(projectsRootDir(), id)
const projectFile = (id) => join(projectDir(id), 'data.json')
const imagesDir = (id) => join(projectDir(id), 'images')
const audioDir = (id) => join(projectDir(id), 'audio')
const videoDir = (id) => join(projectDir(id), 'video')
const attachmentsDir = (id) => join(projectDir(id), 'attachments')

// ---------------------------------------------------------------------------
// Storage (same format + atomic write strategy as the app)
// ---------------------------------------------------------------------------

async function listProjectIds() {
  let entries
  try {
    entries = await fs.readdir(projectsRootDir(), { withFileTypes: true })
  } catch {
    return []
  }
  return entries.filter((e) => e.isDirectory() && SAFE_ID.test(e.name)).map((e) => e.name)
}

/**
 * Mirrors src/shared/migrate.ts: projects saved before multi-table support
 * keep fields/records/views at the top level, and that becomes their single
 * table. Applied on read only — the file is upgraded the next time it's saved.
 */
function migrateProject(project) {
  let migrated = project
  if (!Array.isArray(project.tables)) {
    const { fields, records, views, ...rest } = project
    migrated = {
      ...rest,
      tables: [
        {
          id: uuid(),
          name: project.name?.trim() || 'Table',
          fields: Array.isArray(fields) ? fields : [],
          records: Array.isArray(records) ? records : [],
          views: Array.isArray(views) ? views : []
        }
      ]
    }
  }
  return normalizeRelationPairs(migrated)
}

async function readAllProjects() {
  const ids = await listProjectIds()
  const projects = []
  for (const id of ids) {
    try {
      projects.push(migrateProject(JSON.parse(await fs.readFile(projectFile(id), 'utf-8'))))
    } catch {
      // skip unreadable files rather than failing the whole list
    }
  }
  return projects
}

function recordCount(project) {
  return project.tables.reduce((total, table) => total + table.records.length, 0)
}

async function saveProject(project) {
  await fs.mkdir(projectDir(project.id), { recursive: true })
  const target = projectFile(project.id)
  const tmp = `${target}.tmp`
  await fs.writeFile(tmp, JSON.stringify(project, null, 2), 'utf-8')
  await fs.rename(tmp, target)
}

async function mutateProject(ref, fn) {
  const project = await resolveProject(ref)
  const result = fn(project)
  project.updatedAt = now()
  await saveProject(project)
  return result
}

async function resolveProject(ref) {
  const projects = await readAllProjects()
  if (projects.length === 0) fail(`No projects found in ${dataDir()}`)
  const byId = projects.find((p) => p.id === ref)
  if (byId) return byId
  const byName = projects.filter((p) => p.name.toLowerCase() === ref.toLowerCase())
  if (byName.length === 1) return byName[0]
  if (byName.length > 1) fail(`Project name "${ref}" is ambiguous; use an id: ${byName.map((p) => p.id).join(', ')}`)
  const byPrefix = projects.filter((p) => p.id.startsWith(ref))
  if (byPrefix.length === 1) return byPrefix[0]
  fail(`No project matches "${ref}". Available: ${projects.map((p) => `${p.name} (${p.id})`).join(', ')}`)
}

/**
 * Picks the table a command operates on. With no --table, a single-table
 * project resolves unambiguously; a multi-table one refuses rather than
 * guessing, so a script can't silently write into the wrong table.
 */
function resolveTable(project, ref) {
  const tables = project.tables ?? []
  if (tables.length === 0) fail(`Project "${project.name}" has no tables`)
  if (ref === undefined || ref === true) {
    if (tables.length === 1) return tables[0]
    fail(`Project "${project.name}" has ${tables.length} tables; pass --table <name>: ${tables.map((t) => t.name).join(', ')}`)
  }
  const byId = tables.find((t) => t.id === ref)
  if (byId) return byId
  const byName = tables.filter((t) => t.name.toLowerCase() === String(ref).toLowerCase())
  if (byName.length === 1) return byName[0]
  if (byName.length > 1) fail(`Table name "${ref}" is ambiguous in project "${project.name}"`)
  fail(`No table named "${ref}" in project "${project.name}". Tables: ${tables.map((t) => t.name).join(', ')}`)
}

function resolveRecord(table, ref) {
  const exact = table.records.find((r) => r.id === ref)
  if (exact) return exact
  const byPrefix = table.records.filter((r) => r.id.startsWith(ref))
  if (byPrefix.length === 1) return byPrefix[0]
  if (byPrefix.length > 1) fail(`Record id prefix "${ref}" is ambiguous (${byPrefix.length} matches)`)
  fail(`No record with id "${ref}" in table "${table.name}"`)
}

function resolveField(table, name) {
  const matches = table.fields.filter((f) => f.name.toLowerCase() === String(name).toLowerCase())
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) fail(`Field name "${name}" is ambiguous in table "${table.name}"`)
  fail(`No field named "${name}" in table "${table.name}". Fields: ${table.fields.map((f) => f.name).join(', ')}`)
}

/** The table a relation field links to, or undefined if it's been deleted. */
function linkedTable(project, field) {
  return project.tables.find((t) => t.id === field.relation?.tableId)
}

/**
 * Resolves the table a relation field points at. Unlike --table this never
 * guesses: a link has to name its target, even in a single-table project.
 */
function linkTargetFor(project, ref, fieldName) {
  if (ref === undefined || ref === true || ref === '') {
    fail(`Field "${fieldName}" is a relation; name the table it links to with --link-table <name>`)
  }
  return resolveTable(project, ref)
}

/** How a record reads when linked from another table: its first field's
 *  value, matching the label the app shows. Never follows a relation — one
 *  level is enough to name a row, and it can't recurse. */
function recordLabel(table, record) {
  const primary = table.fields[0]
  const raw = primary ? cellValue(primary, record) : undefined
  if (primary === undefined || raw === undefined || raw === null || raw === '') return 'Untitled'
  if (primary.type === 'select') return choiceName(primary, raw) ?? 'Untitled'
  if (primary.type === 'multiSelect') {
    const names = (Array.isArray(raw) ? raw : []).map((id) => choiceName(primary, id)).filter(Boolean)
    return names.length > 0 ? names.join(', ') : 'Untitled'
  }
  if (primary.type === 'relation') return 'Untitled'
  // Both store an object, which has no useful text form.
  if (primary.type === 'video' || primary.type === 'attachment') return 'Untitled'
  if (primary.type === 'checkbox') return raw === true ? 'Checked' : 'Untitled'
  return String(raw)
}

/** One link target: a record id, a unique id prefix, or the text of the
 *  linked record's first field. */
function linkedRecordId(table, field, ref) {
  const text = String(ref)
  if (table.records.some((r) => r.id === text)) return text
  const byLabel = table.records.filter((r) => recordLabel(table, r).toLowerCase() === text.toLowerCase())
  if (byLabel.length === 1) return byLabel[0].id
  if (byLabel.length > 1) fail(`Field "${field.name}": "${text}" matches ${byLabel.length} records in "${table.name}"; link by record id instead`)
  const byPrefix = table.records.filter((r) => r.id.startsWith(text))
  if (byPrefix.length === 1) return byPrefix[0].id
  if (byPrefix.length > 1) fail(`Field "${field.name}": record id prefix "${text}" is ambiguous in "${table.name}"`)
  fail(`Field "${field.name}": no record in "${table.name}" named "${text}" (and no record id matches)`)
}

// ---------------------------------------------------------------------------
// Value conversion: field-name-keyed human values <-> field-id-keyed stored values
// ---------------------------------------------------------------------------

function choiceName(field, id) {
  return field.options?.choices.find((c) => c.id === id)?.name
}

/** Finds a choice by name, creating it (with the next cycle color) if missing. */
function choiceIdFor(field, name) {
  const choices = (field.options ??= { choices: [] }).choices
  const existing = choices.find((c) => c.name.toLowerCase() === String(name).toLowerCase())
  if (existing) return existing.id
  const choice = { id: uuid(), name: String(name), color: CHOICE_COLORS[choices.length % CHOICE_COLORS.length] }
  choices.push(choice)
  return choice.id
}

async function coerceValue(field, value, project) {
  if (isComputedField(field.type)) {
    fail(`Field "${field.name}" is a ${field.type} field; the app keeps it from the record itself and it can't be written to`)
  }
  const projectId = project.id
  if (value === null) return null
  switch (field.type) {
    case 'text':
    case 'url':
      return String(value)
    case 'number': {
      const num = Number(value)
      if (typeof value === 'boolean' || value === '' || Number.isNaN(num)) {
        fail(`Field "${field.name}" expects a number, got ${JSON.stringify(value)}`)
      }
      return num
    }
    case 'rating': {
      const num = Number(value)
      if (typeof value === 'boolean' || value === '' || !Number.isInteger(num) || num < 1 || num > 5) {
        fail(`Field "${field.name}" expects a rating from 1 to 5, got ${JSON.stringify(value)}`)
      }
      return num
    }
    case 'checkbox': {
      if (typeof value === 'boolean') return value
      if (value === 'true' || value === 1 || value === '1') return true
      if (value === 'false' || value === 0 || value === '0') return false
      fail(`Field "${field.name}" expects true or false, got ${JSON.stringify(value)}`)
      break
    }
    case 'date': {
      const str = String(value)
      const local = /^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{1,2}):(\d{2}))?$/.exec(str)
      if (local) {
        const parsedDay = new Date(`${local[1]}T00:00:00`)
        const [year, month, day] = local[1].split('-').map(Number)
        const validDay =
          !Number.isNaN(parsedDay.getTime()) &&
          parsedDay.getFullYear() === year &&
          parsedDay.getMonth() === month - 1 &&
          parsedDay.getDate() === day
        if (validDay) {
          if (!local[2]) return local[1]
          const hour = Number(local[2])
          const minute = Number(local[3])
          if (hour < 24 && minute < 60) {
            return `${local[1]}T${String(hour).padStart(2, '0')}:${local[3]}`
          }
        }
      }
      const date = new Date(str)
      if (Number.isNaN(date.getTime())) {
        fail(`Field "${field.name}" expects a date or local date-time (YYYY-MM-DD[THH:mm]), got ${JSON.stringify(value)}`)
      }
      const pad = (n) => String(n).padStart(2, '0')
      const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      const hasTime = /\d:\d|\b(?:am|pm)\b/i.test(str)
      return hasTime ? `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}` : day
    }
    case 'select':
      return choiceIdFor(field, value)
    case 'multiSelect': {
      const names = Array.isArray(value) ? value : [value]
      return names.map((n) => choiceIdFor(field, n))
    }
    case 'relation': {
      const target = linkedTable(project, field)
      if (!target) fail(`Field "${field.name}" links to a table that no longer exists`)
      const refs = Array.isArray(value) ? value : [value]
      const ids = refs.map((ref) => linkedRecordId(target, field, ref))
      if (field.relation.multiple === false && ids.length > 1) {
        fail(`Field "${field.name}" links to a single record, got ${ids.length}`)
      }
      return ids
    }
    case 'image': {
      const str = String(value)
      if (str.startsWith('app-image://')) return str
      if (!existsSync(str)) {
        fail(`Field "${field.name}" expects a local image file path or app-image:// URL, got ${JSON.stringify(value)}`)
      }
      await fs.mkdir(imagesDir(projectId), { recursive: true })
      const name = `${uuid()}${extname(str).toLowerCase() || '.png'}`
      await fs.copyFile(str, join(imagesDir(projectId), name))
      return `app-image:///${projectId}/${name}`
    }
    case 'audio': {
      const str = String(value)
      if (str.startsWith('app-audio://')) return str
      if (!existsSync(str)) {
        fail(`Field "${field.name}" expects a local audio file path or app-audio:// URL, got ${JSON.stringify(value)}`)
      }
      await fs.mkdir(audioDir(projectId), { recursive: true })
      const name = `${uuid()}${extname(str).toLowerCase() || '.mp3'}`
      await fs.copyFile(str, join(audioDir(projectId), name))
      return `app-audio:///${projectId}/${name}`
    }
    case 'video': {
      // Already a stored value — read back from another record, say — is kept
      // whole, cover frame and all: capturing one needs a video decoder, so
      // the app is the only thing that can produce it.
      if (value && typeof value === 'object' && typeof value.url === 'string') {
        const kept = { url: value.url }
        if (typeof value.name === 'string') kept.name = value.name
        if (typeof value.poster === 'string') kept.poster = value.poster
        return kept
      }
      const str = String(value)
      if (str.startsWith('app-video://')) return { url: str }
      if (!existsSync(str)) {
        fail(`Field "${field.name}" expects a local video file path, app-video:// URL, or {url,name} object, got ${JSON.stringify(value)}`)
      }
      await fs.mkdir(videoDir(projectId), { recursive: true })
      const name = `${uuid()}${extname(str).toLowerCase() || '.mp4'}`
      await fs.copyFile(str, join(videoDir(projectId), name))
      return { url: `app-video:///${projectId}/${name}`, name: basename(str) }
    }
    case 'attachment': {
      const items = Array.isArray(value) ? value : [value]
      // Every item is resolved before any of them is copied. Failing halfway
      // through would exit with files already written into the store that no
      // record points at, and nothing ever collects those but the app's own
      // sweep — a day later, at best.
      const plan = items.map((item) => {
        // Already a stored reference (e.g. read back from another record) —
        // keep it, and whatever name it already carries.
        if (item && typeof item === 'object' && typeof item.url === 'string') {
          return { keep: { url: item.url, name: item.name ?? basename(item.url), size: item.size } }
        }
        const str = String(item)
        if (str.startsWith('app-attachment://')) return { keep: { url: str, name: basename(str) } }
        if (!existsSync(str)) {
          fail(`Field "${field.name}" expects a local file path, app-attachment:// URL, or {url,name} object, got ${JSON.stringify(item)}`)
        }
        return { source: str }
      })
      const attachments = []
      for (const step of plan) {
        if (step.keep) {
          attachments.push(step.keep)
          continue
        }
        await fs.mkdir(attachmentsDir(projectId), { recursive: true })
        const originalName = basename(step.source)
        const name = `${uuid()}${extname(step.source)}`
        await fs.copyFile(step.source, join(attachmentsDir(projectId), name))
        const stat = await fs.stat(join(attachmentsDir(projectId), name))
        attachments.push({ url: `app-attachment:///${projectId}/${name}`, name: originalName, size: stat.size })
      }
      return attachments
    }
  }
  return value
}

/** Applies field-name-keyed input values onto a record's field-id-keyed store. */
async function applyValues(table, record, input, project) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail('Values must be a JSON object keyed by field name, e.g. {"Name": "Buy milk", "Status": "Todo"}')
  }
  const changedRelations = new Set()
  for (const [name, value] of Object.entries(input)) {
    const field = resolveField(table, name)
    if (value === null) {
      delete record.values[field.id]
    } else {
      record.values[field.id] = await coerceValue(field, value, project)
    }
    if (field.type === 'relation') changedRelations.add(field.id)
  }
  return changedRelations
}

/** Stored record -> agent-friendly shape (values keyed by field name, choices
 *  and linked records by name). */
function humanize(table, record, project) {
  const values = {}
  for (const field of table.fields) {
    const raw = cellValue(field, record)
    if (raw === undefined || raw === null) continue
    if (field.type === 'select') {
      const name = choiceName(field, raw)
      if (name !== undefined) values[field.name] = name
    } else if (field.type === 'multiSelect') {
      const names = (Array.isArray(raw) ? raw : []).map((id) => choiceName(field, id)).filter((n) => n !== undefined)
      if (names.length > 0) values[field.name] = names
    } else if (field.type === 'relation') {
      // Links whose record is gone are dropped, the way the app renders them.
      const target = linkedTable(project, field)
      if (!target) continue
      const labels = (Array.isArray(raw) ? raw : [])
        .map((id) => target.records.find((r) => r.id === id))
        .filter((r) => r !== undefined)
        .map((r) => recordLabel(target, r))
      if (labels.length > 0) values[field.name] = labels
    } else {
      values[field.name] = raw
    }
  }
  return { id: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt ?? record.createdAt, values }
}

function matchesWhere(humanized, where) {
  return Object.entries(where).every(([name, expected]) => {
    const actual = humanized.values[name]
    if (expected === null) return actual === undefined
    if (Array.isArray(actual)) return actual.includes(expected)
    return actual === expected
  })
}

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

function buildField(name, type, choiceNames = [], relation, dateFormat) {
  if (!FIELD_TYPES.includes(type)) {
    fail(`Unknown field type "${type}". Valid types: ${FIELD_TYPES.join(', ')}`)
  }
  if (dateFormat !== undefined && !DATE_FORMATS.includes(dateFormat)) {
    fail(`Unknown date format "${dateFormat}". Valid formats: ${DATE_FORMATS.join(', ')}`)
  }
  const field = { id: uuid(), name, type }
  if (isComputedField(type)) field.dateFormat = dateFormat ?? DATE_FORMATS[0]
  if (type === 'select' || type === 'multiSelect') {
    field.options = {
      choices: choiceNames.map((n, i) => ({ id: uuid(), name: n, color: CHOICE_COLORS[i % CHOICE_COLORS.length] }))
    }
  }
  if (type === 'relation') field.relation = { ...relation, inverseFieldId: relation.inverseFieldId ?? uuid() }
  return field
}

function assertFieldNameFree(table, name) {
  if (table.fields.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
    fail(`Table "${table.name}" already has a field named "${name}"`)
  }
}

/** Removes the field plus every reference to it in records and view configs. */
function deleteFieldEverywhere(table, fieldId) {
  table.fields = table.fields.filter((f) => f.id !== fieldId)
  for (const record of table.records) delete record.values[fieldId]
  for (const view of table.views) {
    const config = view.config
    config.hiddenFieldIds = (config.hiddenFieldIds ?? []).filter((id) => id !== fieldId)
    if (config.filters) config.filters = config.filters.filter((f) => f.fieldId !== fieldId)
    if (config.sorts) config.sorts = config.sorts.filter((s) => s.fieldId !== fieldId)
    if (config.groupByFieldId === fieldId) config.groupByFieldId = undefined
    if (config.coverFieldId === fieldId) config.coverFieldId = undefined
    if (config.dateFieldId === fieldId) config.dateFieldId = undefined
    // A dashboard chart that read the field keeps its place and falls back to
    // the app's "pick a field" prompt.
    for (const chart of config.charts ?? []) {
      if (chart.filters) chart.filters = chart.filters.filter((rule) => rule.fieldId !== fieldId)
      if (chart.groupByFieldId === fieldId) chart.groupByFieldId = undefined
      if (chart.valueFieldId === fieldId) chart.valueFieldId = undefined
    }
  }
}

function relationIds(value) {
  return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []
}

function setRelationIds(record, fieldId, ids) {
  if (ids.length === 0) delete record.values[fieldId]
  else record.values[fieldId] = ids
}

function uniqueFieldName(table, preferred) {
  const taken = new Set(table.fields.map((field) => field.name.toLowerCase()))
  if (!taken.has(preferred.toLowerCase())) return preferred
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${preferred} ${suffix}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

function ensureInverseField(project, source, field) {
  if (field.type !== 'relation' || !field.relation) return undefined
  const target = linkedTable(project, field)
  if (!target) {
    field.relation.inverseFieldId ??= uuid()
    return undefined
  }
  field.relation.inverseFieldId ||= uuid()
  let inverse = target.fields.find((candidate) => candidate.id === field.relation.inverseFieldId)
  const usable =
    inverse?.type === 'relation' &&
    inverse.relation?.tableId === source.id &&
    (!inverse.relation.inverseFieldId || inverse.relation.inverseFieldId === field.id) &&
    !(target.id === source.id && inverse.id === field.id)
  if (inverse && !usable) {
    field.relation.inverseFieldId = uuid()
    inverse = undefined
  }
  if (!inverse) {
    inverse = buildField(uniqueFieldName(target, source.name), 'relation', [], {
      tableId: source.id,
      multiple: true,
      inverseFieldId: field.id
    })
    inverse.id = field.relation.inverseFieldId
    target.fields.push(inverse)
  } else {
    inverse.relation.tableId = source.id
    inverse.relation.inverseFieldId = field.id
  }
  return { target, inverse }
}

function syncRelationField(project, source, field, beforeSource) {
  const pair = ensureInverseField(project, source, field)
  if (!pair) return
  const { target, inverse } = pair
  const validTargets = new Set(target.records.map((record) => record.id))
  const beforeLinks = new Map(
    (beforeSource?.records ?? []).map((record) => [record.id, relationIds(record.values[field.id])])
  )
  const links = new Map()
  for (const record of source.records) {
    const ids = [...new Set(relationIds(record.values[field.id]))].filter((id) => validTargets.has(id))
    links.set(record.id, field.relation.multiple === false ? ids.slice(0, 1) : ids)
  }

  if (inverse.relation.multiple === false) {
    for (const targetRecord of target.records) {
      const candidates = source.records
        .filter((record) => (links.get(record.id) ?? []).includes(targetRecord.id))
        .map((record) => record.id)
      if (candidates.length <= 1) continue
      const added = candidates.filter(
        (recordId) => !(beforeLinks.get(recordId) ?? []).includes(targetRecord.id)
      )
      const winner = added.at(-1) ?? candidates[0]
      for (const recordId of candidates) {
        if (recordId === winner) continue
        links.set(recordId, links.get(recordId).filter((id) => id !== targetRecord.id))
      }
    }
  }

  for (const record of source.records) setRelationIds(record, field.id, links.get(record.id) ?? [])
  const reverse = new Map(target.records.map((record) => [record.id, []]))
  for (const record of source.records) {
    for (const targetId of links.get(record.id) ?? []) reverse.get(targetId)?.push(record.id)
  }
  for (const record of target.records) {
    setRelationIds(record, inverse.id, reverse.get(record.id) ?? [])
  }
}

function syncTableRelations(project, table, beforeTable, onlyFieldIds) {
  for (const field of [...table.fields]) ensureInverseField(project, table, field)
  const processed = new Set()
  for (const field of table.fields) {
    if (field.type !== 'relation' || !field.relation) continue
    if (onlyFieldIds && !onlyFieldIds.has(field.id)) continue
    const pair = ensureInverseField(project, table, field)
    if (!pair) continue
    const key = [table.id, field.id, pair.target.id, pair.inverse.id].sort().join(':')
    if (processed.has(key)) continue
    processed.add(key)
    syncRelationField(project, table, field, beforeTable)
  }
}

function normalizeRelationPairs(project) {
  for (const table of project.tables) {
    for (const field of [...table.fields]) ensureInverseField(project, table, field)
  }
  const processed = new Set()
  for (const table of project.tables) {
    for (const field of table.fields) {
      if (field.type !== 'relation' || !field.relation) continue
      const pair = ensureInverseField(project, table, field)
      if (!pair) continue
      const key = [table.id, field.id, pair.target.id, pair.inverse.id].sort().join(':')
      if (processed.has(key)) continue
      processed.add(key)
      syncRelationField(project, table, field)
    }
  }
  return project
}

function deleteRelationField(project, table, field) {
  if (field.type === 'relation' && field.relation?.inverseFieldId) {
    const target = linkedTable(project, field)
    if (target) deleteFieldEverywhere(target, field.relation.inverseFieldId)
  }
  deleteFieldEverywhere(table, field.id)
}

function tableSchema(project, table) {
  return {
    id: table.id,
    name: table.name,
    recordCount: table.records.length,
    fields: table.fields.map((f) => ({
      name: f.name,
      type: f.type,
      ...(f.options ? { choices: f.options.choices.map((c) => c.name) } : {}),
      ...(isComputedField(f.type) ? { dateFormat: f.dateFormat ?? DATE_FORMATS[0] } : {}),
      ...(f.type === 'relation'
        ? {
            linkTable: linkedTable(project, f)?.name ?? null,
            inverseField: linkedTable(project, f)?.fields.find(
              (candidate) => candidate.id === f.relation?.inverseFieldId
            )?.name ?? null,
            multiple: f.relation?.multiple !== false
          }
        : {})
    })),
    views: table.views.map((v) => ({ name: v.name, type: v.type }))
  }
}

/** Whole project, or just one table when a command was scoped with --table. */
function schemaOf(project, table) {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    tables: (table ? [table] : project.tables).map((t) => tableSchema(project, t))
  }
}

/** A table with the given fields and the one table view the app needs to open it. */
function buildTable(name, fields) {
  return {
    id: uuid(),
    name,
    fields,
    records: [],
    views: [{ id: uuid(), name: 'Table', type: 'table', config: { hiddenFieldIds: [], filters: [], filterMatch: 'all', sorts: [], rowHeight: 'short' } }]
  }
}

/**
 * Turns a --fields JSON array into field definitions; defaults to one text
 * field. A relation spec names its target with `linkTable` (and may set
 * `multiple`); `self` is the table being created, so it can link to itself.
 */
function fieldsFromFlag(raw, project, self) {
  if (!raw) return [buildField('Name', 'text')]
  const specs = parseJsonArg(raw, '--fields')
  if (!Array.isArray(specs) || specs.length === 0) fail('--fields must be a non-empty JSON array')
  const scope = { ...project, tables: [...project.tables.filter((t) => t.id !== self.id), self] }
  const fields = specs.map((s) =>
    buildField(
      String(s.name),
      s.type,
      s.choices ?? [],
      s.type === 'relation'
        ? {
            tableId:
              typeof s.linkTable === 'string' && s.linkTable.toLowerCase() === 'self'
                ? self.id
                : linkTargetFor(scope, s.linkTable, String(s.name)).id,
            multiple: s.multiple !== false,
            inverseFieldId: uuid()
          }
        : undefined,
      s.dateFormat
    )
  )
  const names = fields.map((f) => f.name.toLowerCase())
  if (new Set(names).size !== names.length) fail('--fields contains duplicate field names')
  return fields
}

// ---------------------------------------------------------------------------
// CLI plumbing
// ---------------------------------------------------------------------------

function fail(message) {
  process.stderr.write(JSON.stringify({ error: message }) + '\n')
  process.exit(1)
}

function output(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n')
}

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positional.push(arg)
    }
  }
  return { positional, flags }
}

function parseJsonArg(raw, what) {
  try {
    return JSON.parse(raw)
  } catch {
    fail(`${what} must be valid JSON, got: ${raw}`)
  }
}

const HELP = `crow — CLI for the Crow desktop app, built for scripts and AI agents.

Data lives in ${dataDir()} (follows the app's configured data location;
override with CROW_DIR or --data-dir).
Changes appear live in the app if it is open. All output is JSON.
Projects are referenced by name or id; records by id (unique prefixes work).

A project holds one or more tables, each with its own fields, records and
views. Every record/field command takes --table <name>; it can be omitted when
the project has only one table, and is required when it has several.

COMMANDS
  help                                     Show this help
  info                                     Show data directory, project and table counts
  list-projects                            List all projects
  create-project <name> [--fields JSON] [--table NAME]
                                           Create a project with one table. --fields is a JSON
                                           array like
                                           '[{"name":"Title","type":"text"},
                                             {"name":"Status","type":"select","choices":["Todo","Done"]},
                                             {"name":"Author","type":"relation","linkTable":"People"}]'
                                           A relation spec names its target table with
                                           "linkTable" (the table being created counts) and may
                                           set "multiple": false to allow only one link. A paired
                                           field is created in the linked table automatically.
                                           Default: a single "Name" text field.
                                           --table names the table (default "Table").
  delete-project <project> --yes           Delete a project permanently (requires --yes)
  schema <project> [--table NAME]          Show fields, choices, views and record count, for
                                           every table or just one
  list-tables <project>                    List the project's tables
  create-table <project> <name> [--fields JSON]
                                           Add a table (same --fields format as create-project)
  rename-table <project> <table> --to <new-name>
                                           Rename a table
  delete-table <project> <table> --yes     Delete a table and all its records (requires --yes;
                                           a project always keeps at least one table)
  add-field <project> <name> <type> [--choices "A,B,C"] [--table NAME] [--date-format NAME]
                                           Add a field. Types: ${FIELD_TYPES.join(', ')}
                                           A relation field takes --link-table <name>, the table
                                           in the same project its records link to (may be its
                                           own table), plus --single to allow only one link. Its
                                           paired field is created automatically.
  delete-field <project> <name> [--table NAME]
                                           Remove a field and all its values
  list-records <project> [--table NAME] [--where JSON] [--limit N] [--offset N]
                                           List records. --where filters by equality on
                                           field-name-keyed values, e.g. '{"Status":"Todo"}'
                                           (multi-select matches if it contains the value,
                                           null matches empty).
  get-record <project> <record-id> [--table NAME]
                                           Show one record
  add-record <project> <values-json> [--table NAME]
                                           Create record(s). Values are keyed by field name;
                                           pass an array of objects to create several at once.
  update-record <project> <record-id> <values-json> [--table NAME]
                                           Merge values into a record (only listed fields change)
  delete-record <project> <record-id> [--table NAME]
                                           Delete a record

VALUE FORMATS (per field type, when writing)
  text, url     string
  number        number (or numeric string)
  rating        integer 1-5
  checkbox      true / false
  date          "YYYY-MM-DD" (all day) or "YYYY-MM-DDTHH:mm" (local time)
  select        choice name as string — unknown names are created automatically
  multiSelect   array of choice names — unknown names are created automatically
  relation      array of linked records, each a record id (unique prefixes work) or the
                text of that record's first field; a single value is accepted for one link.
                Read back as the linked records' names.
  image         path to a local image file (copied into the app's storage),
                or an existing app-image:/// URL
  audio         path to a local audio file (copied into the app's storage),
                or an existing app-audio:/// URL
  video         path to a local video file (copied into the app's storage), or an
                existing app-video:/// URL. Read back as {url,name,poster}. The cover
                frame is captured a quarter of the way in by the app, which owns the
                only decoder — a video added here shows a placeholder until the app's
                Capture cover button fills it in. Pass the {url,name,poster} object
                back to move an existing video between records without losing it.
  createdTime, lastModifiedTime
                read-only — the app keeps them from the record itself, and writing to
                one is an error. Read back as an ISO instant. --date-format picks how
                the app displays it: slash (2026/01/30), slashTime, slashTimeZone,
                dash (2026-01-30), dashTime, dashTimeZone.
  attachment    array of local file paths (each copied into the app's storage) —
                a single path is accepted for one file. Also takes a {url,name}
                object exactly as read back, which is how you move an existing
                attachment between records. A bare app-attachment:/// URL works
                too, but the app only stores files under generated ids, so the
                original file name can't be recovered from one: pass the
                {url,name} object to keep the name and size.
  null          clears the field (any type)

EXAMPLES
  crow list-projects
  crow schema "My Tasks"
  crow add-record "My Tasks" '{"Name":"Buy milk","Status":"Todo","Due":"2026-08-10"}'
  crow list-records "My Tasks" --where '{"Status":"Todo"}' --limit 20
  crow update-record "My Tasks" 3f2a '{"Status":"Done"}'
  crow create-table "My Tasks" People --fields '[{"name":"Name","type":"text"}]'
  crow add-record "My Tasks" '{"Name":"Ada"}' --table People
  crow add-field "My Tasks" Owner relation --link-table People --single
  crow add-field "My Tasks" Added createdTime --date-format slashTime
  crow add-record "My Tasks" '{"Name":"Ship 1.0","Owner":"Ada"}'
`

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const commands = {
  async 'list-projects'() {
    const projects = await readAllProjects()
    projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    output({
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        tables: p.tables.map((t) => t.name),
        recordCount: recordCount(p),
        updatedAt: p.updatedAt
      }))
    })
  },

  async info() {
    const projects = await readAllProjects()
    output({
      dataDir: dataDir(),
      projectCount: projects.length,
      tableCount: projects.reduce((total, p) => total + p.tables.length, 0)
    })
  },

  async 'create-project'({ positional, flags }) {
    const name = positional[0]
    if (!name) fail('Usage: create-project <name> [--fields JSON] [--table NAME]')
    const tableName = typeof flags.table === 'string' ? flags.table : 'Table'
    const table = buildTable(tableName, [])
    const project = {
      id: uuid(),
      name,
      createdAt: now(),
      updatedAt: now(),
      tables: [table]
    }
    table.fields = fieldsFromFlag(flags.fields, project, table)
    syncTableRelations(project, table)
    await saveProject(project)
    output(schemaOf(project))
  },

  async 'delete-project'({ positional, flags }) {
    const project = await resolveProject(positional[0] ?? fail('Usage: delete-project <project> --yes'))
    if (flags.yes !== true) {
      fail(`Refusing to delete "${project.name}" (${project.tables.length} tables, ${recordCount(project)} records). Re-run with --yes to confirm.`)
    }
    await fs.rm(projectDir(project.id), { recursive: true, force: true })
    output({ deleted: { id: project.id, name: project.name } })
  },

  async schema({ positional, flags }) {
    const project = await resolveProject(positional[0] ?? fail('Usage: schema <project> [--table NAME]'))
    output(schemaOf(project, flags.table === undefined ? undefined : resolveTable(project, flags.table)))
  },

  async 'list-tables'({ positional }) {
    const project = await resolveProject(positional[0] ?? fail('Usage: list-tables <project>'))
    output({
      project: project.name,
      tables: project.tables.map((t) => ({
        id: t.id,
        name: t.name,
        recordCount: t.records.length,
        fieldCount: t.fields.length
      }))
    })
  },

  async 'create-table'({ positional, flags }) {
    const [ref, name] = positional
    if (!ref || !name) fail('Usage: create-table <project> <name> [--fields JSON]')
    const schema = await mutateProject(ref, (project) => {
      if (project.tables.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
        fail(`Project "${project.name}" already has a table named "${name}"`)
      }
      const table = buildTable(name, [])
      table.fields = fieldsFromFlag(flags.fields, project, table)
      project.tables.push(table)
      syncTableRelations(project, table)
      return schemaOf(project, table)
    })
    output(schema)
  },

  async 'rename-table'({ positional, flags }) {
    const [ref, name] = positional
    if (!ref || typeof flags.to !== 'string') fail('Usage: rename-table <project> <table> --to <new-name>')
    const schema = await mutateProject(ref, (project) => {
      const table = resolveTable(project, name ?? flags.table)
      table.name = flags.to
      return schemaOf(project, table)
    })
    output(schema)
  },

  async 'delete-table'({ positional, flags }) {
    const [ref, name] = positional
    if (!ref || !name) fail('Usage: delete-table <project> <table> --yes')
    const deleted = await mutateProject(ref, (project) => {
      const table = resolveTable(project, name)
      // Matches the app: a project always keeps at least one table.
      if (project.tables.length <= 1) fail(`"${table.name}" is the only table in "${project.name}"; delete the project instead.`)
      if (flags.yes !== true) fail(`Refusing to delete table "${table.name}" (${table.records.length} records). Re-run with --yes to confirm.`)
      project.tables = project.tables.filter((t) => t.id !== table.id)
      // Matches the app: a link into a table that's gone has nothing left to
      // show, so the field goes with it.
      for (const other of project.tables) {
        for (const field of other.fields.filter((f) => f.relation?.tableId === table.id)) {
          deleteFieldEverywhere(other, field.id)
        }
      }
      return { id: table.id, name: table.name, recordCount: table.records.length }
    })
    output({ deleted })
  },

  async 'add-field'({ positional, flags }) {
    const [ref, name, type] = positional
    if (!ref || !name || !type) fail('Usage: add-field <project> <name> <type> [--choices "A,B,C"] [--link-table NAME] [--single] [--date-format NAME]')
    const choices = typeof flags.choices === 'string' ? flags.choices.split(',').map((c) => c.trim()).filter(Boolean) : []
    const schema = await mutateProject(ref, (project) => {
      const table = resolveTable(project, flags.table)
      assertFieldNameFree(table, name)
      const relation =
        type === 'relation'
          ? {
              tableId: linkTargetFor(project, flags['link-table'], name).id,
              multiple: flags.single !== true,
              inverseFieldId: uuid()
            }
          : undefined
      const field = buildField(name, type, choices, relation, flags['date-format'])
      table.fields.push(field)
      if (field.type === 'relation') syncRelationField(project, table, field)
      return schemaOf(project, table)
    })
    output(schema)
  },

  async 'delete-field'({ positional, flags }) {
    const [ref, name] = positional
    if (!ref || !name) fail('Usage: delete-field <project> <name> [--table NAME]')
    const schema = await mutateProject(ref, (project) => {
      const table = resolveTable(project, flags.table)
      deleteRelationField(project, table, resolveField(table, name))
      return schemaOf(project, table)
    })
    output(schema)
  },

  async 'list-records'({ positional, flags }) {
    const project = await resolveProject(positional[0] ?? fail('Usage: list-records <project> [--table NAME] [--where JSON] [--limit N] [--offset N]'))
    const table = resolveTable(project, flags.table)
    let records = table.records.map((r) => humanize(table, r, project))
    if (typeof flags.where === 'string') {
      const where = parseJsonArg(flags.where, '--where')
      for (const name of Object.keys(where)) resolveField(table, name)
      records = records.filter((r) => matchesWhere(r, where))
    }
    const total = records.length
    const offset = flags.offset ? Number(flags.offset) : 0
    const limit = flags.limit ? Number(flags.limit) : Infinity
    records = records.slice(offset, offset + limit)
    output({ project: project.name, table: table.name, total, records })
  },

  async 'get-record'({ positional, flags }) {
    const [ref, recordRef] = positional
    if (!ref || !recordRef) fail('Usage: get-record <project> <record-id> [--table NAME]')
    const project = await resolveProject(ref)
    const table = resolveTable(project, flags.table)
    output(humanize(table, resolveRecord(table, recordRef), project))
  },

  async 'add-record'({ positional, flags }) {
    const [ref, valuesRaw] = positional
    if (!ref || !valuesRaw) fail('Usage: add-record <project> <values-json> [--table NAME]')
    const input = parseJsonArg(valuesRaw, 'Values')
    const inputs = Array.isArray(input) ? input : [input]
    const project = await resolveProject(ref)
    const table = resolveTable(project, flags.table)
    const before = structuredClone(table)
    const created = []
    const changedRelations = new Set()
    for (const values of inputs) {
      const record = { id: uuid(), createdAt: now(), values: {} }
      const changed = await applyValues(table, record, values, project)
      changed.forEach((fieldId) => changedRelations.add(fieldId))
      table.records.push(record)
      created.push(record)
    }
    syncTableRelations(project, table, before, changedRelations)
    project.updatedAt = now()
    await saveProject(project)
    output({ table: table.name, created: created.map((r) => humanize(table, r, project)) })
  },

  async 'update-record'({ positional, flags }) {
    const [ref, recordRef, valuesRaw] = positional
    if (!ref || !recordRef || !valuesRaw) fail('Usage: update-record <project> <record-id> <values-json> [--table NAME]')
    const input = parseJsonArg(valuesRaw, 'Values')
    const project = await resolveProject(ref)
    const table = resolveTable(project, flags.table)
    const record = resolveRecord(table, recordRef)
    const before = structuredClone(table)
    const changedRelations = await applyValues(table, record, input, project)
    // What a lastModifiedTime field reads. Stamped even when the values worked
    // out identical: the app does the same for an edit it can't prove was a
    // no-op, and an agent asking for a write means it.
    record.updatedAt = now()
    syncTableRelations(project, table, before, changedRelations)
    project.updatedAt = now()
    await saveProject(project)
    output(humanize(table, record, project))
  },

  async 'delete-record'({ positional, flags }) {
    const [ref, recordRef] = positional
    if (!ref || !recordRef) fail('Usage: delete-record <project> <record-id> [--table NAME]')
    const project = await resolveProject(ref)
    const table = resolveTable(project, flags.table)
    const record = resolveRecord(table, recordRef)
    const before = structuredClone(table)
    table.records = table.records.filter((r) => r.id !== record.id)
    syncTableRelations(project, table, before)
    project.updatedAt = now()
    await saveProject(project)
    output({ deleted: humanize(table, record, project) })
  },

  async help() {
    process.stdout.write(HELP)
  }
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2))
  if (typeof flags['data-dir'] === 'string') process.env.CROW_DIR = flags['data-dir']
  const name = positional.shift()
  if (!name || name === 'help' || flags.help === true) {
    process.stdout.write(HELP)
    return
  }
  const command = commands[name]
  if (!command) fail(`Unknown command "${name}". Run \`crow help\` for the command list.`)
  await command({ positional, flags })
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
