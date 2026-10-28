import { createContext, useCallback, useContext, useState } from "react";
import GasNeededModal from "../components/GasNeededModal";

interface NoGasContextValue {
  /**
   * Open the "Gas needed" modal — call when a tx fails for insufficient gas.
   * Pass the transaction's requirement (from lib/gasPlan.ts) when known, so
   * "I've topped up" checks against it rather than a default budget.
   */
  triggerNoGas: (requiredWei?: bigint) => void;
}

const NoGasContext = createContext<NoGasContextValue>({ triggerNoGas: () => {} });

export function useNoGas() {
  return useContext(NoGasContext);
}

export function NoGasProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [requiredWei, setRequiredWei] = useState<bigint | undefined>(undefined);
  const triggerNoGas = useCallback((needed?: bigint) => {
    setRequiredWei(needed);
    setOpen(true);
  }, []);

  return (
    <NoGasContext.Provider value={{ triggerNoGas }}>
      {children}
      {open && <GasNeededModal requiredWei={requiredWei} onClose={() => setOpen(false)} />}
    </NoGasContext.Provider>
  );
}
