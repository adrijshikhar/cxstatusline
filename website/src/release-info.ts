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

export interface CodexPlatformInfo {
  name: "macOS" | "Linux";
  arch: string;
}

export interface CodexReleaseItem {
  version: string;
  isLatest: boolean;
  platforms: CodexPlatformInfo[];
  type: "prebuilt" | "patch";
  status: string;
  releaseUrl: string;
}

export const SUPPORTED_PLATFORMS: CodexPlatformInfo[] = [
  { name: "macOS", arch: "Apple Silicon, Intel" },
  { name: "Linux", arch: "x64, arm64" },
];

const RELEASE_META_MAP: Record<string, { type: "prebuilt" | "patch"; status: string; platforms?: CodexPlatformInfo[]; url: string }> = {
  "0.155.0": { type: "prebuilt", status: "Verified", platforms: SUPPORTED_PLATFORMS, url: "https://github.com/adrijshikhar/cxstatusline/releases/tag/codex-v0.155.0" },
  "0.154.0": { type: "prebuilt", status: "Verified", platforms: SUPPORTED_PLATFORMS, url: "https://github.com/adrijshikhar/cxstatusline/releases/tag/codex-v0.154.0" },
  "0.153.4": { type: "prebuilt", status: "Verified", platforms: SUPPORTED_PLATFORMS, url: "https://github.com/adrijshikhar/cxstatusline/releases/tag/cxstatusline-v0.1.1-codex-v0.153.4" },
  "0.153.0": { type: "prebuilt", status: "Verified", platforms: SUPPORTED_PLATFORMS, url: "https://github.com/adrijshikhar/cxstatusline/releases/tag/cxstatusline-v0.1.0-codex-v0.153.0" },
  "0.152.1": { type: "prebuilt", status: "Verified", platforms: SUPPORTED_PLATFORMS, url: "https://github.com/adrijshikhar/cxstatusline/releases/tag/codex-v0.152.1" },
};

export const releaseVersion = packageJson.version;
export const supportedCodexVersions = uniqueVersions;

export const supportedCodexReleases: CodexReleaseItem[] = uniqueVersions.map((version, index) => {
  const meta = RELEASE_META_MAP[version] ?? {
    type: "prebuilt",
    status: "Verified",
    platforms: SUPPORTED_PLATFORMS,
    url: `https://github.com/adrijshikhar/cxstatusline/releases/tag/codex-v${version}`,
  };
  return {
    version,
    isLatest: index === 0,
    platforms: meta.platforms ?? SUPPORTED_PLATFORMS,
    type: meta.type,
    status: meta.status,
    releaseUrl: meta.url,
  };
});
