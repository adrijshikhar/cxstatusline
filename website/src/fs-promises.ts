export async function readFile(): Promise<string> { throw new Error("Filesystem access is unavailable in the browser."); }
export async function writeFile(): Promise<void> { throw new Error("Filesystem access is unavailable in the browser."); }
export async function lstat(): Promise<never> { throw new Error("Filesystem access is unavailable in the browser."); }
export async function mkdir(): Promise<never> { throw new Error("Filesystem access is unavailable in the browser."); }
export async function readlink(): Promise<never> { throw new Error("Filesystem access is unavailable in the browser."); }
export async function realpath(): Promise<never> { throw new Error("Filesystem access is unavailable in the browser."); }
export async function rename(): Promise<never> { throw new Error("Filesystem access is unavailable in the browser."); }
export async function unlink(): Promise<never> { throw new Error("Filesystem access is unavailable in the browser."); }
