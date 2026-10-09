import { useEffect } from 'react';
import { BrandLogo, CloudIcon, LiveIcon, ShieldIcon, StoreIcon, UserIcon } from './components/Icons';
import { auth, useAuth } from './identity';
import { AdminPage } from './pages/AdminPage';
import { AuthPage } from './pages/AuthPage';
import { LivePage } from './pages/LivePage';
import { LivesPage } from './pages/LivesPage';
import { OrdersPage } from './pages/OrdersPage';
import { SellerPage } from './pages/SellerPage';
import { href, useRoute } from './router';
import { Avatar } from './ui';

export function App() {
  const route = useRoute();
  const session = useAuth();
  useEffect(() => {
    auth.refresh();
  }, []);
  const active = (page: string) => (route.page === page || (page === 'lives' && route.page === 'live') ? 'active' : '');
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href={href.lives}>
          <BrandLogo />
          <span>
            <strong>CMC Live</strong>
            <small>
              <CloudIcon size={12} /> powered by CMC Cloud
            </small>
          </span>
        </a>
        <nav>
          <a className={active('lives')} href={href.lives}>
            <LiveIcon size={16} /> Đang live
          </a>
          <a className={active('admin')} href={href.admin}>
            <ShieldIcon size={16} /> Quản trị
          </a>
          <a className={`cta ${active('seller')}`} href={href.seller}>
            <StoreIcon size={16} /> <span className="label-full">Kênh người bán</span>
            <span className="label-short">Bán hàng</span>
          </a>
          {session ? (
            <a className={`account ${active('orders')}`} href={href.orders} title="Đơn hàng của tôi">
              <Avatar className="account-avatar" id={session.user.id} name={session.user.displayName} url={session.user.avatarUrl} />
              <span className="account-name">{session.user.displayName}</span>
            </a>
          ) : (
            <a className={active('login')} href={href.login} onClick={() => route.page !== 'login' && auth.requireLogin()}>
              <UserIcon size={16} /> Đăng nhập
            </a>
          )}
        </nav>
      </header>
      {route.page === 'lives' && <LivesPage />}
      {route.page === 'live' && <LivePage key={route.sessionId} sessionId={route.sessionId} />}
      {route.page === 'seller' && <SellerPage />}
      {route.page === 'admin' && <AdminPage />}
      {route.page === 'login' && <AuthPage />}
      {route.page === 'orders' && <OrdersPage />}
      <footer className="footer">
        <CloudIcon size={14} /> CMC Live Commerce · Kubernetes trên CMC Cloud · Video AWS IVS
      </footer>
    </div>
  );
}
