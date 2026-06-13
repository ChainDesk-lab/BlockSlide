import { GameState } from "../lib/gameLogic";
import Tile from "./Tile";

interface BoardProps {
  state: GameState;
}

export default function Board({ state }: BoardProps) {
  const { board, newTiles, mergedTiles } = state;

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
    </div>
  );
}
