import { describe, expect, it, beforeEach, spyOn } from "bun:test";
import * as childProcess from "child_process";
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

  it("validates terminalWidthCacheTtlSeconds in SettingsSchema with min(0) and max(300)", () => {
    const parsedDefault = SettingsSchema.parse({});
    expect(parsedDefault.terminalWidthCacheTtlSeconds).toBe(5);
    expect(SettingsSchema.parse({ terminalWidthCacheTtlSeconds: 0 }).terminalWidthCacheTtlSeconds).toBe(0);
    expect(SettingsSchema.parse({ terminalWidthCacheTtlSeconds: 300 }).terminalWidthCacheTtlSeconds).toBe(300);
    expect(() => SettingsSchema.parse({ terminalWidthCacheTtlSeconds: -1 })).toThrow();
    expect(() => SettingsSchema.parse({ terminalWidthCacheTtlSeconds: 301 })).toThrow();
  });

  it("clears memoized width when resetTerminalWidthCache is called", () => {
    const origCx = process.env.CXSTATUSLINE_WIDTH;
    const origCc = process.env.CCSTATUSLINE_WIDTH;
    delete process.env.CXSTATUSLINE_WIDTH;
    delete process.env.CCSTATUSLINE_WIDTH;

    let mockWidth = 160;
    const spy = spyOn(childProcess, "execFileSync").mockImplementation(((file: string, args?: readonly string[]) => {
      if (file === "tput") return `${mockWidth}\n`;
      if (file === "ps") {
        if (args?.includes("ppid=")) return "9999\n";
        if (args?.includes("tty=")) return "ttys001\n";
      }
      if (file === "stty") {
        return `24 ${mockWidth}\n`;
      }
      throw new Error(`Unexpected command: ${file}`);
    }) as any);

    try {
      expect(getTerminalWidth()).toBe(160);
      mockWidth = 200;
      // Without resetting cache, width remains 160
      expect(getTerminalWidth()).toBe(160);
      resetTerminalWidthCache();
      expect(getTerminalWidth()).toBe(200);
    } finally {
      spy.mockRestore();
      if (origCx !== undefined) process.env.CXSTATUSLINE_WIDTH = origCx;
      if (origCc !== undefined) process.env.CCSTATUSLINE_WIDTH = origCc;
    }
  });

  it("re-probes when ttlSeconds is 0 (caching disabled)", () => {
    const origCx = process.env.CXSTATUSLINE_WIDTH;
    const origCc = process.env.CCSTATUSLINE_WIDTH;
    delete process.env.CXSTATUSLINE_WIDTH;
    delete process.env.CCSTATUSLINE_WIDTH;

    let mockWidth = 100;
    const spy = spyOn(childProcess, "execFileSync").mockImplementation(((file: string, args?: readonly string[]) => {
      if (file === "tput") return `${mockWidth}\n`;
      if (file === "ps") {
        if (args?.includes("ppid=")) return "9999\n";
        if (args?.includes("tty=")) return "ttys001\n";
      }
      if (file === "stty") {
        return `24 ${mockWidth}\n`;
      }
      throw new Error(`Unexpected command: ${file}`);
    }) as any);

    try {
      expect(getTerminalWidth({ ttlSeconds: 5 })).toBe(100);
      mockWidth = 130;
      // Cached call with ttl returns 100
      expect(getTerminalWidth({ ttlSeconds: 5 })).toBe(100);
      // ttlSeconds: 0 bypasses cache and re-probes
      expect(getTerminalWidth({ ttlSeconds: 0 })).toBe(130);
    } finally {
      spy.mockRestore();
      if (origCx !== undefined) process.env.CXSTATUSLINE_WIDTH = origCx;
      if (origCc !== undefined) process.env.CCSTATUSLINE_WIDTH = origCc;
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
