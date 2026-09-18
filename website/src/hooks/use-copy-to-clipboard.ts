import * as React from "react";

function fallbackCopyText(text: string): boolean {
  if (typeof document === "undefined") return false;
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.opacity = "0";
  textArea.style.pointerEvents = "none";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  let successful = false;
  try {
    successful = document.execCommand("copy");
  } catch {
    successful = false;
  }
  document.body.removeChild(textArea);
  return successful;
}

export function useCopyToClipboard({ timeout = 2000 }: { timeout?: number } = {}) {
  const [isCopied, setIsCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const timeoutId = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyToClipboard = (value: string): void => {
    setError(null);
    setIsCopied(false);
    if (timeoutId.current) clearTimeout(timeoutId.current);

    const markSuccess = () => {
      if (timeoutId.current) clearTimeout(timeoutId.current);
      setIsCopied(true);
      if (timeout !== 0) timeoutId.current = setTimeout(() => setIsCopied(false), timeout);
    };

    const failed = () => setError("Could not copy. Select the commands and copy them manually.");

    if (!value) {
      failed();
      return;
    }

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(markSuccess, () => {
        if (fallbackCopyText(value)) {
          markSuccess();
        } else {
          failed();
        }
      });
      return;
    }

    if (fallbackCopyText(value)) {
      markSuccess();
    } else {
      failed();
    }
  };

  React.useEffect(() => () => {
    if (timeoutId.current) clearTimeout(timeoutId.current);
  }, []);

  return { copyToClipboard, isCopied, error };
}
