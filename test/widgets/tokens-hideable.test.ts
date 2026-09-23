import { describe, expect, test } from "bun:test";
import type { RenderContext } from "../../src/types/RenderContext";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
import type { WidgetItem } from "../../src/types/Widget";
import { TokensCachedWidget } from "../../src/widgets/TokensCached";
import { TokensInputWidget } from "../../src/widgets/TokensInput";
import { TokensOutputWidget } from "../../src/widgets/TokensOutput";
import { TokensTotalWidget } from "../../src/widgets/TokensTotal";

const baseContext: RenderContext = {
  data: {
    payload_version: 1,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cached_input_tokens: 0,
    },
  },
  now: new Date("2026-09-23T12:00:00Z"),
  terminalWidth: 80,
  isPreview: false,
};

describe("token widgets hideable states", () => {
  const widgets = [
    { name: "TokensInput", widget: new TokensInputWidget(), type: "tokens-input", label: "In: 0" },
    { name: "TokensOutput", widget: new TokensOutputWidget(), type: "tokens-output", label: "Out: 0" },
    { name: "TokensTotal", widget: new TokensTotalWidget(), type: "tokens-total", label: "Total: 0" },
    { name: "TokensCached", widget: new TokensCachedWidget(), type: "tokens-cached", label: "Cached: 0" },
  ];

  for (const { name, widget, type, label } of widgets) {
    test(`${name} declares ZERO_HIDEABLE_STATE`, () => {
      const states = widget.getHideableStates?.();
      expect(states).toBeDefined();
      expect(states?.length).toBe(1);
      expect(states?.[0]?.key).toBe("zero");
    });

    test(`${name} hides when token count is 0 and hide:zero is enabled`, () => {
      const item: WidgetItem = { id: type, type: type as any, metadata: { hide: "zero" } };
      expect(widget.render(item, baseContext, DEFAULT_SETTINGS)).toBeNull();
    });

    test(`${name} renders 0 when hide:zero is not enabled`, () => {
      const item: WidgetItem = { id: type, type: type as any };
      expect(widget.render(item, baseContext, DEFAULT_SETTINGS)).toBe(label);
    });

    test(`${name} renders formatted tokens when count > 0 regardless of hide:zero`, () => {
      const contextWithTokens: RenderContext = {
        ...baseContext,
        data: {
          payload_version: 1,
          usage: {
            input_tokens: 1500,
            output_tokens: 500,
            cached_input_tokens: 1000,
          },
        },
      };
      const item: WidgetItem = { id: type, type: type as any, metadata: { hide: "zero" } };
      expect(widget.render(item, contextWithTokens, DEFAULT_SETTINGS)).not.toBeNull();
    });
  }
});
