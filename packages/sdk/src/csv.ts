// Spreadsheet apps evaluate cells starting with these characters as formulas.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Escapes one CSV cell (RFC 4180 quoting) and neutralizes spreadsheet formula injection: a cell that
 * starts with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'` unless it is a plain number such as `-5`.
 * Shared by the dashboard's CSV download and the CLI's bulk export so both produce identical cells.
 */
export function escapeCsvCell(raw: string): string {
  let value = raw;
  if (FORMULA_PREFIX.test(value) && Number.isNaN(Number(value))) {
    value = `'${value}`;
  }
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Serializes rows to CSV lines joined by CRLF, with no trailing line break. */
export function toCsvRows(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}

export function toCsv(headers: string[], rows: string[][]): string {
  return toCsvRows([headers, ...rows]);
}
