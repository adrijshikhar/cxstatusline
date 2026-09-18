import type React from "react";
import { cn } from "../../lib/utils";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("rounded-sm", className)}
      data-slot="skeleton"
      {...props}
    />
  );
}
