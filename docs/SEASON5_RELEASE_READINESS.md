# Season 5 release readiness: approval gates

**Last updated:** 2026-11-21, Gate 2 release status and summary row, for the UBI-only release on `feat/ubi-release-prep` · **Previous update:** 2026-11-19

> **2026-11-18: Gate 2 is being released on its own.** Management made the 5% UBI contribution the immediate priority. The release candidate is the UBI-only implementation: PR #78 (`2a6de3dd`) plus the branch `feat/ubi-release-prep` (commit `c6f90061`, draft PR #87), which doesn't change the contract. It isn't the combined Undo and UBI implementation described below.
> - **Gate 2 rows** now show that package's status.
> - **Its evidence** is in `~/blockslide-worktrees/.ubi-release-evidence/`, with a checksummed archive.
> - **Its review brief and runbook** are `docs/release-review/UBI_RELEASE_REVIEW.md` and `UBI_RELEASE_RUNBOOK.md`.
>
> Gates 1 and 3 are unchanged.
>
> **2026-11-19: independent review waived for this release.** The product owner waived it in writing (S-5 and G-A3) for this release only and acknowledged the residual risk, including the milestone-reward reentrancy. A follow-up independent review comes after release, and its findings go into a later upgrade. The approval tracker holds the decision record.
>
> **2026-11-19: internal security assessment recorded.** It found no CRITICAL or HIGH issue and no known vulnerability introduced by the UBI change. Its five findings (two MEDIUM, three LOW) all pre-date the UBI work and are unchanged by it; the register is in [§2.3](#23-contract-review-and-security-audit). It's an internal assessment, not the waived independent review, and it ran no new tests or fuzzing.

This document sets out three separate approval gates. Each feature is approved and released on its own:

1. [Undo contract upgrade](#gate-1-undo-contract-upgrade)
2. [5% UBI contribution on eligible paid Shop purchases](#gate-2-5-ubi-contribution-on-eligible-paid-shop-purchases)
3. [Season 5 XP-to-G$ rewards](#gate-3-season-5-xp-to-g-rewards)

It is a status record, not an approval. **No gate has been approved for release, and nothing in it has been deployed, activated or signed.** Writing it changed no contract code, backend behaviour, production configuration or deployment setting.

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
| S-1 | **Freeze the review target.** Commit or tag the proposed contract, tests, subgraph and evidence, or publish a checksummed archive, and record its identifier here | 1, 2, 3 | ☑ Done for Gate 2 | Commit `c6f90061` on `feat/ubi-release-prep` (draft PR #87). Its tree is identical to the frozen archive `review-target-20261118-231304`, and its build fingerprints are pinned in `scripts/lib/ubiReleasePacket.ts`. |
| S-2 | **Owner key migration (Phase 1B).** Ownership is a single EOA, `0xcb6f…1838`, delegated through EIP-7702 to `0x63c0c19a…e32b`, which Blockscout lists as the verified contract `EIP7702StatelessDeleGator`; whether anyone else can act through that delegation is unknown. There's no multisig and no timelock; migration to a Safe hasn't been done. The 19 Nov assessment records this as **M-1** (MEDIUM, pre-existing; see §2.3) | 1, 2 (upgrade), 3 (funding) | ☐ Open. For Gate 2, owner-key acceptance (approval 5) stays outstanding until the key-holder confirmations exist | `release-review/06-release-blockers.md` T-3; `release-review/02-contract-security-review.md`; assessment M-1; the team owns this |
| S-3 | **Upgrade path rehearsal** from that exact owner: signing path and calldata for `upgradeToAndCall(newImpl, "0x")` | 1, 2 | ◐ Partial for Gate 2 | Calldata and pre-signing checks are ready (`scripts/checks/verify-ubi-release-packet.ts`). On a fork at block 83,137,713, the owner's exact upgrade and rollback transactions passed (`release-packet-rehearsal.*`). Still open: the owner's own wallet and signing path (S-2). |
| S-4 | **Storage layout and bytecode.** 25 variables, 0 mismatches, nothing appended. Runtime 15,807 B; transient storage (`TSTORE`) works on Celo mainnet nodes (simulation only) | 1, 2 | ☑ Done for Gate 2 | UBI-only package: 25 of 25 variables identical (`storage-layout-ubi-release.txt`). Runtime 15,425 B. Transient storage works on Celo forks (three rehearsals). Upgrade and rollback leave every slot identical. |
| S-5 | **Independent external security review** of the proposed `Game2048.sol`, with findings resolved | 1, 2 | Gate 2: waived for this release (19 Nov). Gate 1: ☐ Open | Gate 2: the product owner's written waiver of 19 Nov 2026 acknowledges the residual risk. A follow-up independent review comes after release and is committed for the GoodBuilders seasonal audit; its findings go into a later upgrade. The 19 Nov internal assessment (§2.3) doesn't replace it. Gate 1: only the internal package exists (`release-review/02-contract-security-review.md`) |
| S-6 | **Stale Ignition modules excluded.** Seven modules call `Game2048` without its new constructor argument; `Game2048Module` keeps a wrong G$ constant | 1, 2 | ☑ Done on `feat/ubi-release-prep` | The legacy upgrade modules are removed, and `Game2048.ts` now uses the real G$ and passes the recipient. `test/ignitionModules.ts` guards both. |
| S-7 | **Known design limitations accepted:** self-reported score and tile, no pause, single-key owner, unchecked owner transfers | 1, 2 | ◐ Partial for Gate 2 | Self-reported score, tile and XP: accepted as a product limitation on 19 Nov (**M-2**). It's not a UBI vulnerability and not part of the economics sign-off (G-P1). Single-key owner: S-2 (**M-1**). One-step owner transfers: a LOW follow-up (**L-3**). No pause, and one-step transfers for this release: acceptance not yet recorded (the approval tracker places it with approval 1). `release-review/06-release-blockers.md` A-2 |

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
| G-P1 | **Sign-off on the 5% rate, the recipient and the treasury impact** | ◐ Partial | Management direction, 2026-11-18: the 5% contribution on every successful eligible paid Shop purchase is the immediate engineering priority. A formal sign-off covering the recipient, the treasury impact and the extra gas isn't recorded yet (`release-review/06` A-1). |
| G-P2 | **Per-player attribution shown publicly:** a "UBI contributed" figure on profiles, and possibly on Stats | ◐ Partial | The subgraph is ported to `feat/ubi-release-prep` (12 of 12 tests), and the profile card is on `master`. It shows only receipt-verified totals. Stats has no UBI display. The public wording needs G-D2. |

### 2.2 Technical dependencies

| # | Dependency | Status | Evidence / blocker |
|---|---|---|---|
| G-T1 | Shared prerequisites S-1 to S-7 | ☐ Open | — |
| G-T2 | Subgraph version to deploy; `deploy:goldsky` currently targets `blockslide-leaderboard-staging/3.0.0` | ☐ Open | `release-review/06` T-7 |
| G-T3 | Goldsky supports `receipt: true` handlers. Without it, every contribution shows as unverified | ☐ Open | `release-review/06` T-8; `release-review/05` §6 |
| G-T4 | Resync from block 69,294,066, or record the upgrade block | ◐ Partial | `subgraph.yaml` sets `startBlock: 69294066`, so the new version resyncs fully. The upgrade block is recorded at release (runbook step 5). |
| G-T5 | Historical scan confirming zero `UbiContribution` events before the upgrade, run with repeats and the union of results | ☑ Done | `g-t5-historical-scan.*`, 2026-11-18. Blocks 69,294,066 to 83,136,959 were read in 3 passes, which agreed on 15,429 logs and 0 `UbiContribution`. Blockscout also shows 0, and the event's topic is absent from the proxy and all 10 implementations it has used. |
| G-T6 | Set `NEXT_PUBLIC_SUBGRAPH_URL` to the new version as a plain value, never a write-only Secret, then redeploy the frontend | ☐ Open | Production configuration change; needs approval |

### 2.3 Contract review and security audit

| # | Requirement | Status | Evidence |
|---|---|---|---|
| G-A1 | Internal review of `_collectPayment`, rounding, the immutable recipient and `nonReentrant` on the four `buy*` functions | ◐ Partial (internal only) | `release-review/01-release-scope.md` A3–A6, `release-review/02` |
| G-A2 | **Milestone-reentrancy position.** Accept "not exploitable with the current G$", or harden before release | ☐ Open: the contract owner's decision. With the review waived, R1 to R8 move to the follow-up review. Accepting needs a named G$ monitoring owner (G-D3) | Risk record: `docs/release-review/MILESTONE_REWARD_REENTRANCY.md` (impact, why acceptable, reviewer checks). Facts checked 2026-11-18: the code is identical to live V6 and unchanged here. The G$ implementation is unchanged. 79 rewards have been paid, with no milestone paid twice. The treasury ceiling is 45,815 G$. 19 Nov assessment: **L-1**, LOW and theoretical. G$ `transfer` and `transferFrom` were verified from the SuperGoodDollar source to make no recipient call. |
| G-A3 | External review (S-5) | Waived for this release (19 Nov) | Follow-up independent review after release, committed for the GoodBuilders seasonal audit; findings go into a later upgrade |
| G-A4 | Internal security assessment of the current contract and the UBI upgrade | ☑ Done, 19 Nov (internal; not the independent review) | The register below; `security-assessment-20261119/ASSESSMENT.md` in the evidence folder |

**Security risk register (19 Nov 2026 assessment).** There's no CRITICAL or HIGH finding.
- **Introduced by the UBI change:** no known vulnerability. The payment path (`_collectPayment` and the four `buy*` functions) was checked for the amount, coverage, recipient, reentrancy, failure handling and false records.
- **Pre-existing:** all five findings below. They're in the live V6 contract or the app on `master` today, and the UBI release doesn't change them.

| ID | Finding | Severity | Status (19 Nov) | Blocks the UBI release |
|---|---|---|---|---|
| M-1 | One owner key controls upgrades, `setTokens` (it can swap the payment token or the identity contract without an upgrade), Shop prices and the treasury. The app approves `maxUint256`, so through an upgrade the key can also reach the whole G$ balance of every wallet with an unlimited approval. At block 83,145,069 (19 Nov) only the owner's own wallet had a funded unlimited approval (417,421 G$); the treasury held 45,815 G$ at block 83,138,771 | MEDIUM | Open. Owner-key acceptance (S-2, approval 5) stays outstanding until the key-holder confirmations exist. On release day, check that `gDollar()` and `identity()` are unchanged; the pre-signing checks don't cover them | Not by itself; the release waits on approval 5 |
| M-2 | Scores, tiles and XP are self-reported. Any verified address can claim all four milestone rewards (160 G$) without playing, and any address can post any score or XP | MEDIUM | Accepted as a product limitation, 19 Nov (S-7). Not a UBI vulnerability, and not part of the economics sign-off | No |
| L-1 | Milestone-reward reentrancy (G-A2): the claimed bit is set after the G$ transfer | LOW, theoretical | Not exploitable with current G$ behaviour. The contract owner's decision (G-A2) is open, and a named G$ monitoring owner (G-D3) is required. The review waiver stands | Not by itself; the release waits on G-A2 and a named G-D3 owner |
| L-2 | `consumeUndo(player)` has no caller check, so anyone can burn anyone's Undo credits | LOW | Follow-up: restrict it to the player in a later upgrade (PR #60 does, not yet on `master`). The app neither sells nor calls Undo | No |
| L-3 | Ownership can be renounced or transferred in one step | LOW | Follow-up: a two-step transfer or a multisig, with S-2 | No |

**Source and limits of the assessment**
- **Full assessment:** `~/blockslide-worktrees/.ubi-release-evidence/security-assessment-20261119/ASSESSMENT.md` (SHA-256 `0c0e34fabcad14dae069cb249dac561432eb115b009fc52565aa0174cb94fc76`) and `allowance-exposure.json` (SHA-256 `041cf7a88cfb6f968550a77651a3f2bcda4772bd0c6f7d88e4dc9b43750b6fcf`). Both are kept unchanged.
- **Method:** a full read of the contract, a comparison of the live V6 bytecode with the `master` source, a read of G$'s verified source, and read-only chain queries. It relied on the existing test evidence.
- **Not done:** no new tests, fuzzing or formal verification, and no review of GoodDollar's Identity, UBIScheme or Superfluid contracts beyond the calls the game makes. It isn't the independent review.
- **Unknowns:** whether anyone else can act through the owner's smart-account delegation, and the governance and timelock behind G$'s admin contract, `0x495d…eCEC`.
- **Follow-up:** the independent audit is committed for the GoodBuilders seasonal audit. L-1 hardening and the L-2 and L-3 fixes go into a later upgrade.

### 2.4 Automated tests and rehearsal

| # | Evidence | Status | Location |
|---|---|---|---|
| G-E1 | UBI regression matrix: all six paid paths, exactly one event each, exact amounts | ☑ 17 pass | `contracts/Game2048UbiRegression.t.sol`; `evidence/ubi-regression-solidity.log` |
| G-E2 | Purchase coverage guard: every paid ABI function goes through `_collectPayment` | ☑ 6 pass | `test/ubiPurchaseGuard.ts`, which now includes the refund-path guard |
| G-E3 | Contract mutations detected | ☑ 15 of 15, reproduced for the UBI-only package | `g-e3-mutation-run.log` and `g-e3-mutation-caught-by.txt`. Unmutated control: 124 of 124. Five of the mutations are future-item cases. |
| G-E4 | Subgraph (matchstick) | ☑ 12 pass | `subgraph-tests.log` |
| G-E5 | **Fork rehearsal with real G$ and UBIScheme** (`scripts/checks/rehearse-ubi-contribution.ts`): a purchase on every path, with 5% reaching `0x43d72Ff1…4A1` and a matching G$ `Transfer` | ☑ Passed | `rehearsal-83121518.*` and `rehearsal-83121792.*`: all six paths, 352.5 G$ to the UBIScheme, 0 discrepancies. The release packet and rollback were also rehearsed (`release-packet-rehearsal.*`, block 83,137,713). |
| G-E6 | After release: bytecode verified; `ubiRecipient()` and `supportsUndoAtSubmit()` checked; the first real contribution checked on Celoscan, in the subgraph and on the profile card | ☐ Open: after release | The tooling is ready: `verify-ubi-release-packet.ts` (bytecode, recipient, rate) and `reconcile-ubi-contributions.ts` (first contribution). `supportsUndoAtSubmit()` doesn't apply to the UBI-only package. |

Contributions must be verified from the purchase receipt's G$ `Transfer` log. UBIScheme balance changes are not reliable evidence, because its Superfluid streams move the balance continuously.

### 2.5 GoodDollar confirmations

| # | Confirmation | Status |
|---|---|---|
| G-D1 | **Written confirmation from GoodDollar** that `0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1` is the right production UBIScheme recipient for third-party contributions, and that a direct G$ transfer is an acceptable route | ☐ Open. The address is sourced from GoodDollar's GoodCollective factories, which pay their protocol fee to it; that source wasn't re-verified for this package (`release-review/05` §5) |
| G-D2 | GoodDollar is aware of the public "UBI contributed" attribution wording | ☐ Open |
| G-D3 | Monitoring for G$ and Identity upgrades and for G$ fee-formula changes. Today the fee is 0; a fee would under-report contributions and changes the reentrancy assumption | ☐ Open (`release-review/06` P-3, P-4). At block 83,138,012: fees 0 on all three flows, not paused (`gdollar-fees-and-pause.txt`). Responsible person: not yet assigned; the product owner names one. A named owner is required before release (19 Nov). With the review waived, this is the main safeguard behind accepting G-A2 (L-1). It covers the G$ implementation, fees and pause state, and the game's `TokensUpdated` and `Upgraded` events. |

### 2.6 Governance and owner approval

| # | Approval | Status |
|---|---|---|
| G-G1 | Product owner and treasury sign-off on G-P1 | ☐ Open |
| G-G2 | Release authorisation after S-1 to S-7, G-A2, G-A3, G-E5, G-D1 and a named G-D3 owner | ☐ Open (G-A3 waived 19 Nov) |
| G-G3 | Authorised owner signs the upgrade (S-2, S-3); the implementation is deployed with `Game2048UbiContributionImpl.ts` (production profile) and its address recorded | ☐ Open (`release-review/06` O-1, O-2) |

### 2.7 Outstanding blockers

**Release status on 21 Nov, in the approval tracker's numbering.** Approval 4 (independent review) is waived for this release, and approval 6 (commit and draft PR) is done. Approvals 1, 2, 3 and 5 and the G$ monitoring assignment (G-D3) are outstanding and block the release; approval 7 (release authorisation, deployment and the upgrade signature) follows them. Approval 8 (subgraph switch) affects only the profile figure, and items 9a and 9b aren't release prerequisites.

- **Economics sign-off (approval 1).** G-P1 is open.
- **GoodDollar confirmation (approval 2).** G-D1 is open.
- **Reentrancy decision (approval 3).** It's open, and it's the contract owner's decision (G-A2; L-1, LOW and theoretical). The independent review was waived for this release on 19 Nov (G-A3), and a follow-up review, committed for the GoodBuilders seasonal audit, comes after release.
- **The owner key (approval 5).** S-2 is open (M-1, MEDIUM). Owner-key acceptance stays outstanding until the key-holder confirmations exist. For S-3, the calldata and checks are rehearsed, but the owner's own signing path isn't.
- **G$ monitoring.** A named owner is required before release; no one is assigned yet (G-D3).
- **Design limitations.** S-7 is partly done: self-reported results are accepted (M-2). Acceptance of no pause and one-step owner transfers isn't recorded yet.
- **Committed (approval 6, done).** The package is draft PR #87. Its code is commit `c6f90061`; the commits after it change documentation only. Merging waits on the approvals above.
- **Subgraph switch (approval 8).** G-T2, G-T3 and G-T6 are open. They affect only the profile figure.

The fork rehearsal (G-E5), the mutation reproduction (G-E3), the historical scan (G-T5), the storage layout (S-4) and the Ignition clean-up (S-6) are done for the UBI-only package.

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
| 2. UBI 5% | ☐ | ◐ internal only; independent review waived 19 Nov | ◐ fork passed (G-E5); owner's signing path not yet (S-3) | ☐ | ☐ owner key | **No** |
| 3. XP-to-G$ rewards | ☐ proposals only | ◐ internal only | ☐ no staging | ☐ | ☐ no admins | **No** |
