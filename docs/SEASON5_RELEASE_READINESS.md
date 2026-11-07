# Season 5 release readiness: approval gates

**Last updated:** 2026-11-07 · **Repository state:** `master` at `e71ca4ed`

This document sets out three separate approval gates. Each feature is approved and released on its own:

1. [Undo contract upgrade](#gate-1-undo-contract-upgrade)
2. [5% UBI contribution on eligible paid Shop purchases](#gate-2-5-ubi-contribution-on-eligible-paid-shop-purchases)
3. [Season 5 XP-to-G$ rewards](#gate-3-season-5-xp-to-g-rewards)

It is a status record, not an approval. **Nothing in it has been approved, deployed, activated or signed.** Writing it changed no contract code, backend behaviour, production configuration or deployment setting.

## How to read this document

**Approval status** for each item:

| Mark | Meaning |
|---|---|
| ☐ Open | No evidence or decision recorded |
| ◐ Partial | Some preparatory evidence exists; the item isn't closed |
| ☑ Done | Closed, with the evidence named in the row |

**Evidence location.** Most of the evidence lives in the Season 5 worktree (`~/blockslide-worktrees/s5`, branch `feat/season5-persistent`, commit `3c4478bf`). That commit and its 111 uncommitted files have **not been pushed**, so the paths below don't resolve on GitHub yet. Freezing that evidence where reviewers can read it is item **S-1** below.

**Reviewers can already open** PR #60 (`feat/undo-at-submit`) and PR #62 (`feat/ubi-contribution`). Each holds one of the two contract changes on its own; neither holds the combined implementation.

| Short name | Location |
|---|---|
| `release-review/` | `docs/release-review/` in the Season 5 worktree (uncommitted) |
| `season5/` | `docs/season5/` in the Season 5 worktree (uncommitted) |
| `evidence/` | `docs/release-review/evidence/` in the Season 5 worktree (uncommitted) |

**Where the code is**

| Change | Where | On `master`? |
|---|---|---|
| Undo deducted at submit (`submitScoreWithUndos`, `consumeUndo` restricted to the player) | `feat/undo-at-submit` (#60, merged into the `feat/undo-step` stack branch, not into `master`) | No |
| 5% UBI contribution (`_collectPayment`, `UbiContribution` event) | `feat/ubi-contribution` (#62, draft, `c903a47e`) | No |
| Both combined into one proposed `Game2048` implementation | `233d8078` and `3c4478bf` (local, not pushed) | No |
| Frontend Undo, switched off by default (`NEXT_PUBLIC_UNDO_ENABLED`, and the contract must report `supportsUndoAtSubmit()`) | `frontend/src/lib/undoAvailability.ts` | Yes |
| Frontend UBI display, showing "Not yet available" until the contract emits contributions | `frontend/src/lib/ubiContribution.ts`, `useUbiContribution.ts` | Yes |
| Season 5 rewards backend, admin, PostgreSQL migrations | `frontend/src/server/season5/`, `frontend/db/` in the Season 5 worktree | No |

## Shared prerequisites

Gates 1 and 2 change the same contract. They are planned as **one implementation and one proxy upgrade**, but each still needs its own approval. If only one is approved, the implementation must be rebuilt and re-reviewed without the other.

| # | Prerequisite | Applies to | Status | Evidence / blocker |
|---|---|---|---|---|
| S-1 | **Freeze the review target.** Commit or tag the proposed contract, tests, subgraph and evidence, or publish a checksummed archive, and record its identifier here | 1, 2, 3 | ☐ Open | `release-review/06-release-blockers.md` G-0 |
| S-2 | **Owner key migration (Phase 1B).** Ownership is a single EOA, `0xcb6f…1838`, delegated through EIP-7702 to `0x63c0c19a…e32b`, and the delegate hasn't been identified. There's no multisig and no timelock; migration to a Safe hasn't been done | 1, 2 (upgrade), 3 (funding) | ☐ Open | `release-review/06-release-blockers.md` T-3; `release-review/02-contract-security-review.md`; the team owns this |
| S-3 | **Upgrade path rehearsal** from that exact owner: signing path and calldata for `upgradeToAndCall(newImpl, "0x")` | 1, 2 | ☐ Open | `release-review/06-release-blockers.md` T-3 |
| S-4 | **Storage layout and bytecode.** 25 variables, 0 mismatches, nothing appended. Runtime 15,807 B; transient storage (`TSTORE`) works on Celo mainnet nodes (simulation only) | 1, 2 | ◐ Partial | `evidence/storage-layout-comparison.txt`, `evidence/production-build.txt`; the live upgrade test is T-2 below |
| S-5 | **Independent external security review** of the proposed `Game2048.sol`, with findings resolved | 1, 2 | ☐ Open | Only the internal package exists (`release-review/02-contract-security-review.md`) |
| S-6 | **Stale Ignition modules excluded.** Seven modules call `Game2048` without its new constructor argument; `Game2048Module` keeps a wrong G$ constant | 1, 2 | ☐ Open | `release-review/04-compatibility-audit.md` §1; `season5/DECISIONS.md` D24 |
| S-7 | **Known design limitations accepted:** self-reported score and tile, no pause, single-key owner, unchecked owner transfers | 1, 2 | ☐ Open | `release-review/06-release-blockers.md` A-2 |

---

## Gate 1: Undo contract upgrade

**What it does.** Undo credits are counted in the browser and deducted in the score-submission transaction the player already signs (`submitScoreWithUndos`), so no extra wallet prompt is needed per undo. `consumeUndo(player)` becomes callable only by the player; today anyone can burn anyone's credits. `supportsUndoAtSubmit()` lets the app detect the new implementation.

**Today.** Undo is off in production: the switch defaults to off and the live contract doesn't report `supportsUndoAtSubmit()`. Credits players already bought stay on-chain, untouched.

### 1.1 Product and economic decisions

| # | Decision | Status | Notes |
|---|---|---|---|
| U-P1 | **Accept a client-declared undo count.** The contract can't check `undosUsed` against gameplay, so a modified client can undo for free. This loses revenue but costs other players nothing | ☐ Open | `release-review/02-contract-security-review.md` §3; same trust model as score and tile |
| U-P2 | **Confirm the Undo price and whether undos affect leaderboard fairness.** The price is the existing on-chain `undoPrice`, unchanged by this release | ☐ Open | `setShopPrices` is unchanged |
| U-P3 | **When to turn on `NEXT_PUBLIC_UNDO_ENABLED` in production.** Only after the upgrade and a real-wallet test | ☐ Open | `release-review/06-release-blockers.md` A-4, O-5 |

### 1.2 Technical dependencies

| # | Dependency | Status |
|---|---|---|
| U-T1 | Frontend submits undos with the score and never calls `consumeUndo` | ☑ Done, on `master` (`useGameSession.ts`; tests in `undoAvailability.test.ts`, `undo.test.ts`, `undoGameplay.test.ts`) |
| U-T2 | The board rewinds the tile generator on undo, so an undo can't re-roll spawns | ☑ Done, on `master` (`lib/undoHistory.ts`) |
| U-T3 | Shared prerequisites S-1 to S-6 | ☐ Open |

### 1.3 Contract review and security audit

| # | Requirement | Status | Evidence |
|---|---|---|---|
| U-A1 | Internal review of Undo credit accounting: deduction, one event per credit, insufficient credits, zero count, no double charge on resubmit, caller-only `consumeUndo` | ◐ Partial (internal only) | `release-review/02-contract-security-review.md` §3; 16 Solidity tests |
| U-A2 | External review (S-5) | ☐ Open | — |

### 1.4 Automated tests and rehearsal

| # | Evidence | Status | Location |
|---|---|---|---|
| U-E1 | Solidity Undo tests (16, from `test_SubmitWithUndos_DeductsCredits` to `test_ConsumeUndo_OnlyByThePlayer`) | ☑ Pass | `release-review/03-test-evidence.md` |
| U-E2 | Full Hardhat suite: 215 passing, 9 failing. All 9 failures predate this change | ◐ Baseline not green | `evidence/hardhat-full-suite.log` |
| U-E3 | Frontend Undo and UBI tests (vitest, 96) | ☑ Pass | `evidence/frontend-ubi-undo-tests.log` |
| U-E4 | **Fork rehearsal of the combined implementation** (`scripts/checks/rehearse-undo-upgrade.ts`): upgrade the proxy on a Celo fork, confirm state is preserved, then buy, use and submit undos | ◐ Partial | It passed for the Undo-only change: fork at block 80,863,256, proxy upgraded as the impersonated owner, state identical before and after (PR #60 description). It **hasn't been run** for the combined Undo + UBI implementation (`release-review/06` T-2), nor at a current block with the exact artifact to deploy |
| U-E5 | Real-wallet test after the upgrade (MetaMask, MiniPay, email wallet): buy credits, undo, submit, check the credits deducted | ☐ Open | Requires the upgrade |

### 1.5 GoodDollar confirmations

Not applicable. Undo doesn't change how G$ is collected; purchases go through the same payment path as the rest of the Shop (Gate 2 covers that path).

### 1.6 Governance and owner approval

| # | Approval | Status |
|---|---|---|
| U-G1 | Product owner approves U-P1 to U-P3 | ☐ Open |
| U-G2 | Release authorisation after S-1 to S-7, U-A2 and U-E4 | ☐ Open |
| U-G3 | Authorised owner signs the upgrade (S-2, S-3) | ☐ Open |

### 1.7 Outstanding blockers

- **The owner key.** S-2 and S-3 are not done.
- **No external review.** S-5 is not done.
- **No fork rehearsal of the combined implementation.** U-E4 is not done.
- **Not frozen for review.** S-1 is not done.

---

## Gate 2: 5% UBI contribution on eligible paid Shop purchases

**What it does.** For every paid purchase of a Streak Shield, XP Boost, Undo Move or Cosmetic, the contract collects the price with `SafeERC20` and sends `floor(amount × 500 / 10,000)` G$ to GoodDollar's UBIScheme in the same transaction. It then emits `UbiContribution(buyer, item, itemId, quantity, amountPaid, contribution, recipient)`.
- **The buyer pays exactly the listed price.** The contribution comes out of it, and the treasury keeps the rest.
- **The rate (500 bps, capped at 1,000) and the recipient are fixed per implementation.** The owner can't change them; changing either means a new implementation.

**Which purchases are eligible.** A purchase is eligible when it is paid and its contribution rounds to more than 0, which means at least 20 wei.
- **A price of 0** disables a product; the purchase reverts.
- **Below 20 wei**, the contribution rounds to 0, so no transfer and no event happen.

### 2.1 Product and economic decisions

| # | Decision | Status | Notes |
|---|---|---|---|
| G-P1 | **Sign-off on the 5% rate, the recipient and the treasury impact** | ☐ Open | Stated as a product requirement in task briefs; no recorded sign-off (`release-review/06` A-1) |
| G-P2 | **Per-player attribution shown publicly:** a "UBI contributed" figure on profiles, and possibly on Stats | ☐ Open | Subgraph and profile card are built in the Season 5 worktree (uncommitted); Stats has no UBI display |

### 2.2 Technical dependencies

| # | Dependency | Status | Evidence / blocker |
|---|---|---|---|
| G-T1 | Shared prerequisites S-1 to S-7 | ☐ Open | — |
| G-T2 | Subgraph version to deploy; `deploy:goldsky` currently targets `blockslide-leaderboard-staging/3.0.0` | ☐ Open | `release-review/06` T-7 |
| G-T3 | Goldsky supports `receipt: true` handlers. Without it, every contribution shows as unverified | ☐ Open | `release-review/06` T-8; `release-review/05` §6 |
| G-T4 | Resync from block 69,294,066, or record the upgrade block | ☐ Open | `release-review/06` T-9 |
| G-T5 | Historical scan confirming zero `UbiContribution` events before the upgrade, run with repeats and the union of results | ☐ Open | `release-review/06` T-10 |
| G-T6 | Set `NEXT_PUBLIC_SUBGRAPH_URL` to the new version as a plain value, never a write-only Secret, then redeploy the frontend | ☐ Open | Production configuration change; needs approval |

### 2.3 Contract review and security audit

| # | Requirement | Status | Evidence |
|---|---|---|---|
| G-A1 | Internal review of `_collectPayment`, rounding, the immutable recipient and `nonReentrant` on the four `buy*` functions | ◐ Partial (internal only) | `release-review/01-release-scope.md` A3–A6, `release-review/02` |
| G-A2 | **Milestone-reentrancy position.** Accept "not exploitable with the current G$", or harden before release | ☐ Open | `release-review/04` §3; `release-review/06` T-6 |
| G-A3 | External review (S-5) | ☐ Open | — |

### 2.4 Automated tests and rehearsal

| # | Evidence | Status | Location |
|---|---|---|---|
| G-E1 | UBI regression matrix: all six paid paths, exactly one event each, exact amounts | ☑ 17 pass | `contracts/Game2048UbiRegression.t.sol`; `evidence/ubi-regression-solidity.log` |
| G-E2 | Purchase coverage guard: every paid ABI function goes through `_collectPayment` | ☑ 5 pass | `test/ubiPurchaseGuard.ts`; `evidence/ubi-coverage-guard.log` |
| G-E3 | Contract mutations detected | ◐ 12/12, not reproduced for this package | `evidence/contract-mutation-run.log` |
| G-E4 | Subgraph (matchstick) | ☑ 12 pass | `evidence/subgraph-tests.log` |
| G-E5 | **Fork rehearsal with real G$ and UBIScheme** (`scripts/checks/rehearse-ubi-contribution.ts`): a purchase on every path, with 5% reaching `0x43d72Ff1…4A1` and a matching G$ `Transfer` | ☐ **Not run** | `release-review/06` T-2 |
| G-E6 | After release: bytecode verified; `ubiRecipient()` and `supportsUndoAtSubmit()` checked; the first real contribution checked on Celoscan, in the subgraph and on the profile card | ☐ Open | `release-review/06` P-1, P-2 |

Contributions must be verified from the purchase receipt's G$ `Transfer` log. UBIScheme balance changes are not reliable evidence, because its Superfluid streams move the balance continuously.

### 2.5 GoodDollar confirmations

| # | Confirmation | Status |
|---|---|---|
| G-D1 | **Written confirmation from GoodDollar** that `0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1` is the right production UBIScheme recipient for third-party contributions, and that a direct G$ transfer is an acceptable route | ☐ Open. The address is sourced from GoodDollar's GoodCollective factories, which pay their protocol fee to it; that source wasn't re-verified for this package (`release-review/05` §5) |
| G-D2 | GoodDollar is aware of the public "UBI contributed" attribution wording | ☐ Open |
| G-D3 | Monitoring for G$ and Identity upgrades and for G$ fee-formula changes. Today the fee is 0; a fee would under-report contributions and changes the reentrancy assumption | ☐ Open (`release-review/06` P-3, P-4) |

### 2.6 Governance and owner approval

| # | Approval | Status |
|---|---|---|
| G-G1 | Product owner and treasury sign-off on G-P1 | ☐ Open |
| G-G2 | Release authorisation after S-1 to S-7, G-A2, G-A3, G-E5 and G-D1 | ☐ Open |
| G-G3 | Authorised owner signs the upgrade (S-2, S-3); the implementation is deployed with `Game2048UbiContributionImpl.ts` (production profile) and its address recorded | ☐ Open (`release-review/06` O-1, O-2) |

### 2.7 Outstanding blockers

- **Economics sign-off.** G-P1 is open.
- **GoodDollar confirmation.** G-D1 is open.
- **No external review**, and the reentrancy decision is open (G-A2, G-A3).
- **No fork rehearsal.** G-E5 has not been run.
- **The owner key.** S-2 and S-3 are not done.
- **Subgraph questions** G-T2 to G-T4 are open.

---

## Gate 3: Season 5 XP-to-G$ rewards

**What it does.**
- **Eligible season XP converts to G$.**
- **Payout path.** Following the project owner's briefs of 30 Oct 2026, rewards are calculated by a server backend, reviewed by hand, and paid directly from a wallet. "No rewards smart contract will custody funds."
- **The earlier contract path is not the Season 5 design.** `BlockSlideRewards.sol` and `scripts/rewards` still exist on the branch.

**Today.** The backend is built and tested in the Season 5 worktree only. Its own launch audit concludes **NOT READY FOR LAUNCH** (`season5/phase6.3-launch-readiness.md`). `SEASON5_CONFIG` is `null` and the admin allowlist is empty, so its routes answer 503.

### 3.1 Economics: proposals, not approved

The figures below are **proposals**. The 30 Oct 2026 brief calls the conversion an "approved conversion specification". However, no governance, treasury or GoodDollar sign-off is recorded for it, so this document treats every figure as **not approved**.

| # | Parameter | Proposed value | Status |
|---|---|---|---|
| X-P1 | Conversion rate | **5,000 eligible season XP = 10 G$** | ☐ Proposed |
| X-P2 | Cap | **50 G$ per wallet per season** (5 conversions). The 30 Oct brief sets it per wallet; the earlier contract-path proposal set it per verified identity | ☐ Proposed |
| X-P3 | Boosted XP | Counts toward eligible XP and the cap (30 Oct brief). This leaves a G$ → boost → XP → G$ loop; no break-even analysis has been done | ☐ Proposed (`season5/DECISIONS.md` D6) |
| X-P4 | Bounty winnings | Kept outside the 50 G$ cap (30 Oct brief) | ☐ Proposed (D16) |
| X-P5 | Season bounty budget | **$30**, hard-coded as 3,000 cents and enforced by the database; no formal approval recorded | ☐ Proposed |

### 3.2 Product decisions still open

| # | Decision | Status | Source |
|---|---|---|---|
| X-D1 | Season XP budget: the most the treasury can lose if manual review misses forged scores | ☐ Open | D8 |
| X-D2 | Leftover XP below one conversion at season end: forfeit or carry over | ☐ Open | D4 |
| X-D3 | Whether manually reviewed but **unverified** XP may be paid. All XP is unverified today, because move-list capture isn't built | ☐ Open; **blocks any payout** | D22 |
| X-D4 | Bounty prize split | ☐ Open | D14 |
| X-D5 | USD-to-G$ price source and the time of pricing | ☐ Open | D15 |
| X-D6 | Exact Season 5 start and end times (UTC) and the matching Celo blocks. The calendar start is 31 Oct 2026; no exact time is set | ☐ Open | `season5/phase6.3-launch-readiness.md` §3 |
| X-D7 | Retention of sessions, nonces, wallet proofs and audit records | ☐ Open | same |
| X-D8 | Funding source and amount for payouts | ☐ Open | — |

### 3.3 Two-distinct-approver rule for superseding stale calculation approvals

**Agreed by the owner on 31 Oct 2026** (`season5/phase6.1-design.md` §0). When a season's calculation approval goes stale, for example because the dataset changed, a replacement calculation may supersede it only under this rule:

1. **Two distinct, currently authorised approvers** holding `reward:review` must each sign. The original approver may be one of the two.
2. **Each signature is fresh and independent**, and bound to:
   - the exact superseding action;
   - the previous approval;
   - the replacement calculation;
   - the report hash.

   Signatures use 10-minute one-time codes within a 24-hour sign-off window.
3. **Superseding is allowed only once the original approval is genuinely stale.**
   - The approval must be the season's current head.
   - The new dataset must have been verified successfully.
   - A later failed verification blocks replacement until the exact new dataset verifies.
4. **The original approval and its audit history stay immutable.** Every replacement is appended to `approval_supersessions`, and `supersedes_id` is unique, so the history is a single line.
5. **Everything is recorded** in the database and the audit trail (`approval.supersede-signed`, `approval.superseded`).
6. **The rule authorises nothing beyond itself:** no provisioning, deployment, activation, transactions or payouts.

**Implementation.**
- **Built:** migration `0007`, `adminApi.ts` routes `calculations/:id/supersede`.
- **Tested** on a disposable database: 75 role tests pass (`season5/phase6.3-launch-readiness.md` §4).
- **Uncommitted**, in the Season 5 worktree.
- **Can't be used in production yet.** It needs at least two `reward:review` holders on the admin allowlist, which is currently empty (X-G2).

### 3.4 Technical dependencies

| # | Dependency | Status | Source |
|---|---|---|---|
| X-T1 | PostgreSQL 15 or later: provider, region, TLS, backups and point-in-time recovery | ☐ Open | `season5/phase6.3-launch-readiness.md` §3 |
| X-T2 | Indexer as a dedicated scheduled worker, separate from Vercel, with its own credentials; hosting and schedule chosen | ☐ Open | owner decision 7 (31 Oct) |
| X-T3 | Full write fencing **before the first payout** | ◐ Partial. Game-write fencing (migration `0008`) is built; mandatory before payout | owner decision 8 |
| X-T4 | Edge rate-limit rules and monitoring with alerting **before public launch** (Vercel firewall, bot protection, log drain); depends on the Vercel plan | ☐ Open | owner decision 9; P6-9 |
| X-T5 | Production-only database variables; never put the indexer, migrator or role-admin credentials in Vercel; previews get no production database | ☐ Open | `season5/phase6.3-launch-readiness.md` V-3, V-4 |
| X-T6 | Move-list capture, for verified rather than unverified XP | ☐ Not built; deferred | D22 |
| X-T7 | Commit the backend on its own branch. It can't go through the mixed Season 5 branch | ☐ Open | S-1 |

### 3.5 Review and security audit

| # | Requirement | Status | Evidence |
|---|---|---|---|
| X-A1 | Internal security remediation: BS-002/003/004/007/009/015 resolved in code; BS-001/005/006/008 partly resolved | ◐ Partial | `season5/security-remediation.md` |
| X-A2 | Independent security review of the backend's payout-authorising paths: approvals, supersession, admin auth, roles | ☐ Open | D19 |
| X-A3 | If the contract path (`BlockSlideRewards.sol`) is ever used instead: external audit before any funding | ☐ Not applicable to the current design | `season5/REWARDS_CONTRACT_REVIEW.md` |

### 3.6 Automated tests and test-environment evidence

| # | Evidence | Status | Location |
|---|---|---|---|
| X-E1 | Season 5 suites: 420 pass. PostgreSQL integration: 44. Migration runner: 11. Roles: 75 | ☑ Pass (disposable test cluster, 31 Oct 2026) | `season5/phase6.3-launch-readiness.md` §4 |
| X-E2 | Full frontend in the Season 5 worktree: 623 pass (two runs), 496 pass and 127 skipped without databases; `tsc` clean; `next build` passes | ☑ Pass | same |
| X-E3 | **Staging rehearsal:** a production-like database and worker, then ingest, calculate, review, approve and supersede with two approvers, and a dry-run payout report | ☐ Not done | — |
| X-E4 | Real-wallet test of wallet-proof sign-in and the public status pages | ☐ Not done | — |

### 3.7 GoodDollar confirmations

| # | Confirmation | Status |
|---|---|---|
| X-D9 | GoodDollar review of the eligibility rules and of how datasets are published (D13, D17) | ☐ Not obtained |
| X-D10 | Whether identity verification (one face, one wallet) is required for eligibility, and how that interacts with the per-wallet cap. This question is raised here; no earlier document records it | ☐ Open |

### 3.8 Governance and owner approval

| # | Approval | Status |
|---|---|---|
| X-G1 | Sign-off on X-P1 to X-P5 and X-D1 to X-D8 | ☐ Open |
| X-G2 | Name the production admin wallets and their capabilities. At least two `reward:review` holders are needed for the two-approver rule | ☐ Open; the allowlist is empty |
| X-G3 | Payout signers and the funding wallet: who signs, from which wallet, separate from the game owner key (S-2) | ☐ Open (D10) |
| X-G4 | Launch authorisation after X-T1 to X-T5, X-A2 and X-E3 | ☐ Open |
| X-G5 | Each payout batch approved separately | ☐ Open |

### 3.9 Outstanding blockers

- **Economics not approved.** X-G1 is open.
- **Unverified XP.** X-D3 must be decided before any payout.
- **No infrastructure.** No database, no indexer worker, no edge protection (X-T1, X-T2, X-T4).
- **No named admins.** The admin allowlist is empty, so the two-approver rule can't be used (X-G2).
- **No independent review** of the backend (X-A2).
- **No staging rehearsal** (X-E3).
- **Not committed.** The backend is uncommitted in the Season 5 worktree (X-T7).

---

## Summary

| Gate | Decisions | Review | Rehearsal | GoodDollar | Owner and governance | Ready? |
|---|---|---|---|---|---|---|
| 1. Undo upgrade | ☐ | ◐ internal only | ◐ Undo alone; combined not run | n/a | ☐ owner key | **No** |
| 2. UBI 5% | ☐ | ◐ internal only | ☐ not run | ☐ | ☐ owner key | **No** |
| 3. XP-to-G$ rewards | ☐ proposals only | ◐ internal only | ☐ no staging | ☐ | ☐ no admins | **No** |
