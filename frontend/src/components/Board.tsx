import { GameState } from "../lib/gameLogic";
import Tile from "./Tile";

const COMBO_THRESHOLD = 5;

interface BoardProps {
  state: GameState;
}

export default function Board({ state }: BoardProps) {
  const { board, newTiles, mergedTiles, currentCombo = 0, maxCombo = 0 } = state;
  const comboActive = currentCombo >= COMBO_THRESHOLD;

  return (
    <div className="board" aria-label="2048 game board">
      {board.map((value, idx) => (
        <Tile
          key={idx}
          value={value}
          isNew={newTiles.includes(idx)}
          isMerged={mergedTiles.includes(idx)}
        />
      ))}

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
