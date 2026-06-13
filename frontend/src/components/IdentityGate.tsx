import { useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import { IdentitySDK } from "@goodsdks/citizen-sdk";
import { IdentityStatus } from "../hooks/useIdentity";
import { TARGET_CHAIN } from "../lib/constants";
import { IdCardIcon } from "./icons";

const FALLBACK_URL = "https://goodwallet.xyz/en";

interface Props {
  status: IdentityStatus;
  onRefresh: () => void;
}

export default function IdentityGate({ status, onRefresh }: Props) {
  const publicClient          = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [pending,  setPending]  = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (status === "no-wallet" || status === "verified") return null;

  const handleVerify = async () => {
    setErrorMsg(null);
    setPending(true);

    // Open the window immediately on the user-click stack frame so the
    // browser doesn't treat the later window.open as an unsolicited popup.
    const popup = window.open("about:blank", "_blank");

    try {
      if (publicClient && walletClient?.account) {
        const sdk = new IdentitySDK({
          publicClient: publicClient as any,
          walletClient: walletClient as any,
          env: "production",
        });

        const link = await sdk.generateFVLink(
          false,
          window.location.href,
          TARGET_CHAIN.id,
        );

        if (popup) {
          popup.location.href = link;
        } else {
          // Popup was blocked — surface the link so the user can click it
          setErrorMsg(`Popup blocked. Open this link manually: ${link}`);
        }
        return;
      }

      // Wallet client not ready — navigate to the fallback
      if (popup) popup.location.href = FALLBACK_URL;

    } catch (e: any) {
      // Rejected wallet signature — close the blank popup silently
      const msg: string = e?.shortMessage ?? e?.message ?? "";
      if (msg.toLowerCase().includes("reject") || msg.toLowerCase().includes("denied") || msg.toLowerCase().includes("cancel")) {
        popup?.close();
      } else {
        // Unexpected SDK error — navigate fallback
        setErrorMsg("Could not generate verification link. Try opening GoodWallet manually.");
        if (popup) popup.location.href = FALLBACK_URL;
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="identity-gate" role="alert">
      <div className="identity-gate__icon">
        {status === "loading"
          ? <span className="spinner identity-gate__spinner" aria-hidden="true" />
          : <IdCardIcon size={22} className="identity-gate__face" />}
      </div>

      <div className="identity-gate__body">
        {status === "loading" ? (
          <p className="identity-gate__title">Checking GoodDollar verification…</p>
        ) : (
          <>
            <p className="identity-gate__title">Face verification required</p>
            <p className="identity-gate__desc">
              Verify once with GoodDollar to earn G$ rewards and submit scores
              on-chain. Your wallet will ask you to sign a message, then you will
              be taken directly to the face scan.
            </p>

            {errorMsg && (
              <p className="identity-gate__error">{errorMsg}</p>
            )}

            <div className="identity-gate__actions">
              <button
                className="btn btn--primary identity-gate__btn"
                onClick={handleVerify}
                disabled={pending}
              >
                {pending
                  ? <><span className="spinner" aria-hidden="true" /> Preparing…</>
                  : "Start face verification"}
              </button>
              <button
                className="btn identity-gate__btn identity-gate__btn--check"
                onClick={() => { setErrorMsg(null); onRefresh(); }}
              >
                I have verified, check again
              </button>
            </div>

            <p className="identity-gate__note">
              You can still play in demo mode without verification.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
