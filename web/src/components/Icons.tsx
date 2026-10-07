import { SVGProps } from 'react';

// Bộ icon SVG nội tuyến (stroke 2px, kế thừa currentColor) để không phải thêm thư viện icon.
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = ({ size = 18, ...rest }: IconProps) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...rest,
});

export const CloudIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M17.5 19H8a5 5 0 1 1 .9-9.92A6 6 0 0 1 20 11.5a3.75 3.75 0 0 1-2.5 7.5Z" /></svg>
);
export const LiveIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="2" />
    <path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" />
  </svg>
);
export const EyeIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
);
export const HeartIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" /></svg>
);
export const BagIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18M16 10a4 4 0 0 1-8 0" /></svg>
);
export const PinIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 17v5M9 10.76V6h6v4.76l2 3.24H7Z" /><path d="M8 2h8" /></svg>
);
export const SendIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
);
export const StoreIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="m2 7 2-4h16l2 4M2 7h20v3a3 3 0 0 1-5 2 3 3 0 0 1-5 0 3 3 0 0 1-5 0 3 3 0 0 1-5-2Z" /><path d="M4 12v9h16v-9M9 21v-5h6v5" /></svg>
);
export const KeyIcon = (p: IconProps) => (
  <svg {...base(p)}><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" /></svg>
);
export const CopyIcon = (p: IconProps) => (
  <svg {...base(p)}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
);
export const DownloadIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
);
export const RefreshIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5" /></svg>
);
export const ShieldIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></svg>
);
export const ServerIcon = (p: IconProps) => (
  <svg {...base(p)}><rect x="2" y="3" width="20" height="8" rx="2" /><rect x="2" y="13" width="20" height="8" rx="2" /><path d="M6 7h.01M6 17h.01" /></svg>
);
export const BoltIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M13 2 3 14h9l-1 8 10-12h-9Z" /></svg>
);
export const ShareIcon = (p: IconProps) => (
  <svg {...base(p)}><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></svg>
);
export const CloseIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M18 6 6 18M6 6l12 12" /></svg>
);
export const FireIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14 0-5 3-7 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5Z" /></svg>
);
export const UsersIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
);
export const PackageIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M21 8 12 3 3 8v8l9 5 9-5Z" /><path d="m3 8 9 5 9-5M12 13v8" /></svg>
);
export const WalletIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2" /><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" /></svg>
);
export const LogoutIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
);
export const StopIcon = (p: IconProps) => (
  <svg {...base(p)}><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
);
export const PlusIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
);

// Logo: đám mây CMC Cloud ôm nút play, gradient xanh thương hiệu.
export const UserIcon = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
);
export const LockIcon = (p: IconProps) => (
  <svg {...base(p)}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
);
export const ImageIcon = (p: IconProps) => (
  <svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>
);

export function BrandLogo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <defs>
        <linearGradient id="brand-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1f6bff" />
          <stop offset="1" stopColor="#00c6ff" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#brand-g)" />
      <path d="M28.5 28H13a6 6 0 1 1 1.3-11.86A7.5 7.5 0 0 1 28.4 18a5 5 0 0 1 .1 10Z" fill="#fff" opacity=".95" />
      <path d="m18 18.5 6 3.5-6 3.5Z" fill="#fe2c55" />
    </svg>
  );
}
