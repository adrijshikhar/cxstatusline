import * as React from "react";

export function useCopyToClipboard({ timeout = 2000 }: { timeout?: number } = {}) {
  const [isCopied, setIsCopied] = React.useState(false);
  const timeoutId = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyToClipboard = (value: string): void => {
    if (!value || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(value).then(() => {
      if (timeoutId.current) clearTimeout(timeoutId.current);
      setIsCopied(true);
      if (timeout !== 0) timeoutId.current = setTimeout(() => setIsCopied(false), timeout);
    }, console.error);
  };

  React.useEffect(() => () => {
    if (timeoutId.current) clearTimeout(timeoutId.current);
  }, []);

  return { copyToClipboard, isCopied };
}
