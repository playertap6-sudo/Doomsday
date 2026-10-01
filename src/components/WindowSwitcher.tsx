import { Link } from "@tanstack/react-router";
import { KeyRound, GraduationCap, Radio } from "lucide-react";
import { useSession } from "@/lib/session";

export function WindowSwitcher() {
  const session = useSession();

  // Hide Gateway button and irrelevant windows for authenticated users
  const windows = [
    {
      to: "/" as const,
      label: "Gateway",
      icon: KeyRound,
      show: !session.userId,
    },
    {
      to: "/student" as const,
      label: "Student",
      icon: GraduationCap,
      show: !session.userId || session.role === "student",
    },
    {
      to: "/teacher" as const,
      label: "Teacher",
      icon: Radio,
      show: !session.userId || session.role === "teacher",
    },
  ].filter((w) => w.show);

  // If 1 or fewer windows remain (e.g. authenticated user restricted to their role), hide the switcher
  if (windows.length <= 1) {
    return null;
  }

  return (
    <nav className="glass-strong fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full p-1.5">
      {windows.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact: true }}
          className="flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          activeProps={{ className: "neon-surface !text-primary-foreground" }}
        >
          <Icon className="size-3.5" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
