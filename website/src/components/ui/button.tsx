import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type * as React from "react";
import { cn } from "../../lib/utils";

export interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: "ghost" | "outline";
}

export function Button({ className, variant = "ghost", render, ...props }: ButtonProps): React.ReactElement {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">({
      className: cn(
        "relative inline-flex h-7 shrink-0 appearance-none cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-xs font-medium outline-none pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:pointer-events-none disabled:opacity-64 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
        variant === "outline"
          ? "border-[var(--line)] bg-transparent text-[var(--text)] hover:bg-[var(--surface-strong)]"
          : "border-transparent bg-transparent text-[var(--text)] hover:bg-[var(--surface-strong)]",
        className,
      ),
      "data-slot": "button",
      type: render ? undefined : "button",
    }, props),
    render,
  });
}
