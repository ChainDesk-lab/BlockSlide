# UBI contribution release: review brief

This brief is for the independent reviewer (approval 4, gates S-5 and G-A3 in `docs/SEASON5_RELEASE_READINESS.md`). The release runbook is in [UBI_RELEASE_RUNBOOK.md](UBI_RELEASE_RUNBOOK.md).

**Status (2026-11-19):**
- **Not deployed.** Production still runs Game2048 V6, `0x0322…2249`, with no UBI code, so contributions are **not live**.
- **Review waived for this release.** The product owner waived the independent review on 19 Nov and acknowledged the residual risk in writing.
- **Follow-up review.** This brief now serves the independent review that follows the release; any finding goes into a later upgrade.

## 1. What is under review

**The change.** Every successful paid Shop purchase sends 5% of its price, `floor(price × 500 / 10,000)` G$, from the game contract to GoodDollar's UBIScheme. The transfer happens in the same transaction and emits one `UbiContribution` event. The buyer pays the listed price, unchanged; the treasury keeps the other 95%.

| Item | Value |
|---|---|
| Contract change | PR #78, head `2a6de3dd`. Only `contracts/Game2048.sol` changes: 78 lines added and 10 removed against master. |
| Release branch | `feat/ubi-release-prep`, based on `2a6de3dd`. It adds tests, deployment fixes, reconciliation and release tooling, the subgraph and one frontend guard. It **doesn't change the contract**. |
| Exact target | `review-target-<timestamp>.tar.gz` and `.patch`, with SHA-256 sums in `.sha256`. Use the newest set until the branch is committed (approval 6); after that, use the pushed commit. |
| Build | solc 0.8.28, optimizer 200 runs, EVM `cancun`, Hardhat `--build-profile production` |
| Fingerprints | Creation code keccak `0x963e1671…91d5c4`. Runtime with immutables zeroed keccak `0x42be5f6f…074bd3`. Runtime size 15,425 bytes. |
| Proxy (UUPS) | `0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6`. Owner: `0xcb6f…1838`. |
| Recipient | GoodDollar UBIScheme `0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1`. It's an `immutable` constructor argument. |

The fingerprints are pinned in `scripts/lib/ubiReleasePacket.ts` (`REVIEWED_BUILD`). Any later change to the contract fails `test/ubiReleasePacket.ts` until the change is reviewed and the pin updated.

## 2. Where to look

| Area | Files |
|---|---|
| Contract | `contracts/Game2048.sol`: `_collectPayment`, `ubiContributionFor`, the four `buy*` functions (`nonReentrant`), the constructor, `UbiContribution` and the constants |
| Contract tests | `contracts/Game2048Ubi.t.sol` (26), `Game2048UbiRegression.t.sol` (17: every paid path), `Game2048UbiAccounting.t.sol` (4, including a conservation fuzz) and `Game2048.t.sol` (48) |
| Guards | `test/ubiPurchaseGuard.ts` reads the compiler's AST. It checks that every paid entry point pays through `_collectPayment` and that there's no other token pull, no payable Shop function and no new G$ outflow (refund path). It also checks that the regression matrix covers every `buy*`. |
| Deployment | `ignition/modules/Game2048UbiContributionImpl.ts` deploys the implementation only. `test/ignitionModules.ts` checks that every module passes the recipient and uses the real G$ token. |
| Release tooling (read-only) | `scripts/lib/ubiReleasePacket.ts`, `scripts/checks/verify-ubi-release-packet.ts`, `scripts/lib/ubiReconcile.ts`, `scripts/checks/reconcile-ubi-contributions.ts` |
| Reporting | Subgraph: `subgraph/src/mapping.ts` and `schema.graphql` (receipt-verified totals). Frontend: `frontend/src/lib/ubiContribution.ts` and `ubiProfile.ts`, and `frontend/src/hooks/useShop.ts`. |

## 3. Properties the change must keep

| # | Property | Main evidence |
|---|---|---|
| P1 | A paid purchase never completes without its contribution: a failed transfer reverts the whole purchase | Regression matrix; accounting tests; mutations M1, M7 |
| P2 | The buyer pays exactly the price; the UBIScheme gets `floor(5%)`; the treasury keeps the rest | Matrix; fuzz test; fork rehearsals on all six paths |
| P3 | One `UbiContribution` per purchase, whose fields match the G$ `Transfer` in the same receipt | Matrix; reconciliation tests; mutations M3–M6, M9, M10 |
| P4 | Every current and future paid item contributes; a future item that doesn't fails the suite | AST guard; mutations M8, M11–M15 (all caught) |
| P5 | The rate (500 bps, cap 1,000) and the recipient can't be changed without an upgrade | Constants and an immutable; `test_OwnerCannotRedirectOrChangeTheRate` |
| P6 | A failed or reverted purchase is never reported as a contribution, on-chain or off | Reverts discard logs; the reconciler and the subgraph need both the event and the transfer; the frontend counts only `status: "success"` receipts (`ubiContributionReceipt.test.ts`) |
| P7 | No storage change, so the upgrade and a rollback to V6 are layout-safe | solc `storageLayout`: 25 of 25 variables identical; the fork rollback leaves every slot identical |

## 4. Assumptions to challenge

1. **G$ is GoodDollar's upgradeable SuperGoodDollar (Superfluid).** Its implementation was still `0xb441…29ef` at block 83,137,360. Its ERC-20 `transfer` and `transferFrom` don't call the recipient; only ERC-777 `send` and ERC-677 `transferAndCall` do, and the game uses neither. At block 83,138,012 (`gdollar-fees-and-pause.txt`), `getFees` returned 0 for player to game, game to UBIScheme and game to player, and `paused()` was false. If GoodDollar changes any of this, the gate G-D3 monitoring applies.
2. **UBIScheme takes plain transfers.** Its pool is balance-based (`dailyCyclePool = balance / cycleLength`), so a direct transfer funds UBI. GoodDollar's own GoodCollective factories pay their 500 bps fee to this address. **Written confirmation is pending** (approval 2).
3. **`ReentrancyGuardTransient` (EIP-1153) works on Celo.** The fork rehearsal ran two purchases in separate transactions, so the guard clears between transactions.
4. **Purchases are made only through Game2048.** A Shop item sold through another contract would need its own UBI design: the guards cover Game2048 only.

## 5. Known issues outside this change (pre-existing, unchanged)

- **Milestone-reward reentrancy (G-A2).** `_payMilestoneRewards` sets the claimed bit only after the G$ transfer, and `submitScore` and `startSession` aren't `nonReentrant`. This isn't exploitable with today's G$, because `transfer` makes no recipient call. The code is identical to live V6. The full record, with the impact, why it's acceptable and the checks you must make (R1 to R8), is [MILESTONE_REWARD_REENTRANCY.md](MILESTONE_REWARD_REENTRANCY.md). With the review waived for this release, the contract owner decides approval 3 before release, and your verdict on R1 to R8 comes in the follow-up review.
- **`consumeUndo(player)` has no caller check.** Anyone can burn anyone's Undo credits; it's live today and unchanged here. The fix exists only in the Season 5 package.
- **S-7 design limitations.** Score and tile are self-reported, there's no pause, the owner is a single key (an EOA with an EIP-7702 delegation to an unidentified `0x63c0…E32B`), and owner transfers are unchecked.
- **Gas.** A purchase costs about 142,776 more gas (+59%). For an Undo or a cosmetic, that extra gas is worth more than the G$ contributed.
- **Tiny amounts.** A purchase below 20 wei contributes 0 and emits nothing. Prices are whole G$, and zero prices revert.

## 6. Evidence index

Everything listed here is in `~/blockslide-worktrees/.ubi-release-evidence/`. Ask the owner for the bundle and its checksum.

| Evidence | Result |
|---|---|
| `hardhat-full-suite-final.log` | 134 passing, 0 failing (95 Solidity, 39 Node), production profile |
| `g-e3-mutation-run.log`, `g-e3-mutation-caught-by.txt` | 15 of 15 mutations caught, which tests fail for each, unmutated control 124 of 124 |
| `rehearsal-83121518.*`, `rehearsal-83121792.*` | Mainnet fork, all six paid paths, real G$ and UBIScheme. 352.5 G$ to the UBIScheme across 7 purchases, 0 reconciliation discrepancies. |
| `release-packet-rehearsal.*` | Fork at block 83,137,713. All 11 pre-signing checks pass. The owner's upgrade, one purchase (25 G$ to UBI) and the rollback to V6 all succeed; storage stays identical. |
| `storage-layout-ubi-release.txt` | 25 of 25 variables identical; nothing added or moved |
| `g-t5-historical-scan.*` | 0 `UbiContribution` events in the proxy's history (blocks 69,294,066 to 83,136,959, 3 passes, 15,429 logs). Blockscout also shows 0, and neither the proxy nor its 10 past implementations contains the event. |
| `reconcile-production-season5.json` | Today's gap: 3 paid Season 5 purchases; 152.5 G$ would have been due; 0 sent |
| `subgraph-*.log` | codegen, build, 12 of 12 matchstick tests |
| `frontend-ubi-tests.log`, `frontend-full-suite.log`, `frontend-tsc.log` | 38 of 38 UBI tests, 432 of 432 overall, typecheck clean |
| `merge-check-master-aa81d562.txt` | Merges cleanly into current master (master changed only frontend files); the merged frontend passes 479 of 479 tests |
| `from-s5-internal-review/` | Internal review of the same UBI code, the G-A2 analysis and its experiment, and a README explaining which parts apply here |
| `milestone-reward-history.txt` | 79 `RewardPaid` events (735 G$ to 55 players), no milestone ever paid twice, treasury 45,815 G$ (block 83,138,771) |
| `scripts/` | The read-only check scripts behind the scan, the mutation run, the storage-layout check, the G$ reads and the reward history |

## 7. Questions for the reviewer

1. Is there any path where a paid purchase succeeds without the contribution, or where a contribution is recorded without the transfer?
2. Are floor rounding and the `contribution > 0` skip acceptable?
3. Is there any risk from SuperGoodDollar specifics: `safeTransferFrom` on a SuperToken, the ERC-777 operator model, or a future non-zero fee?
4. Can the transient reentrancy guard interact with UUPS upgrades or delegatecall in any way?
5. On G-A2: do checks R1 to R8 in [MILESTONE_REWARD_REENTRANCY.md](MILESTONE_REWARD_REENTRANCY.md) pass for the released code? Which hardening option do you recommend for the next upgrade?
6. Is an immutable recipient with a constant rate the right trade-off, given that a correction needs an upgrade?
7. Does the release-packet check bind the deployed implementation to the reviewed source? It compares runtime code with immutables zeroed, checks both immutables' values, and simulates the owner's call.
