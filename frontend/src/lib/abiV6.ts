// V6 contract functions and events (extends GAME2048_ABI)
export const GAME2048_V6_FUNCTIONS = [
  // Read-only: undo move
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "undoCredits",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view" as const,
    type: "function" as const,
  },
  {
    inputs: [],
    name: "undoPrice",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view" as const,
    type: "function" as const,
  },
  // Write: buy undo move
  {
    inputs: [{ internalType: "uint256", name: "quantity", type: "uint256" }],
    name: "buyUndoMove",
    outputs: [],
    stateMutability: "nonpayable" as const,
    type: "function" as const,
  },
  // Write: consume undo. Signature from the compiled contract: it takes the
  // player address and has no caller check, so the app must never call it
  // while Undo is disabled (UNDO_ENABLED).
  {
    inputs: [{ internalType: "address", name: "player", type: "address" }],
    name: "consumeUndo",
    outputs: [],
    stateMutability: "nonpayable" as const,
    type: "function" as const,
  },
  // Read-only: cosmetics catalog
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "cosmeticCatalog",
    outputs: [
      { internalType: "uint256", name: "price", type: "uint256" },
      { internalType: "bool", name: "exists", type: "bool" },
    ],
    stateMutability: "view" as const,
    type: "function" as const,
  },
  // Read-only: cosmetics owned
  {
    inputs: [
      { internalType: "address", name: "", type: "address" },
      { internalType: "uint256", name: "", type: "uint256" },
    ],
    name: "cosmeticsOwned",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view" as const,
    type: "function" as const,
  },
  // Write: buy cosmetic
  {
    inputs: [{ internalType: "uint256", name: "itemId", type: "uint256" }],
    name: "buyCosmetic",
    outputs: [],
    stateMutability: "nonpayable" as const,
    type: "function" as const,
  },
  // Write: set cosmetic price (owner only)
  {
    inputs: [
      { internalType: "uint256", name: "itemId", type: "uint256" },
      { internalType: "uint256", name: "price", type: "uint256" },
    ],
    name: "setCosmeticPrice",
    outputs: [],
    stateMutability: "nonpayable" as const,
    type: "function" as const,
  },
  // Write: remove cosmetic (owner only)
  {
    inputs: [{ internalType: "uint256", name: "itemId", type: "uint256" }],
    name: "removeCosmeticItem",
    outputs: [],
    stateMutability: "nonpayable" as const,
    type: "function" as const,
  },
  // Read-only: get cosmetic item
  {
    inputs: [{ internalType: "uint256", name: "itemId", type: "uint256" }],
    name: "getCosmeticItem",
    // Returns a struct (one tuple output), as compiled — not two outputs.
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "price", type: "uint256" },
          { internalType: "bool", name: "exists", type: "bool" },
        ],
        internalType: "struct Game2048.CosmeticItem",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view" as const,
    type: "function" as const,
  },
  // Read-only: get cosmetics owned (batch)
  {
    inputs: [
      { internalType: "address", name: "player", type: "address" },
      { internalType: "uint256[]", name: "itemIds", type: "uint256[]" },
    ],
    name: "getCosmeticsOwned",
    outputs: [{ internalType: "bool[]", name: "owned", type: "bool[]" }],
    stateMutability: "view" as const,
    type: "function" as const,
  },
  // Custom errors the V6 shop can revert with (from the compiled contract), so
  // reverts decode to a name instead of an unknown signature.
  { inputs: [], name: "ZeroPriceNotAllowed", type: "error" as const },
  { inputs: [], name: "CosmeticDoesNotExist", type: "error" as const },
  { inputs: [], name: "InsufficientUndoCredits", type: "error" as const },
] as const;

export const GAME2048_V6_EVENTS = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "player", type: "address" },
      { indexed: false, internalType: "uint256", name: "quantity", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "pricePaid", type: "uint256" },
    ],
    name: "UndoPurchased",
    type: "event" as const,
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "player", type: "address" },
    ],
    name: "UndoConsumed",
    type: "event" as const,
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "player", type: "address" },
      { indexed: true, internalType: "uint256", name: "itemId", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "pricePaid", type: "uint256" },
    ],
    name: "CosmeticPurchased",
    type: "event" as const,
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "itemId", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "price", type: "uint256" },
      { indexed: false, internalType: "bool", name: "exists", type: "bool" },
    ],
    name: "CosmeticCatalogUpdated",
    type: "event" as const,
  },
] as const;
