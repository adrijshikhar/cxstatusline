import * as childProcess from "node:child_process";
import { describe, expect, it, spyOn } from "bun:test";
import { getJjChangeCounts, parseDiffStat } from "../../src/utils/jj";

describe("getJjChangeCounts parsing", () => {
  it("ignores insertion counts in filenames preceding summary", () => {
    const stat = "777 insertions.txt | 1 +\n1 file changed, 1 insertion(+), 0 deletions(-)\n";
    expect(parseDiffStat(stat)).toEqual({
      insertions: 1,
      deletions: 0,
    });
  });

  it("ignores deletion counts in filenames preceding summary", () => {
    const stat = "888 deletions.txt | 1 -\n1 file changed, 0 insertions(+), 1 deletion(-)\n";
    expect(parseDiffStat(stat)).toEqual({
      insertions: 0,
      deletions: 1,
    });
  });

  it("returns zero counts for empty stat", () => {
    expect(parseDiffStat("")).toEqual({
      insertions: 0,
      deletions: 0,
    });
  });

  it("parses diffstat correctly even when jj appends trailing hints or warnings", () => {
    const statWithHint =
      "src/index.ts | 4 ++--\n" +
      "1 file changed, 2 insertions(+), 2 deletions(-)\n" +
      "Hint: The working copy is clean (no changes to commit)";
    expect(parseDiffStat(statWithHint)).toEqual({
      insertions: 2,
      deletions: 2,
    });
  });

  it("ignores trailing hint containing words insertions and deletions without numbers", () => {
    const statWithHint =
      "src/index.ts | 4 ++--\n" +
      "1 file changed, 5 insertions(+), 3 deletions(-)\n" +
      "Hint: There were no insertions into parent and no deletions pending";
    expect(parseDiffStat(statWithHint)).toEqual({
      insertions: 5,
      deletions: 3,
    });
  });

  it("passes --color=never to jj invocations", () => {
    const spy = spyOn(childProcess, "execFileSync").mockReturnValue("clean\n");
    try {
      getJjChangeCounts({} as any);
      expect(spy).toHaveBeenCalled();
      const call = spy.mock.calls[0];
      expect(call?.[1]).toEqual(["--color=never", "diff", "--stat"]);
    } finally {
      spy.mockRestore();
    }
  });
});
