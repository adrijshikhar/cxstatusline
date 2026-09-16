import { CheckIcon, CopyIcon } from "lucide-react";
import { useCopyToClipboard } from "../hooks/use-copy-to-clipboard";
import { Button } from "./ui/button";

export default function CopyInstallButton({ commands }: { commands: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ timeout: 1500 });
  return (
    <Button
      id="copy-install"
      className="absolute right-2 top-2 font-mono text-[var(--accent-strong)]"
      aria-live="polite"
      onClick={() => copyToClipboard(commands)}
    >
      {isCopied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
      {isCopied ? "Copied" : "Copy"}
    </Button>
  );
}
