export const spawnSync = (): never => { throw new Error("Custom commands are unavailable in the browser."); };
export const execFileSync = (): never => { throw new Error("Custom commands are unavailable in the browser."); };
export const spawn = (): never => { throw new Error("Custom commands are unavailable in the browser."); };
export const execSync = (): never => { throw new Error("Custom commands are unavailable in the browser."); };
export const createHash = (): never => { throw new Error("Custom commands are unavailable in the browser."); };
export const randomBytes = (size: number): Uint8Array => crypto.getRandomValues(new Uint8Array(size));
export const homedir = (): string => "/";
export const platform = (): string => "browser";
export default { homedir, platform, randomBytes };
