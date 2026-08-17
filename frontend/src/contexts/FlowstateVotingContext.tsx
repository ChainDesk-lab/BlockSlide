import { createContext, useContext } from "react";
import FlowstateVotingModal from "../components/FlowstateVotingModal";
import { useFlowstateVoting } from "../hooks/useFlowstateVoting";

interface FlowstateVotingContextValue {
  triggerVotingReminder: () => boolean;
}

const FlowstateVotingContext = createContext<FlowstateVotingContextValue>({
  triggerVotingReminder: () => false,
});

export function useFlowstateVotingContext() {
  return useContext(FlowstateVotingContext);
}

export function FlowstateVotingProvider({ children }: { children: React.ReactNode }) {
  const { shouldShow, triggerVotingReminder, dismissForWeek, close, voteUrl } = useFlowstateVoting();

  return (
    <FlowstateVotingContext.Provider value={{ triggerVotingReminder }}>
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
