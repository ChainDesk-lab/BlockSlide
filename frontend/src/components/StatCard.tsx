interface StatCardProps {
  label: string;
  value: string | number | null;
  loading?: boolean;
  error?: boolean;
  comingSoon?: boolean;
  icon?: React.ReactNode;
  /** Caption under the value. */
  note?: string;
  /** Render the value muted: it is a status ("Unavailable"), not a number. */
  muted?: boolean;
  /** Tooltip on the value. */
  title?: string;
}

export default function StatCard({
  label,
  value,
  loading = false,
  error = false,
  comingSoon = false,
  icon,
  note,
  muted = false,
  title,
}: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="stat-card__header">
        {icon && <span className="stat-card__icon">{icon}</span>}
        <span className="stat-card__label">{label}</span>
      </div>
      <div className="stat-card__value" title={title}>
        {loading && <div className="stat-card__skeleton" />}
        {error && <span className="stat-card__error">Error</span>}
        {comingSoon && <span className="stat-card__coming-soon">Coming soon</span>}
        {!loading && !error && !comingSoon && (
          <span className={value === null || value === undefined || muted ? "stat-card__empty" : ""}>
            {value ?? "—"}
          </span>
        )}
      </div>
      {note && <p className="stat-card__note">{note}</p>}
    </div>
  );
}
