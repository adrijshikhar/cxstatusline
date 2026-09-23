import { describe, expect, it } from "bun:test";
import type { WidgetItem } from "../../src/types/Widget";
import { applyMergeTargetHiding, type PreRenderedWidget } from "../../src/utils/renderer";
import { CustomSymbolWidget } from "../../src/widgets/CustomSymbol";
import { CustomTextWidget } from "../../src/widgets/CustomText";

function element(
  type: string,
  content: string,
  overrides: Partial<WidgetItem> = {}
): PreRenderedWidget {
  return {
    content,
    plainLength: content.length,
    widget: { id: `${type}-${Math.random()}`, type: type as any, ...overrides },
  };
}

function hidingSymbol(content: string, merge?: WidgetItem["merge"]): PreRenderedWidget {
  return element("custom-symbol", content, {
    merge,
    metadata: { hide: "merge-target-hidden" },
  });
}

function hidingText(content: string, merge?: WidgetItem["merge"]): PreRenderedWidget {
  return element("custom-text", content, {
    merge,
    metadata: { hide: "merge-target-hidden" },
  });
}

describe("decorative widgets hideable states", () => {
  it("CustomSymbolWidget declares MERGE_TARGET_HIDDEN_HIDEABLE_STATE", () => {
    const widget = new CustomSymbolWidget();
    const states = widget.getHideableStates?.();
    expect(states).toBeDefined();
    expect(states?.length).toBe(1);
    expect(states?.[0]?.key).toBe("merge-target-hidden");
  });

  it("CustomTextWidget declares MERGE_TARGET_HIDDEN_HIDEABLE_STATE", () => {
    const widget = new CustomTextWidget();
    const states = widget.getHideableStates?.();
    expect(states).toBeDefined();
    expect(states?.length).toBe(1);
    expect(states?.[0]?.key).toBe("merge-target-hidden");
  });
});

describe("applyMergeTargetHiding", () => {
  it("hides a merged decorative prefix when its target rendered nothing", () => {
    const line = [hidingSymbol("★", true), element("git-branch", "")];
    applyMergeTargetHiding(line);
    expect(line[0]?.content).toBe("");
    expect(line[0]?.plainLength).toBe(0);
  });

  it("keeps the decorative prefix when its target rendered content", () => {
    const line = [hidingSymbol("★", true), element("git-branch", "⎇ main")];
    applyMergeTargetHiding(line);
    expect(line[0]?.content).toBe("★");
  });

  it("keeps decoratives that did not opt into merge-target-hidden", () => {
    const line = [element("custom-symbol", "★", { merge: true }), element("git-branch", "")];
    applyMergeTargetHiding(line);
    expect(line[0]?.content).toBe("★");
  });

  it("hides a decorative suffix when the widget merging into it rendered nothing", () => {
    const line = [element("git-branch", "", { merge: true }), hidingSymbol("★")];
    applyMergeTargetHiding(line);
    expect(line[1]?.content).toBe("");
  });

  it("collapses a fully merged chain as a unit", () => {
    const line = [
      hidingSymbol("★", "no-padding"),
      element("git-branch", "", { merge: "no-padding" }),
      hidingText("✦"),
    ];
    applyMergeTargetHiding(line);
    expect(line.map((el) => el.content)).toEqual(["", "", ""]);
  });

  it("targets the nearest non-decorative widget in merge direction", () => {
    const line = [
      hidingSymbol("★", true),
      element("tokens-total", "", { merge: true }),
      hidingSymbol("✦", true),
      element("git-branch", "⎇ main"),
    ];
    applyMergeTargetHiding(line);
    expect(line[0]?.content).toBe("");
    expect(line[2]?.content).toBe("✦");
  });

  it("leaves unmerged decoratives alone even when the state is enabled", () => {
    const line = [hidingSymbol("★"), element("git-branch", "")];
    applyMergeTargetHiding(line);
    expect(line[0]?.content).toBe("★");
  });

  it.each(["separator", "flex-separator"])("treats %s elements as merge-chain boundaries", (separatorType) => {
    const line = [
      hidingSymbol("★", true),
      element(separatorType, ""),
      element("git-branch", ""),
    ];
    applyMergeTargetHiding(line);
    expect(line[0]?.content).toBe("★");
  });
});
