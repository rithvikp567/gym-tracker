import { Grid } from "./Grid";
import { MonthGridImporter } from "./MonthGridImporter";
import type { SheetImporter } from "./SheetImporter";

export interface WorkbookTab {
  name: string;
  grid: Grid;
  /** The first importer that understands this tab, if any. */
  importer: SheetImporter | null;
}

/** Registered layouts, tried in order. Add new SheetImporter classes here. */
export const IMPORTERS: readonly SheetImporter[] = [new MonthGridImporter()];

/** Reads every tab of an .xlsx file (Google Sheets → File → Download → Microsoft Excel). */
export async function readWorkbook(file: File): Promise<WorkbookTab[]> {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  return sheets.map(({ sheet, data }) => {
    const grid = new Grid(data);
    return { name: sheet, grid, importer: IMPORTERS.find((i) => i.canRead(grid)) ?? null };
  });
}
