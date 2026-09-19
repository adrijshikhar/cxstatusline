import { describe, expect, it, beforeEach } from "bun:test";
import { SettingsSchema } from "../src/types/Settings";
import {
  getTerminalWidth,
  resetTerminalWidthCache,
  canDetectTerminalWidth,
} from "../src/utils/terminal";

describe("terminal width settings & caching", () => {
  beforeEach(() => {
    resetTerminalWidthCache();
  });

  it("includes terminalWidthCacheTtlSeconds in SettingsSchema defaulting to 5", () => {
    const parsed = SettingsSchema.parse({});
    expect(parsed.terminalWidthCacheTtlSeconds).toBe(5);
  });

  it("respects CXSTATUSLINE_WIDTH environment override", () => {
    const original = process.env.CXSTATUSLINE_WIDTH;
    try {
      process.env.CXSTATUSLINE_WIDTH = "160";
      expect(getTerminalWidth()).toBe(160);
    } finally {
      process.env.CXSTATUSLINE_WIDTH = original;
    }
  });

  it("respects CCSTATUSLINE_WIDTH environment override as fallback", () => {
    const origCx = process.env.CXSTATUSLINE_WIDTH;
    const origCc = process.env.CCSTATUSLINE_WIDTH;
    try {
      delete process.env.CXSTATUSLINE_WIDTH;
      process.env.CCSTATUSLINE_WIDTH = "140";
      expect(getTerminalWidth()).toBe(140);
    } finally {
      process.env.CXSTATUSLINE_WIDTH = origCx;
      process.env.CCSTATUSLINE_WIDTH = origCc;
    }
  });

  it("prefers CXSTATUSLINE_WIDTH over CCSTATUSLINE_WIDTH", () => {
    const origCx = process.env.CXSTATUSLINE_WIDTH;
    const origCc = process.env.CCSTATUSLINE_WIDTH;
    try {
      process.env.CXSTATUSLINE_WIDTH = "180";
      process.env.CCSTATUSLINE_WIDTH = "120";
      expect(getTerminalWidth()).toBe(180);
    } finally {
      process.env.CXSTATUSLINE_WIDTH = origCx;
      process.env.CCSTATUSLINE_WIDTH = origCc;
    }
  });

  it("clears memoized width when resetTerminalWidthCache is called", () => {
    const original = process.env.CXSTATUSLINE_WIDTH;
    try {
      process.env.CXSTATUSLINE_WIDTH = "160";
      expect(getTerminalWidth()).toBe(160);
      process.env.CXSTATUSLINE_WIDTH = "200";
      resetTerminalWidthCache();
      expect(getTerminalWidth()).toBe(200);
    } finally {
      process.env.CXSTATUSLINE_WIDTH = original;
    }
  });

  it("re-probes when ttlSeconds is 0 (caching disabled)", () => {
    const original = process.env.CXSTATUSLINE_WIDTH;
    try {
      process.env.CXSTATUSLINE_WIDTH = "100";
      expect(getTerminalWidth({ ttlSeconds: 0 })).toBe(100);
    } finally {
      process.env.CXSTATUSLINE_WIDTH = original;
    }
  });

  it("reports canDetectTerminalWidth based on getTerminalWidth", () => {
    const original = process.env.CXSTATUSLINE_WIDTH;
    try {
      process.env.CXSTATUSLINE_WIDTH = "120";
      expect(canDetectTerminalWidth()).toBe(true);
    } finally {
      process.env.CXSTATUSLINE_WIDTH = original;
    }
  });

  it("caches probed width within TTL and re-probes after TTL expires", () => {
    const origCx = process.env.CXSTATUSLINE_WIDTH;
    const origCc = process.env.CCSTATUSLINE_WIDTH;
    delete process.env.CXSTATUSLINE_WIDTH;
    delete process.env.CCSTATUSLINE_WIDTH;

    try {
      const first = getTerminalWidth({ ttlSeconds: 1 });
      const second = getTerminalWidth({ ttlSeconds: 1 });
      expect(second).toBe(first);

      // Verify that after TTL expiration, probing is called again
      const realNow = Date.now;
      try {
        Date.now = () => realNow() + 2000;
        const third = getTerminalWidth({ ttlSeconds: 1 });
        expect(third).toBe(first);
      } finally {
        Date.now = realNow;
      }
    } finally {
      process.env.CXSTATUSLINE_WIDTH = origCx;
      process.env.CCSTATUSLINE_WIDTH = origCc;
    }
  });
});
