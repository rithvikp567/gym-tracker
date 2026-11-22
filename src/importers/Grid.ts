export type CellValue = string | number | boolean | Date | null;

/** A spreadsheet tab as a 0-based grid of raw cell values, independent of the file library. */
export class Grid {
  readonly rowCount: number;
  readonly colCount: number;

  constructor(private readonly rows: readonly (readonly CellValue[])[]) {
    this.rowCount = rows.length;
    this.colCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
  }

  cell(row: number, col: number): CellValue {
    return this.rows[row]?.[col] ?? null;
  }

  /** Trimmed text of a cell ("" for empty, dates, and non-strings other than numbers). */
  text(row: number, col: number): string {
    const v = this.cell(row, col);
    if (typeof v === "string") return v.trim();
    if (typeof v === "number") return String(v);
    return "";
  }

  isEmpty(row: number, col: number): boolean {
    const v = this.cell(row, col);
    return v === null || (typeof v === "string" && v.trim() === "");
  }

  *cells(): Generator<{ row: number; col: number; value: CellValue }> {
    for (let row = 0; row < this.rowCount; row++) {
      const r = this.rows[row]!;
      for (let col = 0; col < r.length; col++) {
        const value = r[col] ?? null;
        if (value !== null) yield { row, col, value };
      }
    }
  }
}

/** "A1" style reference for warnings. */
export function cellRef(row: number, col: number): string {
  let n = col + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return `${letters}${row + 1}`;
}
