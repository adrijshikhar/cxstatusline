import { describe, expect, it, spyOn } from "bun:test";
import * as os from "node:os";
import { CurrentWorkingDirWidget } from "../../src/widgets/CurrentWorkingDir";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
import type { RenderContext } from "../../src/types/RenderContext";
import type { WidgetItem } from "../../src/types/Widget";
import { getVisibleText, getVisibleWidth } from "../../src/utils/ansi";
import {
    buildFileUrl,
    buildIdeFileUrl,
    renderOsc8Link
} from "../../src/utils/hyperlink";
import { sanitizeTerminalText } from "../../src/utils/terminal-sanitize";

const widget = new CurrentWorkingDirWidget();

function createItem(
    metadata?: Record<string, string>,
    rawValue = false,
    character?: string
): WidgetItem {
    return {
        id: "cwd",
        type: "current-working-dir",
        rawValue,
        metadata,
        character
    };
}

function createContext(cwd?: string, isPreview = false): RenderContext {
    return {
        isPreview,
        terminalWidth: 200,
        now: new Date(),
        data: {
            payload_version: 1,
            session: cwd ? { cwd } : undefined
        }
    };
}

describe("CurrentWorkingDirWidget links", () => {
    describe("links", () => {
        it("is off by default and leaves the existing output unchanged", () => {
            const item = createItem();
            expect(widget.render(item, createContext("/var/www/site"), DEFAULT_SETTINGS)).toBe("cwd: /var/www/site");
        });

        it.each([
            {
                mode: "file",
                path: "/Users/alice/Documents/我的 项目 #1?%",
                visiblePath: "~/Documents/我的 项目 #1?%",
                buildTarget: buildFileUrl
            },
            {
                mode: "vscode",
                path: "/Users/alice/Documents/我的 项目 #1?%",
                visiblePath: "~/Documents/我的 项目 #1?%",
                buildTarget: (path: string) => buildIdeFileUrl(path, "vscode")
            },
            {
                mode: "cursor",
                path: "/Users/alice/Documents/我的 项目 #1?%",
                visiblePath: "~/Documents/我的 项目 #1?%",
                buildTarget: (path: string) => buildIdeFileUrl(path, "cursor")
            }
        ])("links the shortened $mode label to the full absolute cwd", ({ mode, path, visiblePath, buildTarget }) => {
            const spy = spyOn(os, "homedir").mockReturnValue("/Users/alice");
            try {
                const item = createItem({
                    abbreviateHome: "true",
                    segments: "2",
                    linkTo: mode
                }, true);

                expect(widget.render(item, createContext(path), DEFAULT_SETTINGS)).toBe(
                    renderOsc8Link(buildTarget(path) ?? "", visiblePath)
                );
            } finally {
                spy.mockRestore();
            }
        });

        it("links file-manager URLs with file URL semantics for Windows drive paths", () => {
            const path = "C:\\Users\\alice\\我的 project#1?%";
            const item = createItem({ linkTo: "file" }, true);

            expect(widget.render(item, createContext(path), DEFAULT_SETTINGS)).toBe(
                renderOsc8Link("file:///C:/Users/alice/%E6%88%91%E7%9A%84%20project%231%3F%25", path)
            );
        });

        it("links file-manager URLs with UNC network semantics", () => {
            const path = "\\\\server\\share\\我的 project#1?%";
            const item = createItem({ linkTo: "file" }, true);

            expect(widget.render(item, createContext(path), DEFAULT_SETTINGS)).toBe(
                renderOsc8Link("file://server/share/%E6%88%91%E7%9A%84%20project%231%3F%25", path)
            );
        });

        it.each([
            { mode: "file", target: "file:///tmp/a%5Cb" },
            { mode: "vscode", target: "vscode://file/tmp/a%5Cb" },
            { mode: "cursor", target: "cursor://file/tmp/a%5Cb" }
        ])("treats literal backslashes in a POSIX cwd as part of the filename in $mode mode", ({ mode, target }) => {
            const path = "/tmp/a\\b";
            const item = createItem({ linkTo: mode }, true);

            expect(widget.render(item, createContext(path), DEFAULT_SETTINGS)).toBe(
                renderOsc8Link(target, path)
            );
        });

        it("falls back to the visible label for an invalid UNC server or malformed Unicode", () => {
            const item = createItem({ linkTo: "file" }, true);
            const malformedUnicode = "/tmp/\uD800";

            expect(widget.render(item, createContext("\\\\server#fragment\\share"), DEFAULT_SETTINGS))
                .toBe("\\\\server#fragment\\share");
            expect(widget.render(item, createContext(malformedUnicode), DEFAULT_SETTINGS))
                .toBe(malformedUnicode);
        });

        it("keeps incomplete paths visible without creating a bogus target", () => {
            const item = createItem({ linkTo: "file" }, true);

            expect(widget.render(item, createContext("relative/project"), DEFAULT_SETTINGS)).toBe("relative/project");
            expect(widget.render(item, createContext("C:"), DEFAULT_SETTINGS)).toBe("C:");
        });

        it("does not create a link for an unknown or inapplicable mode", () => {
            const unknownMode = createItem({ linkTo: "browser" }, true);
            const ideUnc = createItem({ linkTo: "vscode" }, true);

            expect(widget.render(unknownMode, createContext("/var/www/site"), DEFAULT_SETTINGS)).toBe("/var/www/site");
            expect(widget.render(ideUnc, createContext("relative/project"), DEFAULT_SETTINGS)).toBe("relative/project");
        });

        it("does not render a link when cwd is missing", () => {
            const item = createItem({ linkTo: "file" }, true);
            expect(widget.render(item, createContext(), DEFAULT_SETTINGS)).toBeNull();
        });

        it("previews the shortened label and complete file target", () => {
            const item = createItem({
                abbreviateHome: "true",
                segments: "2",
                linkTo: "file"
            });

            expect(widget.render(item, createContext(undefined, true), DEFAULT_SETTINGS)).toBe(
                renderOsc8Link(
                    buildFileUrl("/Users/example/Documents/Projects/my-project") ?? "",
                    "cwd: ~/.../Projects/my-project"
                )
            );
        });

        it("keeps the visible text shortened while preserving the full target", () => {
            const path = "/Volumes/External/中文 项目 #1?%/nested/final";
            const item = createItem({
                abbreviateHome: "false",
                segments: "2",
                fishStyle: "true",
                linkTo: "cursor"
            }, true);

            expect(widget.render(item, createContext(path), DEFAULT_SETTINGS)).toBe(
                renderOsc8Link(
                    buildIdeFileUrl(path, "cursor"),
                    "/Volumes/E/中/n/final"
                )
            );
        });

        it("does not count OSC 8 escapes toward status line width or truncation", () => {
            const item = createItem({ linkTo: "file" }, true);
            const rendered = widget.render(item, createContext("/var/www/site"), DEFAULT_SETTINGS);
            const visible = getVisibleText(rendered ?? "");

            expect(visible).toBe("/var/www/site");
            expect(getVisibleWidth(rendered ?? "")).toBe(visible.length);
            expect(getVisibleWidth(rendered ?? "")).toBeLessThan(200);
        });

        it("does not let OSC 8 controls in a cwd become part of the hyperlink sequence", () => {
            const path = "/var/www/\x1b]8;;https://evil.test\x1b\\";
            const item = createItem({ linkTo: "file" }, true);
            const result = widget.render(item, createContext(path), DEFAULT_SETTINGS);

            expect(result).toContain("file:///var/www/%1B%5D8%3B%3Bhttps%3A//evil.test%1B%5C");
            const sanitized = sanitizeTerminalText(result ?? "");
            expect(sanitized).toBe(renderOsc8Link(
                "file:///var/www/%1B%5D8%3B%3Bhttps%3A//evil.test%1B%5C",
                "/var/www/\x1b]8;;https://evil.test\x1b\\"
            ));
        });
    });

    describe("getEditorDisplay", () => {
        it("should show ~ modifier when abbreviateHome is enabled", () => {
            const item = createItem({ abbreviateHome: "true" });
            const display = widget.getEditorDisplay(item);
            expect(display.modifierText).toBe("(~)");
        });

        it("should show the active link mode with existing modifiers", () => {
            expect(widget.getEditorDisplay(createItem({
                abbreviateHome: "true",
                segments: "2",
                linkTo: "file"
            })).modifierText).toBe("(~, segments: 2, link: file)");
        });

        it("should show VS Code and Cursor link modes in editor display", () => {
            expect(widget.getEditorDisplay(createItem({ linkTo: "vscode" })).modifierText).toBe("(link: VS Code)");
            expect(widget.getEditorDisplay(createItem({ linkTo: "cursor" })).modifierText).toBe("(link: Cursor)");
        });
    });

    describe("handleEditorAction", () => {
        it("should cycle file, VS Code, Cursor, then off without changing display metadata", () => {
            const base = createItem({ abbreviateHome: "true", segments: "2" });
            const file = widget.handleEditorAction("cycle-link", base);
            const vscode = widget.handleEditorAction("cycle-link", file ?? base);
            const cursor = widget.handleEditorAction("cycle-link", vscode ?? base);
            const off = widget.handleEditorAction("cycle-link", cursor ?? base);

            expect(file?.metadata).toEqual({ abbreviateHome: "true", segments: "2", linkTo: "file" });
            expect(vscode?.metadata?.linkTo).toBe("vscode");
            expect(cursor?.metadata?.linkTo).toBe("cursor");
            expect(off?.metadata).toEqual({ abbreviateHome: "true", segments: "2" });
        });
    });

    describe("getCustomKeybinds", () => {
        it("should expose the link cycle keybind without changing other controls", () => {
            expect(widget.getCustomKeybinds()).toContainEqual({
                key: "l",
                label: "(l)ink mode",
                action: "cycle-link"
            });
            expect(widget.getCustomKeybinds().map(keybind => keybind.key)).toEqual(["h", "s", "f", "l", "g"]);
        });
    });
});
