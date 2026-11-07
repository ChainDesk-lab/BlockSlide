import { describe, expect, it } from "vitest";
import { bounties, getBountyStatus, type Bounty } from "../config/bounties";
import { recurringBounties, scheduleProblems } from "./bountySchedule";

const details = (n: number) => ({
  title: `Weekly Bounty ${n}`,
  description: "d",
  prizes: "set by the team",
  howToParticipate: ["Play"],
  winnerCriteria: "Top 5 verified players by XP earned during the bounty period",
});

describe("recurringBounties", () => {
  it("lays out evenly spaced bounties with the caller's details and stable ids", () => {
    const run = recurringBounties({ idPrefix: "weekly", firstNumber: 4, firstStart: "2026-12-01T11:00:00Z", everyDays: 7, durationDays: 5, count: 3, details });
    expect(run.map((b) => [b.id, b.title, b.startTime, b.endTime])).toEqual([
      ["weekly-4", "Weekly Bounty 4", "2026-12-01T11:00:00Z", "2026-12-06T11:00:00Z"],
      ["weekly-5", "Weekly Bounty 5", "2026-12-08T11:00:00Z", "2026-12-13T11:00:00Z"],
      ["weekly-6", "Weekly Bounty 6", "2026-12-15T11:00:00Z", "2026-12-20T11:00:00Z"],
    ]);
    expect(run.every((b) => b.prizes === "set by the team")).toBe(true);
    expect(scheduleProblems(run)).toEqual([]);
  });

  it("feeds the existing status logic: upcoming, live, then ended", () => {
    const [b] = recurringBounties({ idPrefix: "w", firstStart: "2026-12-01T11:00:00Z", everyDays: 7, durationDays: 7, count: 1, details });
    expect(getBountyStatus(b, new Date("2026-11-30T00:00:00Z"))).toBe("upcoming");
    expect(getBountyStatus(b, new Date("2026-12-03T00:00:00Z"))).toBe("live");
    expect(getBountyStatus(b, new Date("2026-12-09T00:00:00Z"))).toBe("ended");
  });

  it("refuses plans that would overlap or are malformed", () => {
    const base = { idPrefix: "w", firstStart: "2026-12-01T11:00:00Z", everyDays: 7, durationDays: 5, count: 2, details };
    expect(() => recurringBounties({ ...base, durationDays: 8 })).toThrow(/overlap/);
    expect(() => recurringBounties({ ...base, firstStart: "2026-12-01 11:00" })).toThrow(/zone/);
    expect(() => recurringBounties({ ...base, count: 0 })).toThrow(/count/);
    expect(() => recurringBounties({ ...base, count: 1.5 })).toThrow(/whole/);
    expect(() => recurringBounties({ ...base, everyDays: Number.NaN })).toThrow(/everyDays/);
  });
});

describe("scheduleProblems", () => {
  const b = (id: string, startTime: string, endTime: string, extra: Partial<Bounty> = {}): Bounty => ({
    id, startTime, endTime, ...details(1), ...extra,
  });

  it("catches what would break the bounty page", () => {
    expect(scheduleProblems([
      b("a", "2026-12-01T00:00:00Z", "2026-12-05T00:00:00Z"),
      b("a", "2026-12-06T00:00:00Z", "2026-12-07T00:00:00Z"),
    ])).toEqual(["duplicate id a"]);
    expect(scheduleProblems([b("x", "2026-12-05T00:00:00Z", "2026-12-01T00:00:00Z")])).toEqual(["x: ends before it starts"]);
    expect(scheduleProblems([b("x", "Dec 1", "2026-12-02T00:00:00Z")])).toEqual(["x: startTime isn't an ISO time with a zone"]);
    expect(scheduleProblems([b("x", "2026-12-01T00:00:00", "2026-12-02T00:00:00Z")])).toEqual(["x: startTime isn't an ISO time with a zone"]);
    expect(scheduleProblems([b("x", "2026-12-01T00:00:00Z", "2026-12-02T00:00:00Z", { prizes: " " })])).toEqual(["x: prizes is empty"]);
    expect(scheduleProblems([
      b("a", "2026-12-01T00:00:00Z", "2026-12-05T00:00:00Z"),
      b("b", "2026-12-04T00:00:00Z", "2026-12-08T00:00:00Z"),
    ])).toEqual(["b overlaps a"]);
    expect(scheduleProblems([
      b("late", "2026-12-10T00:00:00Z", "2026-12-12T00:00:00Z"),
      b("early", "2026-12-01T00:00:00Z", "2026-12-02T00:00:00Z"),
    ])).toEqual(["early is listed after late but starts earlier"]);
  });

  it("the live schedule in src/config/bounties.ts is sound", () => {
    expect(scheduleProblems(bounties)).toEqual([]);
  });
});
