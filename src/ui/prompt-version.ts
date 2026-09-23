import { createInterface } from "node:readline";

export interface PromptVersionOptions {
  readonly supportedVersions: readonly string[];
  readonly prebuiltVersions?: readonly string[];
  readonly defaultVersion?: string;
  readonly isTTY?: boolean;
  readonly say?: (line: string) => void;
  readonly ask?: (question: string) => Promise<string>;
}

export interface PromptVersionSelection {
  readonly version: string;
  readonly compile: boolean;
}

/**
 * Prompts the user in an interactive TTY to choose a Codex version from the supported list,
 * displaying prebuilt vs compile-from-source availability.
 * In non-interactive environments, immediately resolves to the default or highest available version.
 */
export async function promptCodexVersion(options: PromptVersionOptions): Promise<PromptVersionSelection> {
  const { supportedVersions, prebuiltVersions, isTTY = false, say = (s) => console.log(s) } = options;
  if (supportedVersions.length === 0) {
    throw new Error("No supported Codex versions available.");
  }

  let defaultVersion: string;
  if (options.defaultVersion && supportedVersions.includes(options.defaultVersion)) {
    defaultVersion = options.defaultVersion;
  } else if (prebuiltVersions && prebuiltVersions.length > 0) {
    defaultVersion = supportedVersions.find((v) => prebuiltVersions.includes(v)) ?? supportedVersions[0]!;
  } else {
    defaultVersion = supportedVersions[0]!;
  }

  if (!isTTY) {
    const isSourceOnly = Boolean(prebuiltVersions && !prebuiltVersions.includes(defaultVersion));
    return { version: defaultVersion, compile: isSourceOnly };
  }

  const defaultIndex = supportedVersions.indexOf(defaultVersion) + 1;

  say("\nSelect Codex version to install:");
  supportedVersions.forEach((v, idx) => {
    const isDef = v === defaultVersion;
    let tag = "";
    if (prebuiltVersions) {
      tag = prebuiltVersions.includes(v)
        ? " [prebuilt available]"
        : " [compile from source - prebuilt pending]";
    }
    say(`  ${idx + 1}) ${v}${tag}${isDef ? " (recommended / default)" : ""}`);
  });

  const askFn = options.ask ?? defaultAsk;

  while (true) {
    const raw = (await askFn(`Enter choice [1-${supportedVersions.length}] (default ${defaultIndex}): `)).trim();
    let selectedVersion: string | null = null;

    if (raw === "") {
      selectedVersion = defaultVersion;
    } else {
      const num = Number.parseInt(raw, 10);
      if (!Number.isNaN(num) && num >= 1 && num <= supportedVersions.length) {
        selectedVersion = supportedVersions[num - 1]!;
      } else if (supportedVersions.includes(raw)) {
        selectedVersion = raw;
      }
    }

    if (!selectedVersion) {
      say(`Invalid selection "${raw}". Please enter a number between 1 and ${supportedVersions.length}.`);
      continue;
    }

    const hasPrebuilt = !prebuiltVersions || prebuiltVersions.includes(selectedVersion);
    if (!hasPrebuilt) {
      const confirm = (
        await askFn(
          `No prebuilt binary is published for Codex ${selectedVersion} yet. Would you like to compile from source instead? [y/N]: `,
        )
      )
        .trim()
        .toLowerCase();
      if (confirm === "y" || confirm === "yes") {
        return { version: selectedVersion, compile: true };
      }
      say("Please select a version with prebuilt binaries available, or run with --compile.");
      continue;
    }

    return { version: selectedVersion, compile: false };
  }
}

export function defaultAsk(question: string): Promise<string> {
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
