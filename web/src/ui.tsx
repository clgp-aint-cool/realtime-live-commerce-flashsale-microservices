// Tiện ích giao diện dùng chung: avatar chữ cái, màu theo id, huy hiệu LIVE.

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

const PALETTE = [
  ['#1f6bff', '#00c6ff'],
  ['#fe2c55', '#ff8a3d'],
  ['#7b5cff', '#00c6ff'],
  ['#00b386', '#1f6bff'],
  ['#ff5a36', '#ffb800'],
  ['#c13cff', '#fe2c55'],
];

// Màu ổn định theo id (cùng người bán luôn cùng màu). soft = nền thumbnail tươi có vệt sáng.
export function avatarColor(id: string, soft = false) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [a, b] = PALETTE[h % PALETTE.length]!;
  return soft
    ? `radial-gradient(circle at 30% 20%, #ffffff59, transparent 55%), linear-gradient(160deg, ${a}, ${b})`
    : `linear-gradient(135deg, ${a}, ${b})`;
}

export function LiveBadge({ live, viewers }: { live: boolean; viewers?: number }) {
  if (!live) return <span className="badge">Chưa phát</span>;
  return (
    <span className="badge live">
      <span className="eq" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      LIVE{viewers !== undefined && <span className="badge-sub">{viewers}</span>}
    </span>
  );
}

export const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
