import { render, Text } from "ink";
import { createElement, type ReactElement } from "react";
import { isUsableMenuSize, MIN_MENU_COLUMNS, MIN_MENU_ROWS } from "./terminal-size";

/** Share terminal ownership and cleanup between command prompts. */
export async function prompt<T>(element: (select: (value: T) => void) => ReactElement, cancelled: T): Promise<T> {
  if (!isUsableMenuSize(process.stdout.columns ?? 0, process.stdout.rows ?? 0)) {
    throw new Error(`Terminal must be at least ${MIN_MENU_COLUMNS} columns × ${MIN_MENU_ROWS} rows for an interactive menu. Resize it or rerun with explicit options.`);
  }
  let resolveSelection!: (value: T) => void;
  const selection = new Promise<T>((resolve) => { resolveSelection = resolve; });
  const instance = render(element(resolveSelection), { exitOnCtrlC: false, preserveScrollback: true, isCI: false });
  try {
    return await Promise.race([selection, instance.waitUntilExit().then(() => cancelled)]);
  } finally {
    instance.rerender(createElement(Text, {}, ""));
    instance.clear();
    instance.unmount();
    instance.cleanup();
  }
}
