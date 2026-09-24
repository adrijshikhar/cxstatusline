import { createElement } from "react";
import { prompt } from "./prompt";
import { VersionPicker } from "./VersionPicker";

export interface PromptVersionOptions {
  readonly supportedVersions: readonly string[];
  readonly prebuiltVersions?: readonly string[];
  readonly defaultVersion?: string;
  readonly isTTY?: boolean;
  readonly say?: (line: string) => void;
  readonly compile?: boolean;
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
export async function promptCodexVersion(options: PromptVersionOptions): Promise<PromptVersionSelection | null> {
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
    return { version: defaultVersion, compile: options.compile || isSourceOnly };
  }

  const selection = await prompt<PromptVersionSelection | null>((onSelect) => createElement(VersionPicker, {
    ...options,
    defaultVersion,
    onSelect,
  }), null);
  if (selection) say(`Selected Codex ${selection.version} (${selection.compile ? "build from source" : "prebuilt"}).`);
  return selection;
}
