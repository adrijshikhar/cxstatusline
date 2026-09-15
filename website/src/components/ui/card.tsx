import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type React from "react";
import { cn } from "../../lib/utils";

export function Card({ className, render, ...props }: useRender.ComponentProps<"div">): React.ReactElement {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">({
      className: cn("relative flex flex-col rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--text)]", className),
      "data-slot": "card",
    }, props),
    render,
  });
}
