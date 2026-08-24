/**
 * Delimited-text codec, shared by CSV import/export and grid copy/paste.
 *
 * Spreadsheets speak two dialects of the same thing: files are comma-separated
 * (RFC 4180), while the clipboard is tab-separated. Only the delimiter differs,
 * so both directions go through one parser and one serializer.
 */

/** Strips the BOM Excel writes (and expects) at the head of a UTF-8 CSV. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * Parses delimited text into a grid of raw strings, handling quoted fields —
 * including delimiters, `""` escapes and newlines inside them. Rows may be
 * ragged; callers pad against the header themselves.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const source = stripBom(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0

  const endField = (): void => {
    row.push(field)
    field = ''
  }
  const endRow = (): void => {
    endField()
    rows.push(row)
    row = []
  }

  while (i < source.length) {
    const char = source[i]

    if (quoted) {
      if (char === '"') {
        // A doubled quote is an escaped quote; a lone one closes the field.
        if (source[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      field += char
      i++
      continue
    }

    if (char === '"' && field === '') {
      quoted = true
      i++
      continue
    }
    if (char === delimiter) {
      endField()
      i++
      continue
    }
    if (char === '\r' || char === '\n') {
      endRow()
      // CRLF is one line break, not two.
      i += char === '\r' && source[i + 1] === '\n' ? 2 : 1
      continue
    }
    field += char
    i++
  }

  // Whatever is still buffered is a final row, unless the text ended on a
  // line break and left nothing behind.
  if (field !== '' || quoted || row.length > 0) endRow()
  return rows
}

/** Quotes a field only when it would otherwise change the parse. */
function encodeField(value: string, delimiter: string): string {
  const needsQuotes =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  return needsQuotes ? `"${value.replaceAll('"', '""')}"` : value
}

export function serializeDelimited(rows: string[][], delimiter: string): string {
  return rows.map((row) => row.map((f) => encodeField(f, delimiter)).join(delimiter)).join('\r\n')
}

/**
 * Guesses which delimiter a file uses — a `.csv` exported in much of Europe is
 * semicolon-separated, and a `.tsv` is tabbed. Counts candidates on the first
 * line and takes the most frequent, falling back to a comma for single-column
 * files. The clipboard doesn't need this: it's always tabs (see
 * `useGridClipboard`).
 */
export function detectDelimiter(text: string): string {
  const firstLine = stripBom(text).split(/\r\n|\r|\n/, 1)[0] ?? ''
  // Quoted sections can hold any character, so they can't cast a vote.
  const unquoted = firstLine.replace(/"(?:[^"]|"")*"/g, '')
  const counts = [
    ['\t', unquoted.split('\t').length - 1],
    [',', unquoted.split(',').length - 1],
    [';', unquoted.split(';').length - 1]
  ] as const
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a))
  return best[1] > 0 ? best[0] : ','
}

/** True when the text holds nothing a paste could put in a cell. */
export function isBlankGrid(grid: string[][]): boolean {
  return grid.every((row) => row.every((cell) => cell.trim() === ''))
}
