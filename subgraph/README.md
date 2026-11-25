# BlockSlide Leaderboard Subgraph

Indexes `Game2048` events on Celo into an XP leaderboard, served via **Goldsky**.
No contract changes — it reads events only.

- Proxy: `0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6`
- startBlock: `69294066`

## What it indexes
| Event | → Player field |
|---|---|
| `XpEarned(player, amount, total)` | `xp` (cumulative — uses `total`) |
| `UsernameSet(player, name)` | `username` |
| `ScoreSubmitted(player, score, highestTile)` | `bestScore`, `gamesPlayed` |
| `UbiContribution(buyer, item, itemId, quantity, amountPaid, contribution, recipient)` | one immutable `UbiContribution` (id `txHash-logIndex`); `totalUbiContributed`, `ubiContributionCount`, or `totalUbiUnverified`, `ubiUnverifiedCount` |

### UBI contributions: how they're verified
Each `UbiContribution` is checked against the same transaction's receipt
(`receipt: true`): it counts toward `totalUbiContributed` only if there is a
G$ `Transfer` log from the game contract to the event's `recipient` for exactly
`contribution`, earlier in the transaction. Otherwise it is stored with
`transferVerified: false` and counted in `totalUbiUnverified`, never in the total.
An event already stored (same id) is ignored, so it can't be counted twice.

Limits:
- The G$ address is a constant in `src/mapping.ts`. The contract's token is
  owner-settable (`setTokens`); if it changes, update the constant or new
  contributions stop verifying.
- The check proves the transfer was in the receipt. It doesn't prove the
  recipient is GoodDollar's UBIScheme: `recipient` is the implementation's
  immutable `ubiRecipient`, set at deploy and reviewed then.
- If the indexer's provider doesn't supply receipts, every contribution lands in
  `totalUbiUnverified` (visible, never silently zero).
- Only purchases after the UBI upgrade emit the event. Earlier purchases made no
  contribution, and none is reconstructed or estimated.

## Build
```bash
cd subgraph
npm install
npm run codegen
npm run build
npm test        # matchstick unit tests (downloads the matchstick binary on first run)
```

## Deploy to Goldsky
```bash
# 1. Install the Goldsky CLI
#    macOS / Linux:
curl https://goldsky.com | sh
#    Windows:  npm install -g @goldskycom/cli
#    Then open a NEW terminal (or source your shell profile) so `goldsky` is on PATH.

# 2. Log in — this is INTERACTIVE; run it then paste your API key when prompted
goldsky login

# 3. Build + deploy (from the subgraph/ directory)
npm run build
goldsky subgraph deploy blockslide-leaderboard/1.0.0 --path .
```
Goldsky prints a GraphQL **query URL**. Put it in the frontend env (local and Vercel):
```
NEXT_PUBLIC_SUBGRAPH_URL=https://api.goldsky.com/api/public/<project>/subgraphs/blockslide-leaderboard/1.0.0/gn
```

## Query the frontend uses
```graphql
{
  players(first: 10, orderBy: xp, orderDirection: desc, where: { xp_gt: "0" }) {
    id
    xp
    username
  }
}
```
