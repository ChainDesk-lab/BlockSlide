import { useState } from "react";
import { CoinIcon } from "./icons";
import { IconBadge } from "./IconBadge";

// GoodDollar UBI claim page. Change this if you prefer a different claim URL.
const CLAIM_URL = "https://wallet.gooddollar.org/";
const STORAGE_KEY = "blockslide_gd_claim_visited";

// Local calendar day as YYYY-M-D — the "visited today" check compares against
// this, so the indicator naturally resets when the date rolls over.
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export default function DailyClaim() {
  const [visitedToday, setVisitedToday] = useState(
    () => localStorage.getItem(STORAGE_KEY) === todayStr(),
  );

  const handleClaim = () => {
    localStorage.setItem(STORAGE_KEY, todayStr());
    setVisitedToday(true);
    window.open(CLAIM_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <section className="daily-claim">
      <div className="daily-claim__info">
        <IconBadge icon={<CoinIcon size={22} />} size="lg" />
        <div className="daily-claim__text">
          <h3 className="daily-claim__title">Claim Daily G$</h3>
          <p className={`daily-claim__status ${visitedToday ? "daily-claim__status--done" : ""}`}>
            {visitedToday
              ? "✓ You visited the claim page today"
              : "Claim your UBI on GoodDollar"}
          </p>
        </div>
      </div>
      <button className="btn btn--primary" onClick={handleClaim}>
        Claim Daily G$
      </button>
    </section>
  );
}
