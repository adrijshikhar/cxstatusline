import { describe, expect, test } from "bun:test";
import { resolveSource, sourceCommit } from "../scripts/prebuilt";

describe("resolveSource", () => {
  test("resolves sourceCommit from checkout HEAD when --source-commit is omitted", () => {
    const source = resolveSource({}, "schedule");
    expect(source.sourceCommit).toBe(sourceCommit());
    expect(source.cxVersion).toBe("");
    expect(source.sourceTag).toBeNull();
    expect(source.frozen).toBe(false);
  });

  test("respects explicit --source-commit flag", () => {
    const commit = "1234567890abcdef1234567890abcdef12345678";
    const source = resolveSource({ "source-commit": commit }, "schedule");
    expect(source.sourceCommit).toBe(commit);
    expect(source.cxVersion).toBe("");
    expect(source.sourceTag).toBeNull();
    expect(source.frozen).toBe(false);
  });

  test("manual dispatch returns checkout commit without querying releases", () => {
    const source = resolveSource({}, "workflow_dispatch");
    expect(source.sourceCommit).toBe(sourceCommit());
    expect(source.cxVersion).toBe("");
    expect(source.sourceTag).toBeNull();
    expect(source.frozen).toBe(false);
  });
});
