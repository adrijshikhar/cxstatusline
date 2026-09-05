import { z } from "zod";

export const FlexModeSchema = z.enum(["full", "full-minus-40", "full-until-compact"]);
export type FlexMode = z.infer<typeof FlexModeSchema>;
