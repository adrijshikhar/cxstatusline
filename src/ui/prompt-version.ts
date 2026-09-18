import { createInterface } from "node:readline";

export interface PromptVersionOptions {
  readonly supportedVersions: readonly string[];
  readonly defaultVersion?: string;
  readonly isTTY?: boolean;
  readonly say?: (line: string) => void;
  readonly ask?: (question: string) => Promise<string>;
}

/**
 * Prompts the user in an interactive TTY to choose a Codex version from the supported list.
 * In non-interactive environments, immediately resolves to the default or latest supported version.
 */
export async function promptCodexVersion(options: PromptVersionOptions): Promise<string> {
  const { supportedVersions, isTTY = false, say = (s) => console.log(s) } = options;
  if (supportedVersions.length === 0) {
    throw new Error("No supported Codex versions available.");
  }

  const defaultVersion =
    options.defaultVersion && supportedVersions.includes(options.defaultVersion)
      ? options.defaultVersion
      : supportedVersions[0]!;

  if (!isTTY) {
    return defaultVersion;
  }

  const defaultIndex = supportedVersions.indexOf(defaultVersion) + 1;

  say("\nSelect Codex version to install:");
  supportedVersions.forEach((v, idx) => {
    const isDef = v === defaultVersion;
    say(`  ${idx + 1}) ${v}${isDef ? " (recommended / default)" : ""}`);
  });

  const askFn = options.ask ?? defaultAsk;

  while (true) {
    const raw = (await askFn(`Enter choice [1-${supportedVersions.length}] (default ${defaultIndex}): `)).trim();
    if (raw === "") {
      return defaultVersion;
    }

    const num = Number.parseInt(raw, 10);
    if (!Number.isNaN(num) && num >= 1 && num <= supportedVersions.length) {
      return supportedVersions[num - 1]!;
    }

    if (supportedVersions.includes(raw)) {
      return raw;
    }

    say(`Invalid selection "${raw}". Please enter a number between 1 and ${supportedVersions.length}.`);
  }
}

function defaultAsk(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
