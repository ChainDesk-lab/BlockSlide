# UBI contribution release: runbook

This runbook is for the release operator, who deploys, and the contract owner, who signs. It covers taking the 5% UBI contribution live, proving it's live, and rolling it back. The review brief is [UBI_RELEASE_REVIEW.md](UBI_RELEASE_REVIEW.md). Every script here is read-only, apart from step 3 (a deployment) and steps 5 and 8 (the owner's signatures).

**Don't announce contributions as live until step 6 passes.**

## 0. Before starting

All of the following must be recorded in the approval tracker:

| # | Approval | Needed for |
|---|---|---|
| 1 | Economics sign-off: 5%, the UBIScheme recipient, 95% to the treasury, the extra gas | Release |
| 2 | GoodDollar's written confirmation of the recipient and the transfer route | Release |
| 3 | G-A2 decision: accept, or harden (see below and [MILESTONE_REWARD_REENTRANCY.md](MILESTONE_REWARD_REENTRANCY.md)) | Release |
| 4 | Independent review: waived for this release by the product owner on 19 Nov; a follow-up review comes after release | Not required for this release |
| 5 | Owner key: a migration, or a recorded acceptance of the single key | Release |
| 6 | Branch committed, pushed and merged, and the reviewed commit hash recorded | Release |
| 7 | Release authorisation and a release window | Release |
| 8 | Subgraph switch | The profile's "UBI contributed" figure only |

**If approval 3 is "harden", or the contract changes for any other reason before release:**
1. Make the change.
2. Get it re-reviewed.
3. Update `REVIEWED_BUILD` in `scripts/lib/ubiReleasePacket.ts`.
4. Run steps 1 and 2 again.

The pin test in `test/ubiReleasePacket.ts` fails until the fingerprints are updated.

## 1. Test the reviewed commit

On a clean checkout of the reviewed commit:

```bash
npm ci
npx hardhat test --build-profile production
```

Expected: **134 passing, 0 failing.** Any other result: stop.

## 2. Rehearse on a fork at the current block

These need an archive RPC: ankr, forno or dRPC serve the needed state, publicnode doesn't. Nothing is broadcast.

```bash
CELO_FORK_URL=https://rpc.ankr.com/celo REHEARSAL_OUT=rehearsal.json \
  npx hardhat run --build-profile production scripts/checks/rehearse-ubi-contribution.ts
CELO_FORK_URL=https://rpc.ankr.com/celo REHEARSAL_OUT=packet-rehearsal.json \
  npx hardhat run --build-profile production scripts/checks/rehearse-ubi-release-packet.ts
```

Expected: `REHEARSAL PASSED` and `RELEASE-PACKET REHEARSAL PASSED`. The second covers the exact upgrade and rollback transactions as the owner sends them.

## 3. Deploy the implementation (no upgrade yet)

The deployer needs a little CELO. It doesn't have to be the owner.

```bash
npx hardhat ignition deploy ./ignition/modules/Game2048UbiContributionImpl.ts \
  --network celo --build-profile production
```

Record the implementation address, the transaction hash and the block.

## 4. Check the deployed implementation, and get the transactions to sign

```bash
IMPL=<implementation address> OUT=release-packet.json \
  npx hardhat run --build-profile production scripts/checks/verify-ubi-release-packet.ts
```

All 11 checks must print `PASS`, followed by `PACKET READY`. The checks cover:
- the reviewed build and fingerprints;
- the immutables, the recipient and the 500/1,000 rate;
- UUPS compatibility;
- that the implementation is uninitialised;
- that the proxy still runs V6;
- the owner's upgrade, in simulation.

**Any `FAIL` means don't sign.** The script prints the signer and the exact upgrade and rollback transactions.

## 5. The owner signs the upgrade

Sign exactly the transaction printed in step 4:

| Field | Value |
|---|---|
| From | The proxy owner, `0xcb6f72152DB12546b21ef0dD5F614Ca532531838`, unless ownership has moved (approval 5) |
| To | `0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6` |
| Value | 0 |
| Data | `upgradeToAndCall(<implementation>, 0x)`, starting `0x4f1ef286` |

Record the transaction hash and its block. That block is **the upgrade block**.

## 6. Prove contributions are live

1. Read the proxy's EIP-1967 implementation slot: it must be the new implementation. Then check that `ubiRecipient()` on the proxy is `0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1`.
2. After the first real paid purchase, run:
   ```bash
   FROM_BLOCK=<upgrade block> npx hardhat run scripts/checks/reconcile-ubi-contributions.ts
   ```
   It must show a verified total equal to the expected total, with no `DISCREPANCY` lines, and exit with code 0.
3. Only then announce that contributions are live. Re-run the same command at any time: it recomputes every contribution from on-chain logs alone.

## 7. Profile figures (approval 8; doesn't block steps 1 to 6)

1. Goldsky confirms that it supports `receipt: true` handlers. Without them, every contribution shows as unverified.
2. Deploy the new subgraph version. `deploy:goldsky` currently targets `blockslide-leaderboard-staging/3.0.0`. It resyncs from block 69,294,066.
3. Check that its UBI totals match step 6.
4. Set `NEXT_PUBLIC_SUBGRAPH_URL` in Vercel as a **plain** variable, never a write-only Secret, then redeploy the frontend.

Until the switch, profiles show the UBI figure as not yet indexed, never as a wrong number.

## 8. Rollback, if needed

The owner signs this transaction. It's known now, and it doesn't depend on the new implementation:

| Field | Value |
|---|---|
| To | `0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6` |
| Value | 0 |
| Data | `0x4f1ef28600000000000000000000000003225350ad18e2d6aa5ea2ce421fc596357c224900000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000` |

This is `upgradeToAndCall(0x03225350AD18e2D6Aa5eA2ce421fC596357c2249, 0x)`, which returns the proxy to V6. The fork rehearsal shows every storage slot identical afterwards, and purchases paying the treasury in full again. Contributions already sent stay with the UBIScheme. The app stops showing UBI amounts, because V6 reports no UBI rate.

## Merging and the frontend

Merging to master deploys the frontend automatically. That's safe before or after the upgrade: the app shows UBI only when the contract reports a UBI rate and recipient, and it counts a contribution only from a successful receipt.
