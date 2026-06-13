import "dotenv/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
    },
    // Celo Sepolia testnet (replaces Alfajores — deprecated June 2025)
    celoSepolia: {
      type: "http",
      chainType: "l1",
      url: "https://forno.celo-sepolia.celo-testnet.org",
      accounts: [configVariable("CELO_PRIVATE_KEY")],
    },
    // Celo mainnet
    celo: {
      type: "http",
      chainType: "l1",
      url: "https://forno.celo.org",
      accounts: [configVariable("CELO_PRIVATE_KEY")],
    },
  },
});
