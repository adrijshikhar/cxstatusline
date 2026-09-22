// @ts-expect-error path-browserify has no type declarations
import pathBrowserify from "path-browserify";

export const resolve = pathBrowserify.resolve;
export const normalize = pathBrowserify.normalize;
export const isAbsolute = pathBrowserify.isAbsolute;
export const join = pathBrowserify.join;
export const relative = pathBrowserify.relative;
export const dirname = pathBrowserify.dirname;
export const basename = pathBrowserify.basename;
export const extname = pathBrowserify.extname;
export const sep = pathBrowserify.sep;
export const delimiter = pathBrowserify.delimiter;
export const parse = pathBrowserify.parse;
export const format = pathBrowserify.format;
export const posix = pathBrowserify.posix;
export const win32 = pathBrowserify.win32;

export default pathBrowserify;
