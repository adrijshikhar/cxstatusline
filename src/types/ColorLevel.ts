import { z } from "zod";

export const ColorLevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export type ColorLevel = z.infer<typeof ColorLevelSchema>;
export type ColorLevelString = "none" | "ansi16" | "ansi256" | "truecolor";

export function getColorLevelString(level: ColorLevel | undefined): ColorLevelString {
  switch (level) {
    case 0:
      return "none";
    case 1:
      return "ansi16";
    case 3:
      return "truecolor";
    case 2:
    default:
      return "ansi256";
  }
}
