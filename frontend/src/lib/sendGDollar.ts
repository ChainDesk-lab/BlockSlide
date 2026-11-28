/**
 * Checks for sending G$ out of a player's wallet (the "Send G$" option in the wallet menu).
 * Pure functions, so every rule is tested without a wallet.
 *
 * The send is a plain G$ ERC-20 transfer on Celo, signed by the player's own wallet: an email
 * (Magic) wallet through the same signer the game uses, a browser wallet through wagmi.
 */
import { getAddress, isAddress, parseUnits } from "viem";
import { GAME2048_ADDRESS, G_DOLLAR_ADDRESS } from "./constants";

export const G_DECIMALS = 18;

export type SendCheck =
  | { ok: true; to: `0x${string}`; amountWei: bigint }
  | { ok: false; field: "to" | "amount"; message: string };

/**
 * Addresses that accept a G$ transfer but would lose it: the token itself and the game
 * contract (the game can't credit a direct transfer to anyone).
 */
const BLOCKED: Record<string, string> = {
  [G_DOLLAR_ADDRESS.toLowerCase()]: "That's the G$ token contract. G$ sent there is lost. Use a wallet address.",
  [GAME2048_ADDRESS.toLowerCase()]: "That's the BlockSlide game contract. G$ sent there can't be returned. Use a wallet address.",
};

/** Parses a typed amount ("12", "12.5", "1,000.25") into wei, or null if it isn't a valid amount. */
export function parseGAmount(input: string): bigint | null {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  const [, frac = ""] = s.split(".");
  if (frac.length > G_DECIMALS) return null;
  try {
    return parseUnits(s, G_DECIMALS);
  } catch {
    return null;
  }
}

export function checkSend(input: { to: string; amount: string; from: string | undefined; balanceWei: bigint | null }): SendCheck {
  const raw = input.to.trim();
  if (!raw) return { ok: false, field: "to", message: "Enter the wallet address to send to." };
  if (!isAddress(raw, { strict: false })) {
    return { ok: false, field: "to", message: "That isn't a valid wallet address. It should start with 0x and have 42 characters." };
  }
  const to = getAddress(raw);
  if (/^0x0{40}$/i.test(to)) return { ok: false, field: "to", message: "That's the zero address. G$ sent there is lost." };
  const blocked = BLOCKED[to.toLowerCase()];
  if (blocked) return { ok: false, field: "to", message: blocked };
  if (input.from && to.toLowerCase() === input.from.toLowerCase()) {
    return { ok: false, field: "to", message: "That's your own BlockSlide wallet. Enter a different address." };
  }

  const amountWei = parseGAmount(input.amount);
  if (amountWei === null) return { ok: false, field: "amount", message: "Enter an amount, like 100 or 12.5." };
  if (amountWei <= 0n) return { ok: false, field: "amount", message: "The amount must be more than 0." };
  if (input.balanceWei !== null && amountWei > input.balanceWei) {
    return { ok: false, field: "amount", message: "That's more G$ than you have." };
  }
  return { ok: true, to, amountWei };
}

/** "0x1234…abcd" for confirmations. */
export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const celoscanTx = (hash: string) => `https://celoscan.io/tx/${hash}`;
