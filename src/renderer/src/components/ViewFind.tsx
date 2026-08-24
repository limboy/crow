import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import type { Field, RecordRow, Table } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText
} from '@/components/ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { displayValue } from '@/lib/fields'
import { isMac } from '@/lib/format'
import { cn } from '@/lib/utils'

interface FindCellMatch {
  key: string
  recordId: string
  fieldId: string
}

export interface ViewFindController {
  open: boolean
  query: string
  matches: FindCellMatch[]
  currentIndex: number
  matchIndexByKey: ReadonlyMap<string, number>
  openFind: () => void
  closeFind: () => void
  setQuery: (query: string) => void
  previous: () => void
  next: () => void
}

export function findCellKey(recordId: string, fieldId: string): string {
  return `${recordId}\u0000${fieldId}`
}

/** One match per visible cell, in the same record/field order as the view. */
function matchingCells(
  records: RecordRow[],
  fields: Field[],
  query: string,
  tables: Table[]
): FindCellMatch[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []

  const matches: FindCellMatch[] = []
  for (const record of records) {
    for (const field of fields) {
      const text = displayValue(field, record.values[field.id], tables).toLocaleLowerCase()
      if (text.includes(needle)) {
        matches.push({
          key: findCellKey(record.id, field.id),
          recordId: record.id,
          fieldId: field.id
        })
      }
    }
  }
  return matches
}

export function useViewFind(
  records: RecordRow[],
  fields: Field[],
  tables: Table[]
): ViewFindController {
  const [open, setOpen] = useState(false)
  const [query, setQueryValue] = useState('')
  const [cursor, setCursor] = useState(0)
  const matches = useMemo(
    () => matchingCells(records, fields, query, tables),
    [records, fields, query, tables]
  )
  const currentIndex = matches.length === 0 ? -1 : Math.min(cursor, matches.length - 1)
  const matchIndexByKey = useMemo(
    () => new Map(matches.map((match, index) => [match.key, index])),
    [matches]
  )

  const focusInput = useCallback((): void => {
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('[data-view-find-input="true"]')
      input?.focus()
      input?.select()
    })
  }, [])

  const openFind = useCallback((): void => {
    setOpen(true)
    focusInput()
  }, [focusInput])

  const closeFind = useCallback((): void => {
    setOpen(false)
    setQueryValue('')
    setCursor(0)
  }, [])

  const setQuery = useCallback((next: string): void => {
    setQueryValue(next)
    setCursor(0)
  }, [])

  const previous = useCallback((): void => {
    if (matches.length === 0) return
    setCursor((index) => (index <= 0 ? matches.length - 1 : index - 1))
  }, [matches.length])

  const next = useCallback((): void => {
    if (matches.length === 0) return
    setCursor((index) => (index + 1) % matches.length)
  }, [matches.length])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.isComposing ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== 'f'
      ) {
        return
      }
      event.preventDefault()
      openFind()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [openFind])

  useEffect(() => {
    if (currentIndex < 0) return
    const frame = requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('[data-find-active="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [currentIndex, matches])

  return {
    open,
    query,
    matches,
    currentIndex,
    matchIndexByKey,
    openFind,
    closeFind,
    setQuery,
    previous,
    next
  }
}

export function getFindCellState(
  find: ViewFindController,
  recordId: string,
  fieldId: string
): { matched: boolean; active: boolean } {
  const index = find.matchIndexByKey.get(findCellKey(recordId, fieldId))
  return { matched: index !== undefined, active: index === find.currentIndex }
}

export function ViewFindControl({
  find,
  className
}: {
  find: ViewFindController
  className?: string
}): React.JSX.Element {
  const keys = isMac ? '⌘F' : 'Ctrl+F'
  const hasMatches = find.matches.length > 0
  const count = hasMatches ? `${find.currentIndex + 1} of ${find.matches.length}` : '0 of 0'

  return (
    <Popover
      open={find.open}
      onOpenChange={(open) => {
        if (open) find.openFind()
        else find.closeFind()
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(
              'shrink-0 focus-visible:border-transparent focus-visible:ring-0',
              className
            )}
            title={`Find in view (${keys})`}
            aria-label="Find in view"
          >
            <Search />
          </Button>
        }
      />
      <PopoverContent align="end" side="bottom" sideOffset={8} className="w-80 p-1">
        <InputGroup className="h-8 w-full has-[[data-slot=input-group-control]:focus-visible]:border-input has-[[data-slot=input-group-control]:focus-visible]:ring-0">
          <InputGroupInput
            autoFocus
            data-view-find-input="true"
            aria-label="Find in view"
            placeholder="Find in view"
            value={find.query}
            onChange={(event) => find.setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                find.closeFind()
              } else if (event.key === 'Enter') {
                event.preventDefault()
                if (event.shiftKey) find.previous()
                else find.next()
              }
            }}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText className="min-w-12 justify-end tabular-nums">{count}</InputGroupText>
            <InputGroupButton
              size="icon-xs"
              aria-label="Previous match"
              disabled={!hasMatches}
              onClick={find.previous}
            >
              <ChevronUp />
            </InputGroupButton>
            <InputGroupButton
              size="icon-xs"
              aria-label="Next match"
              disabled={!hasMatches}
              onClick={find.next}
            >
              <ChevronDown />
            </InputGroupButton>
            <InputGroupButton size="icon-xs" aria-label="Close find" onClick={find.closeFind}>
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </PopoverContent>
    </Popover>
  )
}
