const STARS = Array.from({ length: 70 }, (_, i) => ({
  top: `${(i * 37) % 100}%`,
  left: `${(i * 61) % 100}%`,
  size: (i % 3) + 1,
  delay: `${(i % 9) * 0.6}s`,
}));

/** Midnight ambient backdrop: lighting orbs, orbital constellations, glass nodes. */
export function SpaceBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background">
      <div className="absolute -top-40 -left-32 h-[36rem] w-[36rem] animate-drift rounded-full bg-cyan/20 blur-[140px]" />
      <div className="absolute top-1/3 -right-40 h-[40rem] w-[40rem] animate-drift rounded-full bg-violet/25 blur-[150px] [animation-delay:-6s]" />
      <div className="absolute -bottom-52 left-1/3 h-[32rem] w-[32rem] animate-drift rounded-full bg-emerald/15 blur-[150px] [animation-delay:-12s]" />

      {STARS.map((s, i) => (
        <span
          key={i}
          className="absolute animate-twinkle rounded-full bg-foreground/70"
          style={{
            top: s.top,
            left: s.left,
            width: s.size,
            height: s.size,
            animationDelay: s.delay,
          }}
        />
      ))}

      <div className="absolute top-1/2 left-1/2 h-[52rem] w-[52rem] -translate-x-1/2 -translate-y-1/2 animate-orbit">
        {[0, 1, 2].map((r) => (
          <div
            key={r}
            className="absolute inset-0 rounded-full border border-border"
            style={{
              transform: `rotateX(${68 + r * 6}deg) rotateZ(${r * 30}deg) scale(${1 - r * 0.22})`,
              opacity: 0.5 - r * 0.12,
            }}
          >
            <span className="absolute -top-1 left-1/2 h-2.5 w-2.5 rounded-full bg-cyan shadow-[0_0_18px_var(--neon-cyan)]" />
            <span className="absolute top-1/2 -right-1 h-2 w-2 rounded-full bg-violet shadow-[0_0_18px_var(--neon-violet)]" />
          </div>
        ))}
      </div>

      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,var(--background)_92%)]" />
    </div>
  );
}
