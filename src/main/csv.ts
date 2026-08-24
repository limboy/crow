import { dialog, type BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { basename, extname } from 'path'
import type { CsvFile } from '@shared/types'
import { toFileName } from './transfer'

/**
 * The file half of CSV import/export: pick a path, read or write UTF-8 text.
 * Everything about what the text *means* — the delimited grammar, field types,
 * how a value reads as text — stays in the renderer (lib/csv.ts, lib/cellText.ts),
 * which is also where the clipboard needs it.
 */

/** Excel reads a UTF-8 CSV as the local codepage unless it finds a BOM, which
 *  mangles every non-ASCII name in the file. */
const BOM = '\uFEFF'

const CSV_FILTERS = [
  { name: 'CSV', extensions: ['csv'] },
  { name: 'Tab-separated', extensions: ['tsv', 'tab'] },
  { name: 'Text', extensions: ['txt'] }
]

export async function exportCsv(
  win: BrowserWindow | null,
  suggestedName: string,
  content: string
): Promise<string | null> {
  const options = {
    title: 'Export CSV',
    defaultPath: `${toFileName(suggestedName)}.csv`,
    filters: [CSV_FILTERS[0]]
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  await fs.writeFile(result.filePath, BOM + content, 'utf-8')
  return result.filePath
}

export async function importCsv(win: BrowserWindow | null): Promise<CsvFile | null> {
  const options = {
    title: 'Import CSV',
    properties: ['openFile' as const],
    filters: CSV_FILTERS
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  const source = result.filePaths[0]
  if (result.canceled || !source) return null

  try {
    const text = await fs.readFile(source, 'utf-8')
    // The renderer's importer needs a header row to name the columns, and it
    // has no way to report back that there wasn't one.
    if (text.trim() === '') throw new Error('That file is empty.')
    return { name: basename(source, extname(source)), text }
  } catch (err) {
    // Reported here rather than thrown across IPC, so the renderer only has to
    // handle the same "nothing was imported" case as a cancelled dialog.
    const box = {
      type: 'error' as const,
      title: 'Import failed',
      message: "Couldn't read that file.",
      detail: err instanceof Error ? err.message : String(err)
    }
    if (win) await dialog.showMessageBox(win, box)
    else await dialog.showMessageBox(box)
    return null
  }
}
