import { useEffect, useState } from 'react';
import { api, ApiError, formatVnd, IMAGE_TYPES, Order, Product, uploadImage } from '../api';
import { ImageIcon, LogoutIcon, PackageIcon } from '../components/Icons';
import { auth, useAuth } from '../identity';
import { href } from '../router';
import { Avatar } from '../ui';

// Lịch sử đơn của tài khoản đang đăng nhập (mọi phiên live).
export function OrdersPage() {
  const session = useAuth();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [products, setProducts] = useState<Map<number, Product>>(new Map());
  const [error, setError] = useState('');
  const [avatarMsg, setAvatarMsg] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!session) return;
    Promise.all([api.myOrders(session.token), api.products()])
      .then(([o, p]) => {
        setOrders(o);
        setProducts(new Map(p.map((x) => [x.id, x])));
      })
      .catch(() => setError('Không tải được đơn hàng'));
  }, [session]);

  // Avatar người mua: upload lên S3, auth-service chỉ lưu URL.
  const pickAvatar = async (file: File | undefined) => {
    if (!file || !session) return;
    setUploading(true);
    try {
      const url = await uploadImage(file, (f) => api.userAvatarUpload(session.token, f));
      const user = await api.setUserAvatar(session.token, url);
      auth.set({ token: session.token, user });
      setAvatarMsg('');
    } catch (err) {
      setAvatarMsg(err instanceof ApiError ? `Lỗi ${err.status}: ${err.message}` : 'Lỗi mạng');
    } finally {
      setUploading(false);
    }
  };

  if (!session) {
    return (
      <div className="empty">
        <button onClick={() => auth.requireLogin()}>Đăng nhập</button> để xem đơn hàng của bạn.
      </div>
    );
  }
  if (error) return <div className="notice err">{error}</div>;
  if (!orders) return <p className="muted">Đang tải…</p>;

  const total = orders.reduce((n, o) => n + (products.get(o.productId)?.price ?? 0) * o.quantity, 0);

  return (
    <main className="orders-page">
      <div className="card">
        <div className="card-head">
          <h3 className="card-title">
            <PackageIcon /> Đơn hàng của tôi <span className="count">{orders.length}</span>
          </h3>
          <button className="btn-secondary" onClick={() => auth.logout()}>
            <LogoutIcon size={16} /> Đăng xuất
          </button>
        </div>
        <div className="account-head">
          <label className={uploading ? 'avatar-upload busy' : 'avatar-upload'} title="Đổi ảnh đại diện">
            <Avatar className="host-avatar big" id={session.user.id} name={session.user.displayName} url={session.user.avatarUrl} />
            <span className="avatar-edit"><ImageIcon size={14} /></span>
            <input type="file" accept={IMAGE_TYPES.join(',')} hidden disabled={uploading} onChange={(e) => pickAvatar(e.target.files?.[0])} />
          </label>
          <p className="muted small">
            {session.user.displayName} (@{session.user.username}) · tổng chi tiêu {formatVnd(total)}
          </p>
        </div>
        {avatarMsg && <div className="notice err">{avatarMsg}</div>}
        {orders.length === 0 && (
          <div className="empty">
            Chưa có đơn nào. <a href={href.lives}>Vào xem live</a> và bấm "Mua ngay" nhé.
          </div>
        )}
        {orders.map((o) => {
          const p = products.get(o.productId);
          return (
            <a key={o.id} className="order-card" href={href.live(o.sessionId)}>
              {p && <img src={p.imageUrl} alt="" />}
              <span className="grow">
                <strong>{p?.name ?? `Sản phẩm ${o.productId}`}</strong>
                <span className="muted small">
                  Đơn #{o.id} · {new Date(o.createdAt).toLocaleString('vi-VN')} · SL {o.quantity}
                </span>
              </span>
              {p && <span className="price">{formatVnd(p.price * o.quantity)}</span>}
              <span className="status">{o.status}</span>
            </a>
          );
        })}
      </div>
    </main>
  );
}
