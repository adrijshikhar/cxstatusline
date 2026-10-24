import { CheckIcon, CopyIcon } from "lucide-react";
import { useCopyToClipboard } from "../hooks/use-copy-to-clipboard";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

export default function CopyFlagButton({ text }: { text: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ timeout: 1500 });
  return (
    <TooltipProvider delay={100}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              className="h-7 w-7 min-w-7 p-0 text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-strong)] border-transparent bg-transparent rounded"
              aria-label={isCopied ? "Copied install command to clipboard" : `Copy install command for ${text}`}
              onClick={() => copyToClipboard(text)}
            >
              {isCopied ? (
                <CheckIcon className="size-3.5 text-[var(--status-verified)]" strokeWidth={1.5} aria-hidden="true" />
              ) : (
                <CopyIcon className="size-3.5 opacity-60 hover:opacity-100" strokeWidth={1.5} aria-hidden="true" />
              )}
              <span className="sr-only">{isCopied ? "Copied" : "Copy install command"}</span>
            </Button>
          }
        />
        <TooltipContent side="top">
          {isCopied ? (
            <span className="text-[var(--status-verified)] font-medium">Copied to clipboard!</span>
          ) : (
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="text-[var(--dim)]">Copy:</span>
              <span className="text-[var(--accent-strong)]">{text}</span>
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
