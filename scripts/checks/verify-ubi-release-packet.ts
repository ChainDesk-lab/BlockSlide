/**
 * READ-ONLY release-day check for the UBI upgrade. Run it after the
 * implementation is deployed and before the owner signs anything:
 *
 *   IMPL=<deployed implementation> npx hardhat run --build-profile production scripts/checks/verify-ubi-release-packet.ts
 *
 * It confirms that the deployed code is the reviewed build, with GoodDollar's
 * UBIScheme as its recipient. It also confirms that the proxy still runs the
 * live V6 implementation and that the owner's upgrade succeeds in simulation.
 * Then it prints the upgrade transaction and the rollback transaction.
 *
 * Env:
 * - IMPL (required).
 * - RPC_URL: defaults to https://forno.celo.org.
 * - OUT: path for a JSON copy of the packet.
 *
 * Exits 1 unless every check passes. Nothing is signed or sent.
 */
import { writeFileSync } from "node:fs";
import { artifacts } from "hardhat";
import { createPublicClient, getAddress, http } from "viem";
import { PRODUCTION, REVIEWED_BUILD, buildReleasePacket, type BuildArtifact } from "../lib/ubiReleasePacket.js";

if (!process.env.IMPL) throw new Error("Set IMPL to the deployed implementation's address");
const client = createPublicClient({ transport: http(process.env.RPC_URL ?? "https://forno.celo.org", { retryCount: 4, retryDelay: 800 }) });
if ((await client.getChainId()) !== 42220) throw new Error("RPC_URL must be Celo mainnet (chain 42220)");
const artifact = (await artifacts.readArtifact("Game2048")) as unknown as BuildArtifact;

const packet = await buildReleasePacket(client, {
  implementation: getAddress(process.env.IMPL),
  proxy: PRODUCTION.proxy,
  recipient: PRODUCTION.ubiScheme,
  rollbackTo: PRODUCTION.liveImplementation,
  artifact,
  reviewed: REVIEWED_BUILD,
});

console.log(`block ${await client.getBlockNumber()}, chain ${await client.getChainId()}`);
for (const c of packet.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.check}: ${c.detail}`);
console.log(`\nSigner (the proxy's owner): ${packet.signer ?? "unknown"}`);
console.log(`Upgrade  -> to ${packet.upgrade.to}, value 0, data ${packet.upgrade.data}`);
console.log(`Rollback -> to ${packet.rollback.to}, value 0, data ${packet.rollback.data}`);
console.log(packet.ok
  ? "\nPACKET READY: every check passed. The owner signs the upgrade transaction above, exactly as printed; nothing was sent."
  : "\nDO NOT SIGN: at least one check failed.");
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(packet, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
process.exitCode = packet.ok ? 0 : 1;
