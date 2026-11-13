import { describe, expect, it } from "bun:test";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
import type { RenderContext } from "../../src/types/RenderContext";
import type { WidgetItem } from "../../src/types/Widget";
import { ThinkingEffortWidget } from "../../src/widgets/ThinkingEffort";
import {
    cycleBracketStyle,
    formatThinkingEffort,
    getBracketStyle,
    isLevelColorsEnabled,
    type EffortDisplay
} from "../../src/widgets/shared/effort-style";

describe("ThinkingEffortWidget", () => {
    const widget = new ThinkingEffortWidget();

    const createContext = (reasoning?: string): RenderContext => ({
        data: {
            payload_version: 1,
            model: { reasoning }
        },
        now: new Date(),
        terminalWidth: 80,
        isPreview: false
    });

    it("renders thinking effort labeled by default", () => {
        const item: WidgetItem = { id: "think", type: "thinking-effort" };
        expect(widget.render(item, createContext("high"), DEFAULT_SETTINGS)).toBe("Thinking: high");
    });

    it("renders preview with high by default", () => {
        const item: WidgetItem = { id: "think", type: "thinking-effort" };
        const previewContext: RenderContext = { ...createContext(), isPreview: true };
        expect(widget.render(item, previewContext, DEFAULT_SETTINGS)).toBe("Thinking: high");
    });

    it("cycles bracket styles with keybind b", () => {
        let item: WidgetItem = { id: "think", type: "thinking-effort" };
        const keybinds = widget.getCustomKeybinds();
        const bracketAction = keybinds.find(k => k.key === "b")?.action ?? "";

        item = widget.handleEditorAction(bracketAction, item)!;
        expect(getBracketStyle(item)).toBe("()");

        item = widget.handleEditorAction(bracketAction, item)!;
        expect(getBracketStyle(item)).toBe("[]");

        item = widget.handleEditorAction(bracketAction, item)!;
        expect(getBracketStyle(item)).toBe("{}");

        item = widget.handleEditorAction(bracketAction, item)!;
        expect(getBracketStyle(item)).toBe("<>");

        item = widget.handleEditorAction(bracketAction, item)!;
        expect(getBracketStyle(item)).toBeNull();
    });

    it("reports colorsOnlyItsRuns true only when levelColors is enabled", () => {
        const item: WidgetItem = { id: "think", type: "thinking-effort" };
        expect(widget.colorsOnlyItsRuns?.(item)).toBe(false);
        expect(widget.colorsOnlyItsRuns?.({ ...item, metadata: { levelColors: "true" } })).toBe(true);
    });

    it("shows active options in modifierText", () => {
        expect(widget.getEditorDisplay({ id: "think", type: "thinking-effort" }).modifierText).toBeUndefined();
        expect(widget.getEditorDisplay({
            id: "think",
            type: "thinking-effort",
            metadata: { brackets: "<>", levelColors: "true" }
        }).modifierText).toBe("(brackets <>, level colors)");
    });

    it("formats level colors using ANSI codes when level colors is enabled", () => {
        const item: WidgetItem = {
            id: "think",
            type: "thinking-effort",
            metadata: { brackets: "()", levelColors: "true" }
        };
        const highEffort: EffortDisplay = { text: "high", level: "high" };
        const formatted = formatThinkingEffort(item, highEffort, { colorLevel: "truecolor", colorsDisabled: false });

        expect(formatted).toContain("Thinking: ");
        expect(formatted).toContain("high");
        expect(formatted).toContain("\x1b[39m");
    });
});
