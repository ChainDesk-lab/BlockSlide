interface StatCardProps {
  label: string;
  value: string | number | null;
  loading?: boolean;
  error?: boolean;
  comingSoon?: boolean;
  icon?: React.ReactNode;
}

export default function StatCard({
  label,
  value,
  loading = false,
  error = false,
  comingSoon = false,
  icon,
}: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="stat-card__header">
        {icon && <span className="stat-card__icon">{icon}</span>}
        <span className="stat-card__label">{label}</span>
      </div>
      <div className="stat-card__value">
        {loading && <div className="stat-card__skeleton" />}
        {error && <span className="stat-card__error">Error</span>}
        {comingSoon && <span className="stat-card__coming-soon">Coming soon</span>}
        {!loading && !error && !comingSoon && (
          <span className={value === null || value === undefined ? "stat-card__empty" : ""}>
            {value ?? "—"}
          </span>
        )}
      </div>
    </div>
  );
}
