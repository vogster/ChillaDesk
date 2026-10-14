/**
 * CSV as spreadsheets write it (RFC 4180): quoted fields may hold the separator, quotes
 * (doubled) and line breaks. The separator is whichever of `,` `;` and tab the header row
 * uses most, because spreadsheets in many languages save with `;`.
 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '')
  const separator = guessSeparator(source)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
      continue
    }
    if (char === '"' && field === '') {
      quoted = true
    } else if (char === separator) {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // Blank lines carry nothing.
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''))
}

function guessSeparator(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const outsideQuotes = firstLine.replace(/"[^"]*"/g, '')
  const counts = [',', ';', '\t'].map((separator) => ({
    separator,
    count: outsideQuotes.split(separator).length - 1,
  }))
  return counts.reduce((best, next) => (next.count > best.count ? next : best)).separator
}

/**
 * A cell a spreadsheet would run as a formula (`=`, `+`, `-`, `@` and the like at the
 * start) gets an apostrophe in front, so an exported title cannot attack whoever opens it.
 */
function safeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

/** Writes rows as CSV with a byte-order mark, so spreadsheets read the UTF-8 right. */
export function toCsv(rows: string[][]): string {
  const lines = rows.map((cells) =>
    cells
      .map((cell) => {
        const value = safeCell(cell)
        return /[",;\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
      })
      .join(','),
  )
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
