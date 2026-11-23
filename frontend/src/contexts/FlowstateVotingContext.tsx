import { createContext, useContext } from "react";
import FlowstateVotingModal from "../components/FlowstateVotingModal";
import { useFlowstateVoting } from "../hooks/useFlowstateVoting";

interface FlowstateVotingContextValue {
  triggerVotingReminder: () => boolean;
  /** The vote pop-up is on screen (lets the next pop-up wait its turn). */
  isOpen: boolean;
}

const FlowstateVotingContext = createContext<FlowstateVotingContextValue>({
  triggerVotingReminder: () => false,
  isOpen: false,
});

export function useFlowstateVotingContext() {
  return useContext(FlowstateVotingContext);
}

export function FlowstateVotingProvider({ children }: { children: React.ReactNode }) {
  const { shouldShow, triggerVotingReminder, dismissForWeek, close, voteUrl } = useFlowstateVoting();

  return (
    <FlowstateVotingContext.Provider value={{ triggerVotingReminder, isOpen: shouldShow }}>
      {children}
      {shouldShow && (
        <FlowstateVotingModal
          onClose={close}
          onDismissWeek={dismissForWeek}
          voteUrl={voteUrl}
        />
      )}
    </FlowstateVotingContext.Provider>
  );
}
