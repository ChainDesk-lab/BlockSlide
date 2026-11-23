"use client";

import { useEffect, useState } from "react";
import Notice from "./Notice";
import {
  FAILURE_COPY,
  SETUP_STAGES,
  setupStage,
  setupStatusLine,
  type SetupFailure,
  type SetupStatus,
} from "../lib/celoOnboarding";

/** After this long waiting on a wallet prompt, remind the player where it is. */
export const SLOW_PROMPT_MS = 15_000;

export interface WalletSetupPanelProps {
  status: SetupStatus;
  failure: SetupFailure | null;
  /** The wallet the player picked, to name it in prompts ("Approve ... in MetaMask"). */
  walletName?: string | null;
  /** A saved connection is being restored after a reload: nothing for the player to approve. */
  restoring?: boolean;
  /** The failure's one action: switch or add again, check again, or connect again. */
  onAction?: () => void;
  onUseDifferentWallet?: () => void;
}

function CheckMark() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

/**
 * The three onboarding stages (Connecting wallet, Setting up Celo, Wallet ready), what is
 * happening now in one line, and, when something needs the player, a plain explanation with
 * one action. Presentation only: the caller passes the state from useNetworkGuard().
 */
export default function WalletSetupPanel({ status, failure, walletName, restoring = false, onAction, onUseDifferentWallet }: WalletSetupPanelProps) {
  const stage = setupStage(status);
  const copy = status === "needs-action" && failure ? FAILURE_COPY[failure] : null;
  const busy = status === "connecting" || status === "checking" || status === "switching" || status === "adding" || status === "verifying";
  const waitingOnWallet = (status === "connecting" && !restoring) || status === "switching" || status === "adding";

  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!waitingOnWallet) return;
    const t = setTimeout(() => setSlow(true), SLOW_PROMPT_MS);
    return () => clearTimeout(t);
  }, [status, waitingOnWallet]);

  const line = setupStatusLine(status, walletName, { restoring });

  return (
    <div className="wallet-setup" data-status={status}>
      <ol className="wallet-setup__stages" aria-label="Wallet setup">
        {SETUP_STAGES.map((label, i) => {
          const done = i < stage || (i === 2 && status === "ready");
          const state = done ? "done" : i === stage ? (copy ? "attention" : "current") : "todo";
          return (
            <li
              key={label}
              className={`wallet-setup__stage wallet-setup__stage--${state}`}
              aria-current={i === stage ? "step" : undefined}
            >
              <span className="wallet-setup__marker" aria-hidden="true">
                {state === "done" ? (
                  <CheckMark />
                ) : state === "current" && busy ? (
                  <span className="wallet-setup__spinner" />
                ) : state === "attention" ? (
                  "!"
                ) : (
                  i + 1
                )}
              </span>
              <span className="wallet-setup__label">{label}</span>
            </li>
          );
        })}
      </ol>

      {line && (
        <p className="wallet-setup__status" role="status" aria-live="polite">
          {line}
        </p>
      )}
      {slow && waitingOnWallet && (
        <p className="wallet-setup__hint">Don't see a request? Open your wallet: it may be waiting there.</p>
      )}

      {copy && (
        <Notice
          tone="warning"
          title={copy.title}
          className="wallet-setup__notice"
          role="alert"
          actions={
            <>
              {onAction && (
                <button type="button" className="btn btn--sm btn--primary wallet-setup__action" onClick={onAction}>
                  {copy.actionLabel}
                </button>
              )}
              {onUseDifferentWallet && copy.action !== "reconnect" && (
                <button type="button" className="btn btn--sm btn--ghost wallet-setup__alt" onClick={onUseDifferentWallet}>
                  Use a different wallet
                </button>
              )}
            </>
          }
        >
          {copy.message}
        </Notice>
      )}
    </div>
  );
}
