import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const PROXY_ADDRESS = "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6";

// V5 upgrade: adds an XP leaderboard player registry so the leaderboard can rank
// the full player base by XP (not just the best-score top 10).
//   - _players / _isPlayer storage (appended at the end — UUPS layout safe)
//   - getPlayerCount() / getPlayersWithXp() / getPlayersWithXpPaged() views
//   - registerPlayers(address[]) — one-time owner backfill for players who
//     earned XP before this registry existed
// Pure storage append + new functions, so no re-initializer is needed.
//
// After deploying, backfill the existing player(s) once, e.g.:
//   game.registerPlayers(["0xcb6f72152DB12546b21ef0dD5F614Ca532531838"])
export default buildModule("Game2048UpgradeV5Module", (m) => {
  const newImpl = m.contract("Game2048");

  const proxy = m.contractAt("Game2048", PROXY_ADDRESS, { id: "Game2048Proxy" });

  m.call(proxy, "upgradeToAndCall", [newImpl, "0x"], {
    after: [newImpl],
  });

  return { newImpl };
});
