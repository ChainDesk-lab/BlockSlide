/**
 * The persisted aggregate and the pure functions that grow and read it.
 *
 * The state is designed so a refresh only ever scans blocks ABOVE the
 * checkpoint. Applying a log is therefore idempotent-by-construction: a block
 * is never visited twice, so counters cannot double-count.
 */
import {
  ADDRESS_TOPIC, BASE_WEEK, GENESIS_BLOCK, PLAYER_EVENT_NAMES,
  TOPIC_TO_EVENT, blockToUnix, weekIndexOf, weekIndexToISO,
} from "./config";

export const STATE_VERSION = 1;

/** [firstBlock, lastBlock, eventCount, gamesCompleted, eventMask, weekBitmapHex] */
export type AddrRow = [number, number, number, number, number, string];

export interface StatsState {
  version: number;
  genesisBlock: number;
  /** Last block scanned, inclusive. */
  checkpointBlock: number;
  updatedAt: string;
  totalLogs: number;
  eventCounts: Record<string, number>;
  addrs: Record<string, AddrRow>;
  /** YYYY-MM-DD (UTC) -> event count */
  dailyEvents: Record<string, number>;
  /** Total G$ paid to players, in wei, as a decimal string (JSON has no BigInt). */
  rewardPaidWei: string;
}

export function emptyState(): StatsState {
  return {
    version: STATE_VERSION,
    genesisBlock: GENESIS_BLOCK,
    checkpointBlock: GENESIS_BLOCK - 1,
    updatedAt: new Date(0).toISOString(),
    totalLogs: 0,
    eventCounts: {},
    addrs: {},
    dailyEvents: {},
    rewardPaidWei: "0",
  };
}

function setBit(hex: string, bit: number): string {
  if (bit < 0) return hex;
  const next = (BigInt("0x" + (hex || "0")) | (1n << BigInt(bit))).toString(16);
  return next;
}
function hasBit(hex: string, bit: number): boolean {
  if (bit < 0) return false;
  return ((BigInt("0x" + (hex || "0")) >> BigInt(bit)) & 1n) === 1n;
}

export interface RawLog { blockNumber: number; topics: string[]; data?: string }

/**
 * Fold new logs into the state. Caller guarantees every log sits above
 * state.checkpointBlock; it then advances the checkpoint.
 */
export function applyLogs(state: StatsState, logs: RawLog[], newCheckpoint: number): StatsState {
  for (const log of logs) {
    const meta = TOPIC_TO_EVENT[log.topics?.[0] ?? ""];
    state.totalLogs += 1;

    const unix = blockToUnix(log.blockNumber);
    const day = new Date(unix * 1000).toISOString().slice(0, 10);
    state.dailyEvents[day] = (state.dailyEvents[day] ?? 0) + 1;

    if (!meta) continue; // non-player event: counted in totalLogs, never as a wallet
    state.eventCounts[meta.name] = (state.eventCounts[meta.name] ?? 0) + 1;

    const t1 = log.topics?.[1];
    if (!t1 || !ADDRESS_TOPIC.test(t1)) continue;
    const addr = ("0x" + t1.slice(26)).toLowerCase();
    const week = weekIndexOf(unix) - BASE_WEEK;

    if (meta.name === "RewardPaid" && log.data && log.data.length >= 2 + 128) {
      // data words: [0] milestone, [1] amount
      const amount = BigInt("0x" + log.data.slice(2 + 64, 2 + 128));
      state.rewardPaidWei = (BigInt(state.rewardPaidWei || "0") + amount).toString();
    }

    const isGame = meta.name === "ScoreSubmitted";
    const row = state.addrs[addr];
    if (!row) {
      state.addrs[addr] = [log.blockNumber, log.blockNumber, 1, isGame ? 1 : 0, 1 << meta.bit, setBit("0", week)];
    } else {
      if (log.blockNumber < row[0]) row[0] = log.blockNumber;
      if (log.blockNumber > row[1]) row[1] = log.blockNumber;
      row[2] += 1;
      if (isGame) row[3] += 1;
      row[4] |= 1 << meta.bit;
      row[5] = setBit(row[5], week);
    }
  }
  state.checkpointBlock = newCheckpoint;
  state.updatedAt = new Date().toISOString();
  return state;
}

export interface WeekPoint { week: string; newWallets: number; activeWallets: number; events: number; cumulative: number; perWallet: number }
export interface FunnelStage { label: string; count: number; share: number }

export interface StatsSnapshot {
  updatedAt: string;
  checkpointBlock: number;
  genesisBlock: number;
  firstBlockTime: string;
  spanDays: number;
  playerWallets: number;
  totals: { logs: number; sessionsStarted: number; gamesCompleted: number; usernamesSet: number; rewardsPaid: number };
  funnel: FunnelStage[];
  weekly: WeekPoint[];
  daily: Array<{ day: string; events: number }>;
  recent: { events24h: number; events7d: number; events30d: number; active7d: number; active30d: number; new7d: number; new30d: number };
  retention: { oneEventOnly: number; multiWeek: number; span7d: number; span30d: number };
  engagement: Array<{ bucket: string; wallets: number }>;
  medianGames: number;
  totalGames: number;
  gDollarPaid: number;
}

const distinctFor = (state: StatsState, name: string): number => {
  const bit = PLAYER_EVENT_NAMES.indexOf(name);
  if (bit < 0) return 0;
  let n = 0;
  for (const row of Object.values(state.addrs)) if (row[4] & (1 << bit)) n += 1;
  return n;
};

export function derive(state: StatsState): StatsSnapshot {
  const rows = Object.values(state.addrs);
  const playerWallets = rows.length;

  const usernames = distinctFor(state, "UsernameSet");
  const sessions = distinctFor(state, "SessionStarted");
  const games = distinctFor(state, "ScoreSubmitted");
  const rewarded = distinctFor(state, "RewardPaid");

  const share = (n: number) => (playerWallets ? n / playerWallets : 0);
  const funnel: FunnelStage[] = [
    { label: "Player wallets", count: playerWallets, share: 1 },
    { label: "Set a username", count: usernames, share: share(usernames) },
    { label: "Started a session", count: sessions, share: share(sessions) },
    { label: "Completed a game", count: games, share: share(games) },
    { label: "Earned a G$ reward", count: rewarded, share: share(rewarded) },
  ];

  // Weekly series. Week bits are relative to the genesis week.
  const maxWeek = rows.reduce((m, r) => {
    const hex = BigInt("0x" + (r[5] || "0"));
    return Math.max(m, hex === 0n ? 0 : hex.toString(2).length - 1);
  }, 0);
  const newByWeek = new Array(maxWeek + 1).fill(0);
  const activeByWeek = new Array(maxWeek + 1).fill(0);
  for (const r of rows) {
    const fw = weekIndexOf(blockToUnix(r[0])) - BASE_WEEK;
    if (fw >= 0 && fw <= maxWeek) newByWeek[fw] += 1;
    for (let w = 0; w <= maxWeek; w++) if (hasBit(r[5], w)) activeByWeek[w] += 1;
  }
  const eventsByWeek = new Array(maxWeek + 1).fill(0);
  for (const [day, n] of Object.entries(state.dailyEvents)) {
    const w = weekIndexOf(Date.parse(day + "T00:00:00Z") / 1000) - BASE_WEEK;
    if (w >= 0 && w <= maxWeek) eventsByWeek[w] += n;
  }
  let cumulative = 0;
  const weekly: WeekPoint[] = [];
  for (let w = 0; w <= maxWeek; w++) {
    cumulative += newByWeek[w];
    weekly.push({
      week: weekIndexToISO(BASE_WEEK + w),
      newWallets: newByWeek[w],
      activeWallets: activeByWeek[w],
      events: eventsByWeek[w],
      cumulative,
      perWallet: activeByWeek[w] ? +(eventsByWeek[w] / activeByWeek[w]).toFixed(1) : 0,
    });
  }

  // The genesis week can precede the first player event (the contract was
  // deployed mid-week), which would render as an empty leading bar.
  while (weekly.length > 1 && weekly[0].newWallets === 0 && weekly[0].activeWallets === 0 && weekly[0].events === 0) {
    weekly.shift();
  }

  const daily = Object.entries(state.dailyEvents)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, events]) => ({ day, events }));

  const head = state.checkpointBlock;
  const since = (days: number) => head - days * 86_400;
  const sumDays = (days: number) => {
    const cutoff = new Date((blockToUnix(head) - days * 86_400) * 1000).toISOString().slice(0, 10);
    return daily.filter((d) => d.day >= cutoff).reduce((s, d) => s + d.events, 0);
  };
  const recent = {
    events24h: sumDays(1),
    events7d: sumDays(7),
    events30d: sumDays(30),
    active7d: rows.filter((r) => r[1] >= since(7)).length,
    active30d: rows.filter((r) => r[1] >= since(30)).length,
    new7d: rows.filter((r) => r[0] >= since(7)).length,
    new30d: rows.filter((r) => r[0] >= since(30)).length,
  };

  const retention = {
    oneEventOnly: rows.filter((r) => r[2] === 1).length,
    multiWeek: rows.filter((r) => {
      const hex = BigInt("0x" + (r[5] || "0"));
      let bits = 0, v = hex;
      while (v > 0n) { bits += Number(v & 1n); v >>= 1n; }
      return bits > 1;
    }).length,
    span7d: rows.filter((r) => r[1] - r[0] > 7 * 86_400).length,
    span30d: rows.filter((r) => r[1] - r[0] > 30 * 86_400).length,
  };

  // Distribution over GAMES COMPLETED, across the wallets that finished at least
  // one. Wallets that never completed a game are excluded, not shown as a zero
  // bucket, so the bars describe players rather than registrations.
  const buckets = [
    { bucket: "1 game", test: (n: number) => n === 1 },
    { bucket: "2-5", test: (n: number) => n >= 2 && n <= 5 },
    { bucket: "6-20", test: (n: number) => n >= 6 && n <= 20 },
    { bucket: "21-100", test: (n: number) => n >= 21 && n <= 100 },
    { bucket: "100+", test: (n: number) => n > 100 },
  ];
  const engagement = buckets.map((b) => ({ bucket: b.bucket, wallets: rows.filter((r) => b.test(r[3])).length }));

  const played = rows.map((r) => r[3]).filter((n) => n > 0).sort((a, b) => a - b);
  const medianGames = played.length ? played[Math.floor(played.length / 2)] : 0;
  const totalGames = rows.reduce((s, r) => s + r[3], 0);

  const firstUnix = blockToUnix(state.genesisBlock);
  return {
    updatedAt: state.updatedAt,
    checkpointBlock: state.checkpointBlock,
    genesisBlock: state.genesisBlock,
    firstBlockTime: new Date(firstUnix * 1000).toISOString(),
    spanDays: +((blockToUnix(head) - firstUnix) / 86_400).toFixed(1),
    playerWallets,
    totals: {
      logs: state.totalLogs,
      sessionsStarted: state.eventCounts.SessionStarted ?? 0,
      gamesCompleted: state.eventCounts.ScoreSubmitted ?? 0,
      usernamesSet: state.eventCounts.UsernameSet ?? 0,
      rewardsPaid: state.eventCounts.RewardPaid ?? 0,
    },
    funnel, weekly, daily, recent, retention, engagement, medianGames, totalGames,
    gDollarPaid: Number(BigInt(state.rewardPaidWei || "0") / 10n ** 16n) / 100,
  };
}
