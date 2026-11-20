/**
 * Regression guard for the 5% UBI contribution: no paid Shop purchase can be
 * added, or changed, so that it skips `_collectPayment` or the regression
 * matrix without a test failing.
 *
 * Reads only what the compiler produced (no text matching): Game2048's ABI and
 * AST, and the AST of contracts/Game2048UbiRegression.t.sol, whose `_purchase`
 * function is the matrix's coverage list.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { artifacts } from "hardhat";

const GAME = "contracts/Game2048.sol:Game2048";
const MATRIX = "contracts/Game2048UbiRegression.t.sol:Game2048UbiRegressionTest";

/** Functions allowed to pull tokens without going through _collectPayment, and why. */
const DIRECT_PULL_ALLOWED: Record<string, string> = {
  fundTreasury: "owner deposit into the treasury; not a purchase, contributes nothing by design",
};
/** Payable functions that aren't purchases (native CELO is never a Shop payment). */
const PAYABLE_ALLOWED = new Set(["upgradeToAndCall"]);
/** Token calls that move tokens out of someone else's balance (pulls). */
const PULLS = new Set(["transferFrom", "safeTransferFrom"]);

type Node = { nodeType?: string; [k: string]: unknown };

/** Every AST node below `n`, depth first. */
function* walk(n: unknown): Generator<Node> {
  if (Array.isArray(n)) { for (const c of n) yield* walk(c); return; }
  if (!n || typeof n !== "object") return;
  const o = n as Node;
  if (typeof o.nodeType === "string") yield o;
  for (const v of Object.values(o)) if (v && typeof v === "object") yield* walk(v);
}

async function contractAst(fqn: string): Promise<Node> {
  const [file, name] = fqn.split(":");
  const id = await artifacts.getBuildInfoId(fqn);
  assert.ok(id, `no build info for ${fqn}`);
  const outPath = await artifacts.getBuildInfoOutputPath(id);
  assert.ok(outPath, `no build info output for ${fqn}`);
  const out = JSON.parse(await readFile(outPath, "utf8")).output;
  const key = Object.keys(out.sources).find((k) => k === file || k.endsWith(`/${file}`));
  assert.ok(key, `${file} not in its build info`);
  const c = [...walk(out.sources[key].ast)].find((n) => n.nodeType === "ContractDefinition" && n.name === name);
  assert.ok(c, `contract ${name} not found in the AST`);
  return c;
}

interface Fn { id: number; name: string; visibility: string; node: Node }

/** Game2048's own functions, each with the internal functions it calls. */
function functionsOf(contract: Node): { byId: Map<number, Fn>; calls: Map<number, Set<number>> } {
  const byId = new Map<number, Fn>();
  for (const n of (contract.nodes as Node[])) {
    if (n.nodeType === "FunctionDefinition" && n.kind === "function") {
      byId.set(n.id as number, { id: n.id as number, name: n.name as string, visibility: n.visibility as string, node: n });
    }
  }
  const calls = new Map<number, Set<number>>();
  for (const f of byId.values()) {
    const s = new Set<number>();
    for (const n of walk(f.node.body)) {
      if (n.nodeType !== "FunctionCall") continue;
      const ex = n.expression as Node;
      const ref = ex?.nodeType === "Identifier" ? (ex.referencedDeclaration as number) : undefined;
      if (ref !== undefined && byId.has(ref)) s.add(ref);
    }
    calls.set(f.id, s);
  }
  return { byId, calls };
}

function reaches(from: number, target: number, calls: Map<number, Set<number>>, seen = new Set<number>()): boolean {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  for (const c of calls.get(from) ?? []) if (reaches(c, target, calls, seen)) return true;
  return false;
}

/** Name of a FunctionCall's member, e.g. "safeTransferFrom" for token.safeTransferFrom(...). */
const memberCalled = (n: Node): string | null =>
  n.nodeType === "FunctionCall" && (n.expression as Node)?.nodeType === "MemberAccess" ? ((n.expression as Node).memberName as string) : null;

describe("UBI contribution: purchase coverage guard", async () => {
  const game = await contractAst(GAME);
  const { byId, calls } = functionsOf(game);
  const fns = [...byId.values()];
  const collect = fns.find((f) => f.name === "_collectPayment");
  const entry = fns.filter((f) => f.visibility === "external" || f.visibility === "public");
  const abi = (await artifacts.readArtifact("Game2048")).abi as ReadonlyArray<{ type: string; name?: string; stateMutability?: string }>;
  const abiBuys = abi.filter((e) => e.type === "function" && e.name!.startsWith("buy") && e.stateMutability !== "view" && e.stateMutability !== "pure").map((e) => e.name!).sort();

  it("_collectPayment exists, is internal, takes the payment, pays UBI and emits UbiContribution", () => {
    assert.ok(collect, "_collectPayment is missing");
    assert.equal(collect.visibility, "internal");
    const body = [...walk(collect.node.body)];
    assert.ok(body.some((n) => memberCalled(n) === "safeTransferFrom"), "takes the payment with safeTransferFrom");
    assert.ok(body.some((n) => memberCalled(n) === "safeTransfer"), "sends the contribution with safeTransfer");
    assert.ok(body.some((n) => n.nodeType === "EmitStatement" && ((n.eventCall as Node).expression as Node).name === "UbiContribution"), "emits UbiContribution");
  });

  it("every token pull is inside _collectPayment, except the documented owner deposit", () => {
    const sites: string[] = [];
    for (const f of fns) for (const n of walk(f.node.body)) if (PULLS.has(memberCalled(n) ?? "")) sites.push(f.name);
    assert.ok(sites.includes("_collectPayment"));
    const outside = sites.filter((name) => name !== "_collectPayment" && !(name in DIRECT_PULL_ALLOWED));
    assert.deepEqual(outside, [], `token pulls outside _collectPayment: ${outside.join(", ")}`);
    for (const name of Object.keys(DIRECT_PULL_ALLOWED)) {
      const f = fns.find((x) => x.name === name);
      assert.ok(f, `${name} is allowlisted but no longer exists: remove it from DIRECT_PULL_ALLOWED`);
      const mods = ((f.node.modifiers as Node[]) ?? []).map((m) => ((m.modifierName as Node).name as string));
      assert.ok(mods.includes("onlyOwner"), `${name} pulls tokens directly, so it must stay onlyOwner`);
    }
  });

  it("the paid functions are exactly the ABI's buy* functions, and each pays through _collectPayment", () => {
    assert.ok(collect);
    const paid = entry.filter((f) => reaches(f.id, collect.id, calls)).map((f) => f.name).sort();
    assert.ok(abiBuys.length > 0, "no buy* functions in the ABI");
    assert.deepEqual(paid, abiBuys, "a buy* function that skips _collectPayment, or a paid function not named buy*");
  });

  it("no Shop payment in native CELO", () => {
    const payable = abi.filter((e) => e.type === "function" && e.stateMutability === "payable").map((e) => e.name!);
    assert.deepEqual(payable.filter((n) => !PAYABLE_ALLOWED.has(n)), []);
  });

  it("the regression matrix calls every paid function, and nothing else of Game2048", async () => {
    const matrix = await contractAst(MATRIX);
    const purchase = [...walk(matrix)].find((n) => n.nodeType === "FunctionDefinition" && n.name === "_purchase");
    assert.ok(purchase, "_purchase (the matrix's coverage list) is missing");
    const covered = new Set<string>();
    for (const n of walk(purchase.body)) {
      const ex = n.nodeType === "FunctionCall" ? (n.expression as Node) : null;
      if (ex?.nodeType !== "MemberAccess") continue;
      const on = ((ex.expression as Node).typeDescriptions as { typeString?: string } | undefined)?.typeString;
      if (on === "contract Game2048") covered.add(ex.memberName as string);
    }
    const missing = abiBuys.filter((n) => !covered.has(n));
    assert.deepEqual(missing, [], `paid purchases not in the UBI regression matrix: ${missing.join(", ")}`);
    assert.deepEqual([...covered].sort(), abiBuys, "the matrix calls a Game2048 function that isn't a paid purchase");
  });
});
