import * as React from "react";

export function useCopyToClipboard({ timeout = 2000 }: { timeout?: number } = {}) {
  const [isCopied, setIsCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const timeoutId = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyToClipboard = (value: string): void => {
    setError(null);
    setIsCopied(false);
    if (timeoutId.current) clearTimeout(timeoutId.current);
    const failed = () => setError("Could not copy. Select the commands and copy them manually.");
    if (!value || typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      failed();
      return;
    }
    void navigator.clipboard.writeText(value).then(() => {
      if (timeoutId.current) clearTimeout(timeoutId.current);
      setIsCopied(true);
      if (timeout !== 0) timeoutId.current = setTimeout(() => setIsCopied(false), timeout);
    }, failed);
  };

  React.useEffect(() => () => {
    if (timeoutId.current) clearTimeout(timeoutId.current);
  }, []);

  return { copyToClipboard, isCopied, error };
}
