import { CheckIcon, CopyIcon } from "lucide-react";
import { useCopyToClipboard } from "../hooks/use-copy-to-clipboard";
import { Button } from "./ui/button";

export default function CopyFlagButton({ text }: { text: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ timeout: 1500 });
  return (
    <Button
      variant="ghost"
      className="h-7 w-7 min-w-7 p-0 text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-strong)] border-transparent bg-transparent"
      title={isCopied ? "Copied!" : `Copy "${text}"`}
      aria-label={isCopied ? "Copied to clipboard" : `Copy ${text}`}
      onClick={() => copyToClipboard(text)}
    >
      {isCopied ? (
        <CheckIcon className="size-3.5 text-[var(--status-verified)]" aria-hidden="true" />
      ) : (
        <CopyIcon className="size-3.5 opacity-70 hover:opacity-100" aria-hidden="true" />
      )}
      <span className="sr-only">{isCopied ? "Copied" : "Copy"}</span>
    </Button>
  );
}
