# Milestone-reward reentrancy (G-A2): risk record

This record is for the contract owner, who decides approval 3, and for the follow-up independent reviewer. It's part of the UBI release package. Read it with [UBI_RELEASE_REVIEW.md](UBI_RELEASE_REVIEW.md).

**The proposal:** release the 5% UBI contribution with this risk accepted, and harden the code in the next contract upgrade.

**Status (2026-11-19):**
- **The review is waived for this release.** The product owner waived the independent review in writing and acknowledged this residual risk.
- **The decision is still open.** The contract owner's decision (approval 3: accept or harden) is outstanding.
- **The checks move.** Checks R1 to R8 below go to the follow-up independent review after release.

## 1. The issue

A milestone reward is marked as claimed only *after* its G$ transfer. If a G$ transfer ever handed control to the receiving player, that player could submit another score before the mark was written, and be paid the same milestone again.

Path in `contracts/Game2048.sol`, identical in the live V6 source:

1. `submitScore` (264) checks the session, sets `session.active = false` (283), then calls `_awardXp`, `_updateStreak` and `_payMilestoneRewards` (290–292).
2. `_payMilestoneRewards` (608) returns at once unless `identity.isWhitelisted(msg.sender)` holds (611); the caller must be GoodDollar-verified. It reads the claimed bitmask into a local variable (613).
3. For each tier (2048, 1024, 512 and 256), it calls `_sendReward` and **only then** sets the tier's bit (619, 622, 625, 628).
4. `_sendReward` (636) calls `gDollar.transfer(msg.sender, amount)` (639). This is the one external call that could reach the player.
5. Nothing stops a re-entry. `submitScore` and `startSession` aren't `nonReentrant`, and `startSession` (239) accepts a new session as soon as the previous one is inactive.

The pattern is **pre-existing**: the live contract has had it since V6 went live on 7 Aug 2026 (block 74,201,935). The UBI release doesn't change it: `submitScore`, `startSession`, `_awardXp`, `_updateStreak`, `_payMilestoneRewards`, `_sendReward`, `_updateLeaderboard` and `withdrawTreasury` all have function bodies identical to the live source.

## 2. When it becomes exploitable

Exploiting it needs **both** of these conditions:

| # | Condition | Today |
|---|---|---|
| A | A G$ `transfer` runs code at the recipient, for example an ERC-777 `tokensReceived` hook or an ERC-677/1363 callback | **Not met.** G$ is SuperGoodDollar, implementation `0xb4419a3d…29ef`, unchanged at block 83,137,360. Its `transfer` path (`_transferFrom` → `SuperToken._transferFrom` → `_move`) makes no call to the recipient. Superfluid removed ERC-777 hooks from ERC-20 transfers; recipient calls exist only in `send` and `transferAndCall`, which the game doesn't use. |
| B | The attacker controls a GoodDollar-verified address that can run code | **Plausible.** Any verified person can point their wallet at code with EIP-7702, which is live on Celo. 3 of the 55 addresses ever rewarded, including the owner, already have an EIP-7702 delegation to `0x63c0…E32B`. Blockscout lists that address as the verified contract `EIP7702StatelessDeleGator`. |

**Condition A is the barrier.** G$ is upgradeable by GoodDollar, not by BlockSlide, so condition A could change without any action by BlockSlide.

## 3. Potential impact if condition A ever changed

- **Who.** Only a GoodDollar-verified address. One face maps to one wallet, so an attacker can't easily multiply addresses.
- **How much.** Rewards are 5, 15, 40 and 100 G$ (160 G$ per address when claimed honestly). One transaction could re-enter repeatedly and take rewards until it runs out of gas or call depth, or the treasury runs dry.
- **Ceiling.** The ceiling is the game's whole G$ treasury: 45,815 G$ at block 83,138,771, about 5.2 USD at CoinGecko's 18 Nov price of 0.000114 USD. After the release, the treasury also receives 95% of Shop revenue; Season 5 sales so far total 3,050 G$.
- **One shot per address.** When the transaction unwinds, every tier's bit ends up set, so the same address can't repeat the attack in a later transaction.
- **Not at risk.** UBI contributions are sent to the UBIScheme inside the purchase transaction and never sit in the treasury, so this issue can't reach them. Players' G$ in their own wallets isn't at risk either.
- **Legitimate players.** Their unpaid milestones stay claimable once the treasury is refunded, because the code only marks a tier claimed after paying it.

## 4. Why the current implementation is acceptable for this release

1. **The barrier holds today.** With a standard ERC-20 transfer, the bit is set before the player regains control, so each milestone pays exactly once. The internal experiment (`audit-reentrancy-experiment`) shows exactly one payout with a standard transfer. Only a hypothetical hooking token produces six payouts from five re-entries.
2. **No double payment has ever happened.** The proxy's history holds 79 `RewardPaid` events: 735 G$ to 55 players (256: 55, 512: 20, 1024: 4, 2048: 0). No player has been paid the same milestone twice. Blockscout and a 3-pass forno scan agree on the count.
3. **The release doesn't change the exposure.** The code is live today and unchanged here. Holding the UBI release back wouldn't reduce the risk. Shipping it only adds 95% of new Shop revenue to the treasury.
4. **The exposure is bounded and recoverable.** Exploitation needs a verified identity, is limited to one transaction per address, is capped at about 5.2 USD of G$ today, and can't reach UBI contributions.
5. **Controls exist without a code change.** The owner can move the whole treasury out with `withdrawTreasury` the moment G$ changes. Monitoring G$'s implementation and fees (gate G-D3) gives that trigger.
6. **Hardening now would cost the release.** Any contract change alters the reviewed bytecode. That means a re-review, new fingerprints, and re-running the suite and both fork rehearsals, all for a path that doesn't exist with today's token.

## 5. What the follow-up independent review must verify

The product owner waived the independent review for this release on 19 Nov. These checks now belong to the follow-up review after release, and any finding goes into a later upgrade.

| # | Check | Passes when |
|---|---|---|
| R1 | Read G$'s EIP-1967 implementation slot at review time. In its verified source, follow `transfer` and `transferFrom` through fee processing and the blocklist down to the balance update. | It's still `0xb4419a3d…29ef`, or the analysis is redone for a new one, and no call reaches the recipient or anything the recipient controls |
| R2 | List every external call in the score path: `submitScore` → `_awardXp`, `_updateStreak`, `_payMilestoneRewards`, `_sendReward` and `_updateLeaderboard` | The only external calls are `isWhitelisted` and `balanceOf`, both `view` and compiled as `STATICCALL`, and `gDollar.transfer` |
| R3 | Compare the score path with the live V6 source | It's unchanged by this release |
| R4 | Check the bounds in section 3 | Rewards require `isWhitelisted(msg.sender)`; after any completed call, every paid tier's bit is set; each payout is capped by the treasury balance; UBI contributions leave the treasury in the purchase transaction |
| R5 | Check how the UBI change interacts with this path | `nonReentrant` (transient storage) on the four `buy*` functions doesn't touch the score path, and a purchase made during a hypothetical callback still contributes exactly 5% |
| R6 | Assess the controls | `withdrawTreasury` (owner only) can empty the treasury in one transaction, and the G-D3 monitoring plan would detect a change to G$'s implementation or fees in time to use it |
| R7 | Reproduce the experiment from the evidence bundle | A standard ERC-20 pays once; a hooking token pays repeatedly. This confirms the risk depends only on condition A. |
| R8 | Assess the two hardening options for the next upgrade (section 6) | The preferred option closes the path with no storage change and no lost rewards |

## 6. Hardening for the next upgrade

Both options were tested in the internal experiment, on a disposable copy.

| Option | Change | Result in the experiment | Side effect |
|---|---|---|---|
| Mark first (preferred) | Set the tier's bit before `_sendReward`, and clear it if the payment fails (4 sites) | Exactly 1 payout | None observed |
| `nonReentrant` | Add the modifier to `submitScore` (the Season 5 package also needs it on `submitScoreWithUndos`) | At most 1 payout | If a hostile recipient's callback reverts, that payment fails, but the reward stays claimable |

Neither option changes storage.

## 7. Acceptance record

| Item | Status |
|---|---|
| Reviewer's verdict on R1 to R8 | Waived for this release (19 Nov); due in the follow-up review after release |
| Product owner's acknowledgement of the residual risk | Given in the 19 Nov waiver |
| Contract owner's decision: accept now and harden later, or harden before release | Outstanding (approval 3) |
| G-D3 monitoring of G$ transfer behaviour | Open: no one is assigned yet, and the product owner names a person. Recommended before release |
| Hardening scheduled for the next upgrade | To be recorded with the decision |
