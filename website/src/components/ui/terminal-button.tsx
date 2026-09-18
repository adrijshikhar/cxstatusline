import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type * as React from "react";
import { cn } from "../../lib/utils";

export interface TerminalButtonProps extends useRender.ComponentProps<"button"> {}

export function TerminalButton({ children, className, render, ...props }: TerminalButtonProps): React.ReactElement {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">({
      className: cn(
        "terminal-button inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap outline-none pointer-coarse:min-h-11 focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:pointer-events-none disabled:opacity-64",
        className,
      ),
      type: render ? undefined : "button",
    }, {
      ...props,
      children: <>
        <span aria-hidden="true" data-terminal-bracket="open">[</span>
        <span data-terminal-label>{children}</span>
        <span aria-hidden="true" data-terminal-bracket="close">]</span>
      </>,
    }),
    render,
  });
}
