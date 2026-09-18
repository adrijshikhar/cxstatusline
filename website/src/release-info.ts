import packageJson from "../../package.json";
import manifest from "../../patches/manifest.json";

const compareVersions = (left: string, right: string) => {
  const [leftMajor, leftMinor, leftPatch] = left.split(".").map(Number);
  const [rightMajor, rightMinor, rightPatch] = right.split(".").map(Number);
  return leftMajor - rightMajor || leftMinor - rightMinor || leftPatch - rightPatch;
};

const supportedVersions = manifest.patches.flatMap((patch) => [patch.min, patch.max]).sort(compareVersions);

export const releaseVersion = packageJson.version;
export const supportedCodexVersions = [...new Set(supportedVersions)];
