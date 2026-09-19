import { z } from "zod";
import { ColorLevelSchema } from "./ColorLevel";
import { FlexModeSchema } from "./FlexMode";
import { GlobalNumberFormatSchema } from "./NumberFormat";
import { PowerlineConfigSchema } from "./PowerlineConfig";
import { WidgetItemSchema } from "./Widget";

export const CURRENT_VERSION = 3;

export const DefaultPaddingSideSchema = z.enum(["both", "left", "right"]);
export type DefaultPaddingSide = z.infer<typeof DefaultPaddingSideSchema>;

export const SettingsSchema = z.object({
  version: z.literal(CURRENT_VERSION).default(CURRENT_VERSION),
  lines: z.array(z.array(WidgetItemSchema)).min(1).max(3).default([
    [
      { id: "1", type: "model", color: "cyan" },
      { id: "2", type: "separator" },
      { id: "3", type: "context-window", color: "brightBlack" },
      { id: "4", type: "separator" },
      { id: "5", type: "git-branch", color: "magenta" },
      { id: "6", type: "separator" },
      { id: "7", type: "git-changes", color: "yellow" },
    ],
    [],
    [],
  ]),
  flexMode: FlexModeSchema.default("full"),
  compactThreshold: z.number().min(1).max(99).default(60),
  colorLevel: ColorLevelSchema.default(2),
  defaultSeparator: z.string().optional(),
  defaultPadding: z.string().optional(),
  defaultPaddingSide: DefaultPaddingSideSchema.default("both"),
  inheritSeparatorColors: z.boolean().default(false),
  overrideBackgroundColor: z.string().optional(),
  overrideForegroundColor: z.string().optional(),
  globalBold: z.boolean().default(false),
  terminalWidthCacheTtlSeconds: z.number().default(5),
  minimalistMode: z.boolean().default(false),
  numberFormat: GlobalNumberFormatSchema.optional(),
  powerline: PowerlineConfigSchema.default({
    enabled: false,
    separators: ["\uE0B0"],
    separatorInvertBackground: [false],
    startCaps: [],
    endCaps: [],
    autoAlign: false,
    continueThemeAcrossLines: false,
  }),
});

export type Settings = z.infer<typeof SettingsSchema>;
export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});
