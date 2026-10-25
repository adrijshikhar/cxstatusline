import * as React from "react";
import { cn } from "../../lib/utils";

interface TooltipContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const TooltipContext = React.createContext<TooltipContextType | null>(null);

export function TooltipProvider({
  children,
  delay: _delay = 150,
}: {
  children: React.ReactNode;
  delay?: number;
}): React.ReactElement {
  return <>{children}</>;
}

export function Tooltip({
  children,
  delayDuration = 150,
}: {
  children: React.ReactNode;
  delayDuration?: number;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleOpen = React.useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setOpen(true), delayDuration);
  }, [delayDuration]);

  const handleClose = React.useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(false);
  }, []);

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <TooltipContext.Provider value={{ open, setOpen }}>
      <div
        className="relative inline-flex items-center"
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
        onFocus={handleOpen}
        onBlur={handleClose}
      >
        {children}
      </div>
    </TooltipContext.Provider>
  );
}

export function TooltipTrigger({
  children,
  render,
  className,
}: {
  children?: React.ReactNode;
  render?: React.ReactElement<{ className?: string }>;
  className?: string;
}): React.ReactElement {
  if (render) {
    return React.cloneElement(render, {
      className: cn(render.props.className, className),
    });
  }
  return <span className={className}>{children}</span>;
}

export interface TooltipContentProps extends React.HTMLAttributes<HTMLDivElement> {
  side?: "top" | "bottom" | "left" | "right";
}

export function TooltipContent({
  className,
  side = "top",
  children,
  ...props
}: TooltipContentProps): React.ReactElement | null {
  const ctx = React.useContext(TooltipContext);
  if (!ctx?.open) return null;

  return (
    <div
      role="tooltip"
      className={cn("shadcn-tooltip", side === "top" ? "shadcn-tooltip-top" : "", className)}
      {...props}
    >
      {children}
    </div>
  );
}
