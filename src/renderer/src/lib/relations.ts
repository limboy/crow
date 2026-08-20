import { createContext, useContext } from 'react'
import type { Field, Table } from '@shared/types'
import { relationTable } from './fields'

/**
 * The open project's tables, so a relation cell can resolve the records it
 * links to. Everything else in a view works off a single Table — this is the
 * one thing that has to see sideways, and it reaches cells, editors and the
 * field dialog through several layers of props that otherwise don't care
 * about the project at all.
 */
export const ProjectTablesContext = createContext<Table[]>([])

export function useProjectTables(): Table[] {
  return useContext(ProjectTablesContext)
}

/** The table a relation field points at, or undefined if it's been deleted. */
export function useRelationTable(field: Field): Table | undefined {
  return relationTable(field, useProjectTables())
}
