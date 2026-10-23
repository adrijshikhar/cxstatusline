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
  const tty = stdout as NodeJS.WriteStream;
  const [size, setSize] = useState({ columns: tty.columns || 80, rows: tty.rows || 24 });
  useEffect(() => {
    const update = () => setSize({ columns: tty.columns || 80, rows: tty.rows || 24 });
    tty.on?.("resize", update);
    return () => { tty.off?.("resize", update); };
  }, [stdout]);
  return { ...size, usable: isUsableMenuSize(size.columns, size.rows), maxVisibleItems: menuItemsForRows(size.rows) };
}
