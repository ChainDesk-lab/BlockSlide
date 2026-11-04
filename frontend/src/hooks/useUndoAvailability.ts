import { UNDO_ENABLED } from "../lib/constants";
import { undoAvailability, type UndoAvailability } from "../lib/undoAvailability";
import { useUndoMode } from "./useUndoMode";

/** Undo availability for this session: the operator switch AND the live contract's support (see lib/undoAvailability). */
export function useUndoAvailability(): UndoAvailability {
  const mode = useUndoMode();
  return undoAvailability({ enabled: UNDO_ENABLED, mode });
}
