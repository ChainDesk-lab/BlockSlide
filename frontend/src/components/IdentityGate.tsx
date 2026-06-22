import { useGoodDollarIdentity } from "../hooks/useGoodDollarIdentity";
import { IdentityStatus } from "../hooks/useIdentity";
import { IdCardIcon } from "./icons";

interface Props {
  status: IdentityStatus;
  onRefresh: () => void;
  onStarted: () => void;
}

export default function IdentityGate({ status, onRefresh, onStarted }: Props) {
  // Use unified GoodDollar identity hook
  const {
    isVerifying,
    error: verificationError,
    startVerification: startGoodDollarVerification,
  } = useGoodDollarIdentity();

  if (status === "no-wallet" || status === "verified") return null;

  const handleVerify = async () => {
    onStarted(); // Mark as pending in useIdentity hook
    await startGoodDollarVerification(); // Start SDK-based verification
  };

  return (
    <div className="identity-gate" role="alert">
      <div className="identity-gate__icon">
        {status === "loading" ? (
          <span className="spinner identity-gate__spinner" aria-hidden="true" />
        ) : (
          <IdCardIcon size={22} className="identity-gate__face" />
        )}
      </div>

      <div className="identity-gate__body">
        {status === "loading" ? (
          <p className="identity-gate__title">Checking GoodDollar verification…</p>
        ) : status === "pending" ? (
          <>
            <p className="identity-gate__title">Verification in progress</p>
            <p className="identity-gate__desc">
              Finish the face scan in the GoodDollar tab. Once it completes, come
              back and check again — it can take a moment to confirm on-chain.
            </p>

            {verificationError && (
              <p className="identity-gate__error">{verificationError}</p>
            )}

            <div className="identity-gate__actions">
              <button
                className="btn btn--primary identity-gate__btn"
                onClick={() => {
                  onRefresh();
                }}
              >
                I have completed verification, check again
              </button>
              <button
                className="btn identity-gate__btn identity-gate__btn--check"
                onClick={handleVerify}
                disabled={isVerifying}
              >
                {isVerifying ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> Preparing…
                  </>
                ) : (
                  "Restart verification"
                )}
              </button>
            </div>

            <p className="identity-gate__note">
              You can still play in demo mode while this confirms.
            </p>
          </>
        ) : (
          <>
            <p className="identity-gate__title">Face verification required</p>
            <p className="identity-gate__desc">
              Verify once with GoodDollar to submit scores on-chain. Your wallet
              will ask you to sign a message, then you will be taken directly to
              the face scan.
            </p>

            {verificationError && (
              <p className="identity-gate__error">{verificationError}</p>
            )}

            <div className="identity-gate__actions">
              <button
                className="btn btn--primary identity-gate__btn"
                onClick={handleVerify}
                disabled={isVerifying}
              >
                {isVerifying ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> Preparing…
                  </>
                ) : (
                  "Start face verification"
                )}
              </button>
              <button
                className="btn identity-gate__btn identity-gate__btn--check"
                onClick={() => {
                  onRefresh();
                }}
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
