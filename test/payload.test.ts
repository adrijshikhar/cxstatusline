import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PayloadError, parsePayload } from "../src/payload";

const golden = readFileSync(new URL("./fixtures/payload-v1.json", import.meta.url), "utf8");

describe("parsePayload", () => {
  test("parses the golden fixture", () => {
    const p = parsePayload(golden);
    expect(p.payload_version).toBe(1);
    expect(p.model?.name).toBe("gpt-5-codex");
    expect(p.git?.changes).toEqual({ additions: 12, deletions: 3 });
    expect(p.usage?.context_window).toBe(200_000);
    expect(p.usage?.cached_input_tokens).toBe(520_000);
    expect(p.usage?.five_hour?.resets_at).toBe("2026-09-02T14:00:00Z");
    expect(p.session?.run_state).toBe("ready");
    expect(p.session?.started_at).toBe("2026-09-02T10:00:00Z");
    expect(p.session?.thread_title).toBe("dsl");
  });

  test("carries Codex's own enum identifiers, never display strings", () => {
    const p = parsePayload(golden);
    expect(p.session?.approval_mode).toBe("on-request");
    expect(p.session?.permissions).toBe("workspace-write");
  });

  test("accepts a payload with every optional field absent", () => {
    expect(parsePayload('{"payload_version":1}')).toEqual({ payload_version: 1 });
  });

  test("treats null values the same as absent", () => {
    const p = parsePayload('{"payload_version":1,"git":{"branch":null,"pr":null}}');
    expect(p.git?.branch).toBeUndefined();
    expect(p.git?.pr).toBeUndefined();
  });

  test("ignores unknown keys at every level", () => {
    const p = parsePayload('{"payload_version":1,"future":true,"model":{"name":"x","vibe":"y"}}');
    expect(p.model?.name).toBe("x");
    expect((p as unknown as Record<string, unknown>).future).toBeUndefined();
    expect((p.model as Record<string, unknown>).vibe).toBeUndefined();
  });

  test("rejects an unknown payload_version with a readable message", () => {
    expect(() => parsePayload('{"payload_version":2}')).toThrow(PayloadError);
    expect(() => parsePayload('{"payload_version":2}')).toThrow(/payload_version 2 .* only 1/);
  });

  test("rejects a missing payload_version", () => {
    expect(() => parsePayload('{"model":{}}')).toThrow(/payload_version/);
  });

  test("rejects non-JSON and non-object input", () => {
    expect(() => parsePayload("not json")).toThrow(PayloadError);
    expect(() => parsePayload("[1]")).toThrow(PayloadError);
    expect(() => parsePayload("")).toThrow(PayloadError);
  });

  test("drops fields of the wrong type instead of failing", () => {
    const p = parsePayload('{"payload_version":1,"usage":{"used_tokens":"lots","context_used":0.5,"context_tokens":null,"context_window":null,"input_tokens":null,"output_tokens":null,"cached_input_tokens":null},"session":{"started_at":1,"thread_title":false}}');
    expect(p.usage?.used_tokens).toBeUndefined();
    expect(p.usage?.context_used).toBe(0.5);
    expect(p.usage?.context_tokens).toBeUndefined();
    expect(p.usage?.context_window).toBeUndefined();
    expect(p.usage?.input_tokens).toBeUndefined();
    expect(p.usage?.output_tokens).toBeUndefined();
    expect(p.usage?.cached_input_tokens).toBeUndefined();
    expect(p.session?.started_at).toBeUndefined();
    expect(p.session?.thread_title).toBeUndefined();
  });
});
