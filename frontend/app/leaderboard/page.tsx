import dynamic from "next/dynamic";

const LeaderboardPage = dynamic(
  () => import("../../src/components/LeaderboardPage"),
  { ssr: false },
);

export default function LeaderboardRoute() {
  return <LeaderboardPage />;
}
