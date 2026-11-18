/**
 * Deployment guard for the UBI release: only reviewed Ignition modules remain,
 * every module that deploys Game2048 passes the UBI recipient, the production
 * modules default it to GoodDollar's UBIScheme, and the fresh-deploy module
 * initializes with the real G$ token. Reads the modules Ignition would run.
 */
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { decodeFunctionData, getAddress, parseAbi, type Hex } from "viem";

const G_DOLLAR = getAddress("0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A");
const UBI_SCHEME = getAddress("0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1");
const DIR = path.resolve("ignition/modules");
const REVIEWED = ["Game2048.ts", "Game2048Dev.ts", "Game2048UbiContributionImpl.ts"];

type RuntimeValue = { type?: string; name?: string; defaultValue?: unknown };
type Future = { contractName?: string; constructorArgs?: unknown[] };

describe("Ignition modules for the UBI release", async () => {
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".ts")).sort();
  const modules = await Promise.all(
    files.map(async (file) => ({ file, mod: (await import(pathToFileURL(path.join(DIR, file)).href)).default as { futures: Set<Future> } })),
  );
  const futuresOf = (file: string) => [...modules.find((m) => m.file === file)!.mod.futures];

  it("only the reviewed modules remain (the pre-UBI upgrade modules are gone)", () => {
    assert.deepEqual(files, REVIEWED);
  });

  it("every Game2048 deployment passes the UBI recipient", () => {
    for (const { file, mod } of modules) {
      for (const f of mod.futures) {
        if (f.contractName !== "Game2048") continue;
        assert.equal(f.constructorArgs?.length, 1, `${file}: Game2048 takes exactly one constructor argument, the UBI recipient`);
        const arg = f.constructorArgs![0] as RuntimeValue;
        assert.equal(arg?.type, "MODULE_PARAMETER", `${file}: the recipient must be the ubiRecipient parameter`);
        assert.equal(arg.name, "ubiRecipient", `${file}: parameter name`);
      }
    }
  });

  it("production modules default the recipient to GoodDollar's UBIScheme", () => {
    for (const file of ["Game2048.ts", "Game2048UbiContributionImpl.ts"]) {
      const game = futuresOf(file).find((f) => f.contractName === "Game2048");
      assert.ok(game, `${file} deploys Game2048`);
      const arg = game.constructorArgs![0] as RuntimeValue;
      assert.equal(getAddress(String(arg.defaultValue)), UBI_SCHEME, `${file}: default recipient`);
    }
  });

  it("the fresh-deploy module initializes with the real G$ token", () => {
    const proxy = futuresOf("Game2048.ts").find((f) => f.contractName === "Game2048Proxy");
    assert.ok(proxy, "Game2048.ts deploys Game2048Proxy");
    const init = decodeFunctionData({ abi: parseAbi(["function initialize(address,address)"]), data: proxy.constructorArgs![1] as Hex });
    assert.equal(getAddress(init.args[0]), G_DOLLAR);
  });
});
