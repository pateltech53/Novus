import { GameProvider } from "@/lib/state/GameProvider";

export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return <GameProvider>{children}</GameProvider>;
}
