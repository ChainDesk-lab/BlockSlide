import { ConnectButton } from "@rainbow-me/rainbowkit";

export default function WalletButton() {
  return (
    <ConnectButton
      label="Connect"
      chainStatus="icon"
      showBalance={false}
      accountStatus={{
        smallScreen: "avatar",
        largeScreen: "full",
      }}
    />
  );
}
