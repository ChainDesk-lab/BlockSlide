import type { CSSProperties } from "react";
import { Direction, GameState } from "../lib/gameLogic";
import { SLIDE_MS, SPAWN_STAGGER_MS } from "../lib/tileTracker";
import { useAnimatedTiles } from "../hooks/useAnimatedTiles";
import Tile from "./Tile";

const COMBO_THRESHOLD = 5;
const WELLS = Array.from({ length: 16 }, (_, i) => i);

interface BoardProps {
  state: GameState;
  /** Direction of the move that produced `state` — drives the slide animation. */
  lastDirection: Direction | null;
}

export default function Board({ state, lastDirection }: BoardProps) {
  const { currentCombo = 0, maxCombo = 0 } = state;
  const comboActive = currentCombo >= COMBO_THRESHOLD;

  const { liveTiles, ghosts, dismissGhost, reducedMotion } = useAnimatedTiles(
    state,
    lastDirection,
  );

  return (
    <div className="board" aria-label="2048 game board">
      {/* Static background cells — the checkerboard the tiles slide over. */}
      {WELLS.map((i) => (
        <div key={i} className="tile tile--empty" />
      ))}

      {/* Animated layer: absolutely positioned, one element per tile id. */}
      <div
        className="tile-layer"
        style={{ "--slide-ms": `${SLIDE_MS}ms` } as CSSProperties}
      >
        {ghosts.map((g) => (
          <Tile
            key={g.id}
            value={g.value}
            row={g.row}
            col={g.col}
            isGhost
            onTransitionEnd={() => dismissGhost(g.id)}
          />
        ))}
        {liveTiles.map((t) => (
          <Tile
            key={t.id}
            value={t.value}
            row={t.row}
            col={t.col}
            isNew={t.isNew}
            isMerged={t.isMerged}
            animationDelayMs={
              reducedMotion
                ? 0
                : t.isMerged
                  ? SLIDE_MS
                  : t.isNew
                    ? SPAWN_STAGGER_MS
                    : 0
            }
          />
        ))}
      </div>

      {/* Combo indicator — appears when streak >= 2 */}
      {currentCombo >= 2 && (
        <div className={`combo-badge ${comboActive ? "combo-badge--active" : ""}`}>
          <span className="combo-badge__count">{currentCombo}x</span>
          <span className="combo-badge__label">
            {comboActive ? "5x XP!" : `combo (${COMBO_THRESHOLD - currentCombo} to 5x XP)`}
          </span>
          {maxCombo >= COMBO_THRESHOLD && currentCombo < COMBO_THRESHOLD && (
            <span className="combo-badge__best">best {maxCombo}x</span>
          )}
        </div>
      )}
    </div>
  );
}
