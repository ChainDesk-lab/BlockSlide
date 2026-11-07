/** The RPC reader behind the reseed dry run's independent check. No network: the node is a fake. */
import { describe, expect, it } from "vitest";
import { compareLogSets, readLogsRange, type GetLogs } from "./rpcLogs";
import type { GapLog } from "./reseed";

const log = (blockNumber: number, logIndex = 0, data = "0x"): GapLog => ({ blockNumber, logIndex, topics: ["0xaa"], data, transactionHash: "0x" + blockNumber });
const CHAIN = [log(10), log(10, 1), log(4_990), log(5_000), log(5_001), log(9_999), log(12_345)];
const inRange = (from: number, to: number) => CHAIN.filter((l) => l.blockNumber >= from && l.blockNumber <= to);
const noSleep = async () => {};

describe("readLogsRange", () => {
  it("reads a range in chunks no wider than the node allows, and returns everything in order", async () => {
    const widths: number[] = [];
    const getLogs: GetLogs = async (from, to) => { widths.push(to - from + 1); return inRange(from, to).map((l) => ({ ...l, transactionHash: l.transactionHash ?? null, data: l.data ?? "0x" })); };
    const r = await readLogsRange({ from: 0, to: 14_999, getLogs, repeats: 1, sleep: noSleep });
    expect(r.logs.map((l) => `${l.blockNumber}:${l.logIndex}`)).toEqual(CHAIN.map((l) => `${l.blockNumber}:${l.logIndex}`));
    expect(Math.max(...widths)).toBeLessThanOrEqual(5_000);
    expect(r.failedChunks).toEqual([]);
  });

  it("a node that sometimes answers 'empty' for a range that has logs is outvoted by the union", async () => {
    let call = 0;
    const getLogs: GetLogs = async (from, to) => {
      call += 1;
      const logs = call % 3 === 1 ? [] : inRange(from, to); // every third read comes back empty
      return logs.map((l) => ({ ...l, transactionHash: l.transactionHash ?? null, data: l.data ?? "0x" }));
    };
    const r = await readLogsRange({ from: 0, to: 14_999, getLogs, repeats: 3, sleep: noSleep, concurrency: 1 });
    expect(r.logs).toHaveLength(CHAIN.length);
    expect(r.disagreeingChunks.length).toBeGreaterThan(0); // and it says so, so a flaky node is visible
  });

  it("a chunk whose every read fails is reported, never silently treated as empty", async () => {
    const getLogs: GetLogs = async (from, to) => {
      if (from === 5_000) throw new Error("node down");
      return inRange(from, to).map((l) => ({ ...l, transactionHash: l.transactionHash ?? null, data: l.data ?? "0x" }));
    };
    const r = await readLogsRange({ from: 0, to: 14_999, getLogs, repeats: 2, sleep: noSleep });
    expect(r.failedChunks).toEqual([{ from: 5_000, to: 9_999 }]);
  });

  it("retries a failing read before giving up on it", async () => {
    let failures = 2;
    const getLogs: GetLogs = async (from, to) => {
      if (failures-- > 0) throw new Error("blip");
      return inRange(from, to).map((l) => ({ ...l, transactionHash: l.transactionHash ?? null, data: l.data ?? "0x" }));
    };
    const r = await readLogsRange({ from: 0, to: 4_999, getLogs, repeats: 1, attempts: 3, sleep: noSleep });
    expect(r.failedChunks).toEqual([]);
    expect(r.logs.length).toBe(inRange(0, 4_999).length);
  });
});

describe("compareLogSets", () => {
  it("identical sets", () => {
    expect(compareLogSets(CHAIN, [...CHAIN].reverse()).identical).toBe(true);
  });
  it("names what is only on one side, and what differs in content", () => {
    const other = [...CHAIN.slice(1), log(77_777), { ...CHAIN[0], data: "0x01" }];
    const r = compareLogSets(CHAIN, other);
    expect(r.identical).toBe(false);
    expect(r.onlyB).toEqual(["77777:0"]);
    expect(r.different).toEqual(["10:0"]);
    expect(r.onlyA).toEqual([]);
  });
});
