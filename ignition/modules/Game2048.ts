import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { encodeFunctionData } from "viem";

const CELO_G_DOLLAR    = "0x62B8b11039FCfe5Ab0C56e502b1C372a3d462A4e" as const;
const CELO_IDENTITY_V2 = "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42" as const;

const INITIALIZE_ABI = [
  {
    name: "initialize",
    type: "function",
    inputs: [
      { name: "_gDollar",  type: "address" },
      { name: "_identity", type: "address" },
    ],
  },
] as const;

export default buildModule("Game2048Module", (m) => {
  // Deploy the implementation (constructor calls _disableInitializers)
  const impl = m.contract("Game2048");

  const initData = encodeFunctionData({
    abi: INITIALIZE_ABI,
    functionName: "initialize",
    args: [CELO_G_DOLLAR, CELO_IDENTITY_V2],
  });

  // Deploy Game2048Proxy (thin ERC1967Proxy subclass with a project artifact)
  const proxy = m.contract("Game2048Proxy", [impl, initData], {
    after: [impl],
  });

  return { impl, proxy };
});
