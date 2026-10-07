import { useEffect, useState } from 'react';
import { api, formatVnd, Order, Product } from '../api';
import { LogoutIcon, PackageIcon } from '../components/Icons';
import { auth, useAuth } from '../identity';
import { href } from '../router';

// Lịch sử đơn của tài khoản đang đăng nhập (mọi phiên live).
export function OrdersPage() {
  const session = useAuth();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [products, setProducts] = useState<Map<number, Product>>(new Map());
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session) return;
    Promise.all([api.myOrders(session.token), api.products()])
      .then(([o, p]) => {
        setOrders(o);
        setProducts(new Map(p.map((x) => [x.id, x])));
      })
      .catch(() => setError('Không tải được đơn hàng'));
  }, [session]);

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
        <p className="muted small">
          {session.user.displayName} (@{session.user.username}) · tổng chi tiêu {formatVnd(total)}
        </p>
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
