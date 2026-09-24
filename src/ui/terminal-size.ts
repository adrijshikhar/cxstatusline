import { useStdout } from "ink";
import { useEffect, useState } from "react";

export const MIN_MENU_COLUMNS = 40;
export const MIN_MENU_ROWS = 20;

export function isUsableMenuSize(columns: number, rows: number): boolean {
  return columns >= MIN_MENU_COLUMNS && rows >= MIN_MENU_ROWS;
}

export function menuItemsForRows(rows: number): number {
  return Math.max(1, Math.min(8, rows - 13));
}

export function useTerminalSize() {
  const { stdout } = useStdout();
  const [size, setSize] = useState({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
  useEffect(() => {
    const update = () => setSize({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
    stdout.on("resize", update);
    return () => { stdout.off("resize", update); };
  }, [stdout]);
  return { ...size, usable: isUsableMenuSize(size.columns, size.rows), maxVisibleItems: menuItemsForRows(size.rows) };
}
