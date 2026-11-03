import { describe, expect, it } from "bun:test";
import { buildFileUrl, buildIdeFileUrl } from "../../src/utils/hyperlink";

describe("buildIdeFileUrl", () => {
    it("builds IDE links for POSIX paths", () => {
        expect(buildIdeFileUrl("/home/user/code", "vscode")).toBe("vscode://file/home/user/code");
        expect(buildIdeFileUrl("/home/user/code", "cursor")).toBe("cursor://file/home/user/code");
    });

    it("builds IDE links for UNC paths", () => {
        expect(buildIdeFileUrl("\\\\server\\share\\my repo", "cursor")).toBe("cursor://file//server/share/my%20repo");
    });

    it.each(["vscode", "cursor"] as const)("preserves POSIX backslashes and normalizes Windows separators for %s", (mode) => {
        expect(buildIdeFileUrl("/tmp/a\\b\\c", mode)).toBe(`${mode}://file/tmp/a%5Cb%5Cc`);
        expect(buildIdeFileUrl("C:\\Work\\my repo", mode)).toBe(`${mode}://file/C:/Work/my%20repo`);
        expect(buildIdeFileUrl("\\\\server\\share\\my repo", mode)).toBe(`${mode}://file//server/share/my%20repo`);
    });

    it.each([
        { label: "spaces", path: "/Users/example/my project", expected: "cursor://file/Users/example/my%20project" },
        { label: "non-ASCII", path: "/Users/example/中文项目", expected: "cursor://file/Users/example/%E4%B8%AD%E6%96%87%E9%A1%B9%E7%9B%AE" },
        { label: "#", path: "/Users/example/my#project", expected: "cursor://file/Users/example/my%23project" },
        { label: "?", path: "/Users/example/my?project", expected: "cursor://file/Users/example/my%3Fproject" },
        { label: "%", path: "/Users/example/my%project", expected: "cursor://file/Users/example/my%25project" }
    ])("encodes $label in IDE link path segments", ({ path, expected }) => {
        expect(buildIdeFileUrl(path, "cursor")).toBe(expected);
    });
});

describe("buildFileUrl", () => {
    it.each([
        {
            label: "a POSIX path",
            path: "/Users/example/my-project",
            expected: "file:///Users/example/my-project"
        },
        {
            label: "spaces, non-ASCII, #, ?, and %",
            path: "/Users/example/中文 project #1?%",
            expected: "file:///Users/example/%E4%B8%AD%E6%96%87%20project%20%231%3F%25"
        },
        {
            label: "a Windows drive path",
            path: "C:\\Work\\my project#1",
            expected: "file:///C:/Work/my%20project%231"
        },
        {
            label: "a Windows drive path with forward slashes",
            path: "D:/工作/项目?x%25",
            expected: "file:///D:/%E5%B7%A5%E4%BD%9C/%E9%A1%B9%E7%9B%AE%3Fx%2525"
        },
        {
            label: "a UNC network path",
            path: "\\\\server\\share\\my project#1",
            expected: "file://server/share/my%20project%231"
        },
        {
            label: "a POSIX root path",
            path: "/",
            expected: "file:///"
        },
        {
            label: "a POSIX filename with literal backslashes",
            path: "/tmp/a\\b\\c",
            expected: "file:///tmp/a%5Cb%5Cc"
        }
    ])("builds a valid file URL for $label", ({ path, expected }) => {
        expect(buildFileUrl(path)).toBe(expected);
    });

    it.each(["", "relative/project", ".", "..", "C:", "C:project"])(
        "does not invent a file URL for an inapplicable path %j",
        (path) => {
            expect(buildFileUrl(path)).toBeNull();
        }
    );

    it.each([
        { label: "a # fragment", path: "\\\\server#fragment\\share" },
        { label: "a ? query", path: "\\\\server?query\\share" },
        { label: "a % escape", path: "\\\\server%2fevil\\share" },
        { label: "userinfo", path: "\\\\user@server\\share" },
        { label: "a port", path: "\\\\server:445\\share" },
        { label: "a space", path: "\\\\ser ver\\share" },
        { label: "a control character", path: "\\\\ser\x1bver\\share" }
    ])("fails closed for a UNC host containing $label", ({ path }) => {
        expect(buildFileUrl(path)).toBeNull();
    });

    it("encodes control characters instead of allowing them to terminate OSC 8", () => {
        const unsafePath = "/tmp/unsafe\x1b]8;;https://evil.test\x07";
        const url = buildFileUrl(unsafePath);

        expect(url).toBe("file:///tmp/unsafe%1B%5D8%3B%3Bhttps%3A//evil.test%07");
        expect(url).not.toContain("\x1b");
        expect(url).not.toContain("\x07");
    });

    it("fails closed for a malformed Unicode path instead of throwing", () => {
        expect(() => buildFileUrl("/tmp/\uD800")).not.toThrow();
        expect(buildFileUrl("/tmp/\uD800")).toBeNull();
    });
});
