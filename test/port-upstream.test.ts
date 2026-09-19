import { describe, expect, it } from "bun:test";
import {
  classifyCommit,
  formatTriageTable,
  loadUpstreamConfig,
  parseCompareResult,
  runApplyBaseline,
  saveUpstreamConfig,
} from "../scripts/port-upstream";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("port-upstream helpers", () => {
  it("parses compare payload into commit entries", () => {
    const raw = {
      total_commits: 1,
      commits: [
        {
          sha: "747b7f1427bf678d4d2f2fd632437a1feed1ed1f",
          commit: { message: "feat(widgets): give the remaining git and jj widgets symbol slots (#574)" },
          html_url: "https://github.com/sirmalloc/ccstatusline/commit/747b7f1",
        },
      ],
    };
    const parsed = parseCompareResult(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.shortSha).toBe("747b7f1");
    expect(parsed[0]?.title).toBe("feat(widgets): give the remaining git and jj widgets symbol slots (#574)");
    expect(parsed[0]?.category).toBe("A (Direct)");
  });

  it("formats triage table as markdown", () => {
    const commits = [
      {
        shortSha: "747b7f1",
        title: "feat(widgets): git symbols (#574)",
        category: "A (Direct)" as const,
        url: "https://...",
      },
    ];
    const table = formatTriageTable(commits);
    expect(table).toContain("| SHA | Category | Title |");
    expect(table).toContain("| 747b7f1 | A (Direct) | feat(widgets): git symbols (#574) |");
  });

  describe("classifyCommit", () => {
    it("classifies Category A (Direct) commits", () => {
      expect(classifyCommit("feat(widgets): give remaining git widgets symbol slots (#574)")).toBe("A (Direct)");
      expect(classifyCommit("perf(terminal): reduce terminal width overhead (#501)")).toBe("A (Direct)");
      expect(classifyCommit("fix: add timeout to cached git runner (#585)")).toBe("A (Direct)");
      expect(classifyCommit("fix: default flex mode to full (#590)")).toBe("A (Direct)");
      expect(classifyCommit("docs: add llms.txt for LLM summary (#527)")).toBe("A (Direct)");
    });

    it("classifies Category B (Adapt) commits", () => {
      expect(classifyCommit("feat(usage): let reset timers hide no-data placeholders (#542)")).toBe("B (Adapt)");
      expect(classifyCommit("refactor(usage): extract usage-percent widgets (#545)")).toBe("B (Adapt)");
      expect(classifyCommit("fix(usage): parse weekly limit at 0% as zero usage (#534)")).toBe("B (Adapt)");
    });

    it("classifies Category C (Skip) commits", () => {
      expect(classifyCommit("feat(auth): read claude token from macos keychain (#573)")).toBe("C (Skip)");
      expect(classifyCommit("fix(auth): cache oauth token fingerprint (#536)")).toBe("C (Skip)");
      expect(classifyCommit("docs: add claudenews to Related Projects (#584)")).toBe("C (Skip)");
      expect(classifyCommit("feat: call anthropic billing API")).toBe("C (Skip)");
    });

    it("classifies Category D (Tooling) commits", () => {
      expect(classifyCommit("chore(deps-dev): bump typescript from 5.4 to 5.5 (#578)")).toBe("D (Tooling)");
      expect(classifyCommit("chore(deps): bump chalk from 5.3 to 5.4 (#579)")).toBe("D (Tooling)");
      expect(classifyCommit("chore(ci): update workflow permissions (#589)")).toBe("D (Tooling)");
    });
  });

  describe("baseline configuration management", () => {
    it("updates baseline commit in config file", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "upstream-test-"));
      const configPath = join(tempDir, "upstream-test.json");
      try {
        writeFileSync(
          configPath,
          JSON.stringify({ repo: "sirmalloc/ccstatusline", baseCommit: "016be1fcf19453bd4362439b197e9cf841d7006a" }, null, 2),
          "utf8",
        );

        const targetSha = "05554cd087249167d570aed3c869915b6a18d4d2";
        runApplyBaseline(targetSha, configPath);

        const updated = loadUpstreamConfig(configPath);
        expect(updated.baseCommit).toBe(targetSha);
        expect(updated.repo).toBe("sirmalloc/ccstatusline");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("throws when empty commit SHA is provided", () => {
      expect(() => runApplyBaseline("")).toThrow("Invalid commit SHA");
    });
  });
});
