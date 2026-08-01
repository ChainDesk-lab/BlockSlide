import dynamic from "next/dynamic";

const ProfileView = dynamic(() => import("./ProfileView"), {
  ssr: false,
  loading: () => <div className="profile-not-found"><div className="profile-not-found__title">Loading...</div></div>,
});

interface PageProps {
  params: {
    identifier: string;
  };
}

export default function ProfilePage({ params }: PageProps) {
  return <ProfileView identifier={params.identifier} />;
}
