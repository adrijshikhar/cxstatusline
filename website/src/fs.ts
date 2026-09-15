// The demo has no host filesystem. Never report a successful native read/write.
const unavailable = (): never => { throw new Error("Host filesystem access is unavailable in the browser demo."); };
export const existsSync = unavailable;
export const readFileSync = unavailable;
export const writeFileSync = unavailable;
export const mkdirSync = unavailable;
export const unlinkSync = unavailable;
export const renameSync = unavailable;
export const lstatSync = unavailable;
export const readdirSync = unavailable;
export const statSync = unavailable;
export default { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, renameSync, lstatSync, readdirSync, statSync };
