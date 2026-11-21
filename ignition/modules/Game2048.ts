import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { encodeFunctionData, getAddress } from "viem";

// Fresh deployment of a NEW game (implementation + proxy). The live game is
// upgraded with Game2048UbiContributionImpl.ts instead; never run this for it.
const CELO_G_DOLLAR    = getAddress("0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A");
const CELO_IDENTITY_V2 = getAddress("0xC361A6E67822a0EDc17D899227dd9FC50BD62F42");
// GoodDollar's production UBIScheme on Celo: the 5% Shop contribution recipient.
const CELO_UBI_SCHEME  = getAddress("0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1");

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
  // Deploy the implementation (constructor sets the UBI recipient and calls _disableInitializers)
  const ubiRecipient = m.getParameter("ubiRecipient", CELO_UBI_SCHEME);
  const impl = m.contract("Game2048", [ubiRecipient]);

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
