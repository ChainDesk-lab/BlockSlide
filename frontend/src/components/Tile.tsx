interface TileProps {
  value: number;
  isNew?: boolean;
  isMerged?: boolean;
}

function fontSizeFor(value: number): string {
  if (value < 100)   return "2.6rem";
  if (value < 1000)  return "2rem";
  if (value < 10000) return "1.5rem";
  return "1.1rem";
}

export default function Tile({ value, isNew, isMerged }: TileProps) {
  if (value === 0) return <div className="tile tile--empty" />;

  const cls = [
    "tile",
    `tile--${value}`,
    isNew    ? "tile--appear"  : "",
    isMerged ? "tile--merge"   : "",
    value === 2048 ? "tile--glow" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} style={{ fontSize: fontSizeFor(value) }}>
      {value}
    </div>
  );
}
