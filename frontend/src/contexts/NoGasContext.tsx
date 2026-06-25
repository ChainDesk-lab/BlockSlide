import { createContext, useCallback, useContext, useState } from "react";
import GasNeededModal from "../components/GasNeededModal";

interface NoGasContextValue {
  /** Open the "Gas needed" modal — call when a tx fails for insufficient gas. */
  triggerNoGas: () => void;
}

const NoGasContext = createContext<NoGasContextValue>({ triggerNoGas: () => {} });

export function useNoGas() {
  return useContext(NoGasContext);
}

export function NoGasProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const triggerNoGas = useCallback(() => setOpen(true), []);

  return (
    <NoGasContext.Provider value={{ triggerNoGas }}>
      {children}
      {open && <GasNeededModal onClose={() => setOpen(false)} />}
    </NoGasContext.Provider>
  );
}
