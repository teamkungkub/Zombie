export const reloadAnimation = {
  magazine: { hold: 0.19, removed: 0.43, picked: 0.56, seated: 0.86 },
  shell: { picked: 0.23, align: 0.54, inserted: 0.78, release: 0.82 },
} as const;

function ease(p: number, start: number, end: number) {
  const t = Math.min(1, Math.max(0, (p - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

export function magazineReloadPose(p: number) {
  const { hold, removed, picked, seated } = reloadAnimation.magazine;
  return {
    reach: ease(p, 0, hold) * (1 - ease(p, seated, 1)),
    away: ease(p, hold, removed) * (1 - ease(p, picked, seated)),
    grip: ease(p, 0.09, hold) * (1 - ease(p, seated, 0.97)),
    visible: p <= removed || p >= picked,
  };
}

export function shellReloadPose(p: number) {
  const { picked, align, inserted, release } = reloadAnimation.shell;
  return {
    reach: ease(p, 0, picked) * (1 - ease(p, release, 1)),
    lift: ease(p, picked, align),
    push: ease(p, align, inserted),
    pinch: ease(p, 0.12, picked) * (1 - ease(p, inserted, 0.92)),
    visible: p >= picked && p <= release,
  };
}
