import { useEffect, useState } from 'react';
import { api, LiveSummary } from '../api';
import { BoltIcon, CloudIcon, EyeIcon, LiveIcon, ServerIcon, ShieldIcon, StoreIcon } from '../components/Icons';
import { href } from '../router';
import { avatarColor, initials, LiveBadge } from '../ui';

const POLL_MS = 5000;

const FEATURES = [
  { icon: <CloudIcon />, title: 'Hạ tầng CMC Cloud', text: 'Kubernetes, tự co giãn theo lượt xem' },
  { icon: <BoltIcon />, title: 'Độ trễ thấp', text: 'Video AWS IVS, ghim sản phẩm tức thì' },
  { icon: <ServerIcon />, title: 'Không bán vượt kho', text: 'Redis Lua trừ kho nguyên tử' },
  { icon: <ShieldIcon />, title: 'Kiểm duyệt tự động', text: 'Cảnh báo nội dung vi phạm' },
];

export function LivesPage() {
  const [lives, setLives] = useState<LiveSummary[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () =>
      api
        .lives()
        .then((l) => {
          setLives(l);
          setError('');
        })
        .catch(() => setError('Không tải được danh sách phiên live'));
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const totalViewers = lives?.reduce((s, l) => s + l.viewerCount, 0) ?? 0;

  return (
    <main>
      <section className="hero">
        <div>
          <span className="hero-kicker">
            <LiveIcon size={14} /> {lives?.length ?? 0} phiên đang live · {totalViewers} người xem
          </span>
          <h1>Săn deal trực tiếp, chốt đơn trong vài giây</h1>
          <p>Xem người bán giới thiệu sản phẩm, chat trực tiếp và bấm mua ngay khi sản phẩm được ghim.</p>
          <a className="btn ghost" href={href.seller}>
            <StoreIcon size={16} /> Mở kênh bán hàng
          </a>
        </div>
        <div className="hero-art" aria-hidden>
          <CloudIcon size={150} strokeWidth={1.2} />
          <span className="hero-bubble b1">🛍️</span>
          <span className="hero-bubble b2">❤️</span>
          <span className="hero-bubble b3">🔥</span>
        </div>
      </section>

      <section className="features">
        {FEATURES.map((f) => (
          <div key={f.title} className="feature">
            <span className="feature-icon">{f.icon}</span>
            <div>
              <strong>{f.title}</strong>
              <span>{f.text}</span>
            </div>
          </div>
        ))}
      </section>

      <h2 className="section-title">
        <LiveIcon /> Đang live
      </h2>
      {error && <div className="notice err">{error}</div>}
      {lives?.length === 0 && (
        <div className="empty">
          <LiveIcon size={40} />
          <p>Chưa có phiên live nào.</p>
          <a className="btn" href={href.seller}>Bắt đầu live ngay</a>
        </div>
      )}
      <div className="live-grid">
        {lives?.map((l) => (
          <a key={l.sessionId} className="live-card" href={href.live(l.sessionId)}>
            <div className="live-thumb" style={{ background: avatarColor(l.seller.id, true) }}>
              <LiveBadge live={l.streamState === 'LIVE'} />
              <span className="viewers">
                <EyeIcon size={13} /> {l.viewerCount}
              </span>
              <span className="thumb-avatar" style={{ background: avatarColor(l.seller.id) }}>
                {initials(l.seller.name)}
              </span>
              <span className="thumb-title">{l.title}</span>
            </div>
            <div className="live-info">
              <span className="mini-avatar" style={{ background: avatarColor(l.seller.id) }}>
                {initials(l.seller.name)}
              </span>
              <span className="muted">{l.seller.name}</span>
            </div>
          </a>
        ))}
      </div>
    </main>
  );
}
