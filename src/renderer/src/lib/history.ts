import type { Project } from '@shared/types'

/**
 * Undo/redo history, kept per project as whole-document snapshots.
 *
 * Every edit already goes through useUpdateProject, which replaces the cached
 * Project with a new one built by the pure transforms in ops.ts — so the
 * cheapest correct history is just the chain of those documents. Snapshots
 * share structure with each other (ops only copy the parts they change), so
 * keeping a stack of them costs far less than the JSON size suggests.
 *
 * History lives in module state rather than the query cache: it's per-session
 * scratch, never persisted, and shouldn't be part of what gets saved to disk.
 */

/** Snapshots kept per project. Older ones are dropped from the bottom. */
const LIMIT = 100

/** Consecutive edits sharing a coalesce key merge into one undo step if
 *  they land within this window — one per keystroke would otherwise make
 *  undo walk back through a typed word letter by letter. */
const COALESCE_MS = 700

interface Entry {
  project: Project
  /** Identifies what was being edited, for coalescing. See COALESCE_MS. */
  key?: string
  at: number
}

interface Stack {
  past: Entry[]
  future: Entry[]
}

const stacks = new Map<string, Stack>()
const listeners = new Set<() => void>()

function stackFor(id: string): Stack {
  let stack = stacks.get(id)
  if (!stack) {
    stack = { past: [], future: [] }
    stacks.set(id, stack)
  }
  return stack
}

function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * Records the state a project was in *before* an edit, so undo can go back to
 * it. Doing anything new drops the redo stack, as in every other editor.
 */
export function recordChange(id: string, previous: Project, coalesceKey?: string): void {
  const stack = stackFor(id)
  const top = stack.past[stack.past.length - 1]
  const now = Date.now()
  const merges =
    coalesceKey !== undefined &&
    top !== undefined &&
    top.key === coalesceKey &&
    now - top.at < COALESCE_MS

  if (merges) {
    // The existing entry already holds the pre-edit state of this run of
    // edits; only its freshness needs extending.
    top.at = now
  } else {
    stack.past.push({ project: previous, key: coalesceKey, at: now })
    if (stack.past.length > LIMIT) stack.past.shift()
  }
  if (stack.future.length > 0) stack.future = []
  notify()
}

/** Moves `current` onto the redo stack and returns the state to restore, or
 *  undefined when there's nothing left to undo. */
export function undoSnapshot(id: string, current: Project): Project | undefined {
  const stack = stackFor(id)
  const entry = stack.past.pop()
  if (!entry) return undefined
  stack.future.push({ project: current, at: Date.now() })
  notify()
  return entry.project
}

/** The mirror of undoSnapshot: `current` goes back onto the undo stack. */
export function redoSnapshot(id: string, current: Project): Project | undefined {
  const stack = stackFor(id)
  const entry = stack.future.pop()
  if (!entry) return undefined
  stack.past.push({ project: current, at: Date.now() })
  notify()
  return entry.project
}

/**
 * Drops history for one project, or all of them. Called whenever the app's
 * copy of a project stops being the one the history was built from — an
 * external write picked up by the watcher, or a deleted project — since
 * undoing to a snapshot from before that would silently discard the change
 * that came from outside.
 */
export function clearHistory(id?: string): void {
  if (id === undefined) {
    if (stacks.size === 0) return
    stacks.clear()
  } else if (!stacks.delete(id)) {
    return
  }
  notify()
}

export function subscribeToHistory(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** A primitive summary of a project's stacks, so useSyncExternalStore can
 *  compare it by value instead of re-rendering on every notify. */
export function historySnapshot(id: string): string {
  const stack = stacks.get(id)
  return stack ? `${stack.past.length}:${stack.future.length}` : '0:0'
}
