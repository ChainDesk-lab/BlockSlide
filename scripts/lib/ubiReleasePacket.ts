/**
 * The UBI upgrade's release packet (READ-ONLY). Before the owner signs, check
 * that a deployed implementation is exactly the reviewed build with the right
 * UBI recipient, and produce the two transactions the owner may sign: the
 * upgrade, and the rollback to the live implementation. Nothing here signs or
 * sends: the only call that touches the proxy is an eth_call simulation.
 */
import { encodeFunctionData, getAddress, keccak256, parseAbi, zeroAddress, type Address, type Hex, type PublicClient } from "viem";

export const PRODUCTION = {
  proxy: getAddress("0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6"),
  ubiScheme: getAddress("0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1"),
  /** Game2048 V6, live since block 74,201,935: the rollback target. */
  liveImplementation: getAddress("0x03225350AD18e2D6Aa5eA2ce421fC596357c2249"),
} as const;

/**
 * Fingerprints of the reviewed build (production profile), recorded with the
 * frozen review target review-target-20261118-183335. Any change to the
 * contract or its compiler settings changes them: re-review, then update.
 */
export const REVIEWED_BUILD = {
  creationKeccak: "0x963e1671f0ce778cd6803a6a9128957279db3e0b0c2b384d0964ce937491d5c4",
  runtimeZeroedKeccak: "0x42be5f6fb73794f7c81caf1210933a49edb36dc48be2324197415a18d4074bd3",
} as const satisfies Record<string, Hex>;

export const EIP1967_IMPLEMENTATION_SLOT: Hex = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export type ImmutableReferences = Record<string, readonly { start: number; length: number }[]>;
export interface BuildArtifact { bytecode: Hex; deployedBytecode: Hex; immutableReferences?: ImmutableReferences }

const UPGRADE_ABI = parseAbi(["function upgradeToAndCall(address newImplementation, bytes data) payable"]);
const READ_ABI = parseAbi([
  "function ubiRecipient() view returns (address)",
  "function UBI_CONTRIBUTION_BPS() view returns (uint256)",
  "function MAX_UBI_CONTRIBUTION_BPS() view returns (uint256)",
  "function proxiableUUID() view returns (bytes32)",
  "function owner() view returns (address)",
]);

/** upgradeToAndCall(implementation, "0x"): no initializer runs, as for every Game2048 upgrade. */
export const upgradeCalldata = (implementation: Address): Hex =>
  encodeFunctionData({ abi: UPGRADE_ABI, functionName: "upgradeToAndCall", args: [getAddress(implementation), "0x"] });

/** Runtime code with every immutable's bytes zeroed, as the compiler emits it. */
export function zeroImmutables(runtime: Hex, refs: ImmutableReferences = {}): Hex {
  let h = runtime.slice(2).toLowerCase();
  for (const occurrences of Object.values(refs)) {
    for (const { start, length } of occurrences) {
      if ((start + length) * 2 > h.length) continue; // code too short: the comparison fails anyway
      h = h.slice(0, start * 2) + "00".repeat(length) + h.slice((start + length) * 2);
    }
  }
  return `0x${h}`;
}

/** Each immutable's 32-byte value in deployed code, by AST id. Throws if an immutable's copies disagree. */
export function immutableValues(runtime: Hex, refs: ImmutableReferences = {}): Record<string, Hex> {
  const h = runtime.slice(2).toLowerCase();
  const out: Record<string, Hex> = {};
  for (const [id, occurrences] of Object.entries(refs)) {
    const values = new Set(occurrences.map(({ start, length }) => h.slice(start * 2, (start + length) * 2)));
    if (values.size !== 1) throw new Error(`immutable ${id} has ${values.size} different values in the deployed code`);
    out[id] = `0x${[...values][0]}`;
  }
  return out;
}

/** An address stored in a 32-byte word, or null if the word isn't one. */
function wordToAddress(word: Hex | undefined): Address | null {
  const h = (word ?? "0x").slice(2).padStart(64, "0");
  return h.length === 64 && /^0{24}/.test(h) ? getAddress(`0x${h.slice(24)}`) : null;
}

export interface PacketCheck { check: string; ok: boolean; detail: string }
export interface OwnerTransaction { to: Address; value: 0n; data: Hex }
export interface ReleasePacket {
  ok: boolean;
  checks: PacketCheck[];
  /** The proxy's owner: the only key that can sign either transaction. */
  signer: Address | null;
  upgrade: OwnerTransaction;
  rollback: OwnerTransaction;
}

export interface PacketInput {
  implementation: Address;
  proxy: Address;
  recipient: Address;
  /** The implementation the proxy runs now, and the one the rollback returns to. */
  rollbackTo: Address;
  artifact: BuildArtifact;
  reviewed: { creationKeccak: Hex; runtimeZeroedKeccak: Hex };
}

const message = (e: unknown) => ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? String(e)).split("\n")[0];

export async function buildReleasePacket(client: PublicClient, o: PacketInput): Promise<ReleasePacket> {
  const impl = getAddress(o.implementation);
  const proxy = getAddress(o.proxy);
  const recipient = getAddress(o.recipient);
  const rollbackTo = getAddress(o.rollbackTo);
  const refs = o.artifact.immutableReferences ?? {};
  const checks: PacketCheck[] = [];
  const add = (check: string, ok: boolean, detail: string) => checks.push({ check, ok, detail });

  // 1. The build on this machine is the reviewed one.
  const creation = keccak256(o.artifact.bytecode);
  add("local build is the reviewed build", creation === o.reviewed.creationKeccak,
    creation === o.reviewed.creationKeccak ? `creation keccak ${creation}` : `creation keccak ${creation}, reviewed ${o.reviewed.creationKeccak}: build with --build-profile production, from the reviewed commit`);

  // 2. The deployed code is that build, apart from its immutables.
  const code = (await client.getCode({ address: impl })) ?? "0x";
  if (code === "0x") {
    add("implementation has code", false, `no code at ${impl}`);
  } else {
    const zeroed = zeroImmutables(code, refs);
    add("deployed runtime equals the local build, immutables aside", zeroed === zeroImmutables(o.artifact.deployedBytecode, refs), `${(code.length - 2) / 2} bytes at ${impl}`);
    add("deployed runtime has the reviewed fingerprint", keccak256(zeroed) === o.reviewed.runtimeZeroedKeccak, `immutables-zeroed keccak ${keccak256(zeroed)}`);
    // 3. Exactly two immutables: UUPS's own address (__self) and the UBI recipient.
    try {
      const values = Object.values(immutableValues(code, refs)).map(wordToAddress);
      const ok = values.length === 2 && values.filter((v) => v === impl).length === 1 && values.filter((v) => v === recipient).length === 1;
      add("immutables are the implementation's own address and the UBI recipient", ok, `values: ${values.map((v) => v ?? "not an address").join(", ")}`);
    } catch (e) {
      add("immutables are the implementation's own address and the UBI recipient", false, message(e));
    }
  }

  // 4. What the implementation reports about itself.
  const read = async <T>(fn: "ubiRecipient" | "UBI_CONTRIBUTION_BPS" | "MAX_UBI_CONTRIBUTION_BPS" | "proxiableUUID" | "owner", address: Address): Promise<T | Error> => {
    try { return (await client.readContract({ address, abi: READ_ABI, functionName: fn })) as T; } catch (e) { return new Error(message(e)); }
  };
  const [reportedRecipient, bps, cap, uuid, implOwner] = await Promise.all([
    read<Address>("ubiRecipient", impl), read<bigint>("UBI_CONTRIBUTION_BPS", impl), read<bigint>("MAX_UBI_CONTRIBUTION_BPS", impl),
    read<Hex>("proxiableUUID", impl), read<Address>("owner", impl),
  ]);
  const show = (v: unknown) => (v instanceof Error ? `call failed: ${v.message}` : String(v));
  add("ubiRecipient() is the expected recipient", !(reportedRecipient instanceof Error) && getAddress(reportedRecipient) === recipient, `ubiRecipient() = ${show(reportedRecipient)}`);
  add("UBI_CONTRIBUTION_BPS() is 500 and MAX_UBI_CONTRIBUTION_BPS() is 1,000", bps === 500n && cap === 1_000n, `${show(bps)} / ${show(cap)}`);
  add("proxiableUUID() is the EIP-1967 implementation slot", uuid === EIP1967_IMPLEMENTATION_SLOT, show(uuid));
  add("implementation itself is uninitialized (owner() is zero)", implOwner === zeroAddress, `owner() = ${show(implOwner)}`);

  // 5. The proxy today, the signer, and the upgrade in simulation.
  const current = wordToAddress(await client.getStorageAt({ address: proxy, slot: EIP1967_IMPLEMENTATION_SLOT }));
  add("proxy runs the rollback target now", current === rollbackTo, `current implementation ${current ?? "unreadable"}`);
  const owner = await read<Address>("owner", proxy);
  const signer = owner instanceof Error ? null : getAddress(owner);
  add("proxy owner is readable", signer !== null, `owner() = ${show(owner)}`);
  const upgrade: OwnerTransaction = { to: proxy, value: 0n, data: upgradeCalldata(impl) };
  const rollback: OwnerTransaction = { to: proxy, value: 0n, data: upgradeCalldata(rollbackTo) };
  if (signer) {
    try {
      await client.call({ account: signer, to: upgrade.to, data: upgrade.data, value: 0n });
      add("the owner's upgrade succeeds in simulation (eth_call; nothing sent)", true, `from ${signer}`);
    } catch (e) {
      add("the owner's upgrade succeeds in simulation (eth_call; nothing sent)", false, message(e));
    }
  }
  return { ok: checks.every((c) => c.ok), checks, signer, upgrade, rollback };
}
