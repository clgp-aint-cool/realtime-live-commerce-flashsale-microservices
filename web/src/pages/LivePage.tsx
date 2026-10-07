import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, formatVnd, LiveDetail, LiveProduct, Order } from '../api';
import { ChatComposer, ChatFeed, useChatRoom } from '../components/Chat';
import { BagIcon, CloseIcon, EyeIcon, HeartIcon, PackageIcon, ShareIcon, ShieldIcon } from '../components/Icons';
import { Player } from '../components/Player';
import { PinnedCard, Products } from '../components/Products';
import { auth, useAuth } from '../identity';
import { href } from '../router';
import { avatarColor, compact, initials, LiveBadge } from '../ui';

const POLL_MS = 2000;
const HEART_COLORS = ['#fe2c55', '#ff8a3d', '#ffd23f', '#00c6ff', '#c13cff'];

type Toast = { ok: boolean; text: string; id: number };

// Trang người xem: playbackUrl lấy theo phiên từ /api/lives/:id (không còn cấu hình cố định).
export function LivePage({ sessionId }: { sessionId: string }) {
  const [live, setLive] = useState<LiveDetail | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [pinHidden, setPinHidden] = useState(false);
  const [ended, setEnded] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [alert, setAlert] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [hearts, setHearts] = useState<{ id: number; x: number; color: string }[]>([]);
  const [likes, setLikes] = useState(0);
  const [followed, setFollowed] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const seq = useRef(0);
  const session = useAuth();
  const token = session?.token;

  const notify = useCallback((ok: boolean, text: string) => {
    const id = ++seq.current;
    setToast({ ok, text, id });
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 3500);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const detail = await api.live(sessionId);
      setLive(detail);
      setPinned(detail.pinnedProductId);
      if (detail.status === 'ENDED') setEnded(true);
      setError('');
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? 'Không có phiên live này' : 'Không tải được phiên live');
    }
  }, [sessionId]);

  const refreshOrders = useCallback(async () => {
    if (!token) return setOrders([]);
    const mine = await api.myOrders(token).catch(() => []);
    setOrders(mine.filter((o) => o.sessionId === sessionId));
  }, [sessionId, token]);

  useEffect(() => {
    refresh();
    refreshOrders();
    // MVP: poll tồn kho mỗi 2 giây. Ghim sản phẩm và kết thúc phiên đến tức thì qua socket/timed metadata.
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, refreshOrders]);

  const onPin = useCallback(
    (data: Record<string, unknown>) => {
      if (data.type !== undefined && data.type !== 'pin') return;
      if (data.sessionId !== undefined && data.sessionId !== sessionId) return;
      setPinned(typeof data.productId === 'number' ? data.productId : null);
      setPinHidden(false);
    },
    [sessionId],
  );

  const chat = useChatRoom(sessionId, { onAlert: setAlert, onPin, onSessionEnded: () => setEnded(true) });

  const buy = async (p: LiveProduct) => {
    // Như Shopee Live: phải đăng nhập mới chốt đơn, để đơn gắn với tài khoản.
    if (!token) return auth.requireLogin();
    setBusy(p.id);
    try {
      const order = await api.order(token, sessionId, p.id);
      notify(true, `Đặt thành công đơn #${order.id}: ${p.name}`);
      refresh();
      refreshOrders();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        auth.logout();
        return auth.requireLogin();
      }
      notify(false, err instanceof ApiError ? err.message : 'Không gửi được yêu cầu');
    } finally {
      setBusy(null);
    }
  };

  // Thả tim chỉ hiển thị ở máy người xem (MVP chưa có API đếm tim).
  const like = () => {
    const id = ++seq.current;
    const heart = { id, x: Math.random() * 40 - 20, color: HEART_COLORS[id % HEART_COLORS.length]! };
    setLikes((n) => n + 1);
    setHearts((h) => [...h.slice(-20), heart]);
    setTimeout(() => setHearts((h) => h.filter((x) => x.id !== id)), 1600);
  };

  const share = async () => {
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: live?.title, url });
      else {
        await navigator.clipboard.writeText(url);
        notify(true, 'Đã chép link phiên live');
      }
    } catch {
      // người dùng hủy chia sẻ
    }
  };

  if (error && !live) return <div className="notice err">{error}</div>;
  if (!live) return <p className="muted">Đang tải…</p>;

  const pinnedProduct = live.products.find((p) => p.id === pinned);
  const buyProps = { ended, busy, onBuy: buy };
  const isLive = live.streamState === 'LIVE';

  return (
    <main className="watch">
      <section className="stage">
        <div className="stage-video">
          <Player playbackUrl={live.playbackUrl} onMetadata={onPin} />

          <div className="ov-top">
            <div className="host">
              <span className="host-avatar" style={{ background: avatarColor(live.seller.id) }}>
                {initials(live.seller.name)}
              </span>
              <span className="host-text">
                <strong>{live.seller.name}</strong>
                <small>{compact(likes)} lượt thích</small>
              </span>
              <button className={followed ? 'follow done' : 'follow'} onClick={() => setFollowed((f) => !f)}>
                {followed ? 'Đã theo dõi' : '+ Theo dõi'}
              </button>
            </div>
            <div className="ov-top-right">
              <LiveBadge live={isLive} />
              <span className="pill">
                <EyeIcon size={14} /> {compact(live.viewerCount)}
              </span>
              <a className="icon-btn glass" href={href.lives} aria-label="Đóng">
                <CloseIcon />
              </a>
            </div>
          </div>
          <div className="ov-title">{live.title}</div>

          {alert && (
            <div className="ov-alert" role="alert">
              <ShieldIcon size={16} /> {alert}
              <button className="icon-btn" onClick={() => setAlert('')} aria-label="Đóng">
                <CloseIcon size={14} />
              </button>
            </div>
          )}
          {ended && <div className="ov-ended">Phiên live đã kết thúc</div>}
          {toast && <div className={toast.ok ? 'toast ok' : 'toast err'}>{toast.text}</div>}

          <div className="ov-bottom">
            <ChatFeed chat={chat} />
            {pinnedProduct && !pinHidden && <PinnedCard p={pinnedProduct} onClose={() => setPinHidden(true)} {...buyProps} />}
          </div>

          <div className="ov-rail">
            <button className="rail-btn" onClick={() => setCartOpen((o) => !o)} aria-label="Giỏ hàng">
              <span className="rail-icon bag">
                <BagIcon size={22} />
                <i>{live.products.length}</i>
              </span>
              Giỏ
            </button>
            <button className="rail-btn" onClick={like} aria-label="Thả tim">
              <span className="rail-icon">
                <HeartIcon size={22} fill="currentColor" />
              </span>
              {compact(likes)}
            </button>
            <button className="rail-btn" onClick={share} aria-label="Chia sẻ">
              <span className="rail-icon">
                <ShareIcon size={22} />
              </span>
              Chia sẻ
            </button>
            <div className="hearts" aria-hidden>
              {hearts.map((h) => (
                <span key={h.id} style={{ color: h.color, ['--x' as string]: `${h.x}px` }}>
                  <HeartIcon size={26} fill="currentColor" stroke="none" />
                </span>
              ))}
            </div>
          </div>
        </div>
        <ChatComposer chat={chat} />
      </section>

      <aside className={cartOpen ? 'side open' : 'side'}>
        <button className="drawer-close" onClick={() => setCartOpen(false)} aria-label="Đóng giỏ hàng" />
        <Products products={live.products} pinnedProductId={pinned} {...buyProps} />
        {orders.length > 0 && (
          <section className="my-orders">
            <header>
              <PackageIcon /> Đơn của bạn <span className="count">{orders.length}</span>
            </header>
            {orders.map((o) => {
              const p = live.products.find((x) => x.id === o.productId);
              return (
                <div key={o.id} className="order-row">
                  <span>#{o.id}</span>
                  <span className="grow">{p?.name ?? `Sản phẩm ${o.productId}`}</span>
                  {p && <span className="price">{formatVnd(p.price * o.quantity)}</span>}
                  <span className="status">{o.status}</span>
                </div>
              );
            })}
          </section>
        )}
      </aside>
    </main>
  );
}
