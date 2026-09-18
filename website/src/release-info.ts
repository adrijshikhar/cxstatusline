import packageJson from "../../package.json";
import manifest from "../../patches/manifest.json";

const compareVersionsDesc = (left: string, right: string) => {
  const [leftMajor, leftMinor, leftPatch] = left.split(".").map(Number);
  const [rightMajor, rightMinor, rightPatch] = right.split(".").map(Number);
  return rightMajor - leftMajor || rightMinor - leftMinor || rightPatch - leftPatch;
};

const uniqueVersions = [
  ...new Set([
    ...(manifest.candidate ? [manifest.candidate] : []),
    ...manifest.patches.flatMap((patch) => [patch.min, patch.max]),
  ]),
].sort(compareVersionsDesc);

export interface CodexReleaseItem {
  version: string;
  isLatest: boolean;
  platforms: string[];
  type: "prebuilt" | "patch";
  status: string;
  releaseUrl: string;
}

const MACOS_PLATFORMS = ["macOS (Apple Silicon, Intel)"];

const RELEASE_META_MAP: Record<string, { type: "prebuilt" | "patch"; status: string; platforms: string[]; url: string }> = {
  "0.155.0": { type: "prebuilt", status: "Verified", platforms: MACOS_PLATFORMS, url: "https://github.com/adrijshikhar/cxstatusline/releases/tag/codex-v0.155.0" },
  "0.154.0": { type: "prebuilt", status: "Verified", platforms: MACOS_PLATFORMS, url: "https://github.com/adrijshikhar/cxstatusline/releases/tag/codex-v0.154.0" },
  "0.153.4": { type: "prebuilt", status: "Verified", platforms: MACOS_PLATFORMS, url: "https://github.com/adrijshikhar/cxstatusline/releases/tag/cxstatusline-v0.1.1-codex-v0.153.4" },
  "0.153.0": { type: "prebuilt", status: "Verified", platforms: MACOS_PLATFORMS, url: "https://github.com/adrijshikhar/cxstatusline/releases/tag/cxstatusline-v0.1.0-codex-v0.153.0" },
  "0.152.1": { type: "prebuilt", status: "Verified", platforms: MACOS_PLATFORMS, url: "https://github.com/adrijshikhar/cxstatusline/releases/tag/codex-v0.152.1" },
};

export const releaseVersion = packageJson.version;
export const supportedCodexVersions = uniqueVersions;

export const supportedCodexReleases: CodexReleaseItem[] = uniqueVersions.map((version, index) => {
  const meta = RELEASE_META_MAP[version] ?? {
    type: "prebuilt",
    status: "Verified",
    platforms: MACOS_PLATFORMS,
    url: `https://github.com/adrijshikhar/cxstatusline/releases/tag/codex-v${version}`,
  };
  return {
    version,
    isLatest: index === 0,
    platforms: meta.platforms,
    type: meta.type,
    status: meta.status,
    releaseUrl: meta.url,
  };
});
