import { FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import { BagIcon, CloudIcon, LockIcon, UserIcon } from '../components/Icons';
import { auth } from '../identity';

type Mode = 'login' | 'register';

// Đăng nhập / đăng ký tài khoản người mua. Xong thì quay lại trang đang xem (vd. phiên live vừa bấm "Mua ngay").
export function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const session =
        mode === 'login'
          ? await api.login(username.trim(), password)
          : await api.register(username.trim(), password, displayName.trim());
      auth.set(session);
      location.hash = auth.takeReturnTo();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Lỗi mạng');
    } finally {
      setBusy(false);
    }
  };

  const switchTo = (m: Mode) => {
    setMode(m);
    setError('');
  };

  const valid = /^[a-z0-9_.]{3,32}$/i.test(username.trim()) && password.length >= 8;

  return (
    <main className="auth">
      <div className="auth-card">
        <span className="auth-icon">
          <BagIcon size={28} />
        </span>
        <h2>{mode === 'login' ? 'Đăng nhập để mua sắm' : 'Tạo tài khoản CMC Live'}</h2>
        <p className="muted">Đơn hàng được lưu vào tài khoản, xem lại được trên mọi thiết bị.</p>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => switchTo('login')}>
            Đăng nhập
          </button>
          <button role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => switchTo('register')}>
            Đăng ký
          </button>
        </div>
        <form onSubmit={submit}>
          <label className="input-icon">
            <UserIcon size={16} />
            <input
              placeholder="Tên đăng nhập"
              autoComplete="username"
              value={username}
              maxLength={32}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
            />
          </label>
          {mode === 'register' && (
            <label className="input-icon">
              <UserIcon size={16} />
              <input placeholder="Tên hiển thị trong chat (tùy chọn)" value={displayName} maxLength={32} onChange={(e) => setDisplayName(e.target.value)} />
            </label>
          )}
          <label className="input-icon">
            <LockIcon size={16} />
            <input
              type="password"
              placeholder={mode === 'register' ? 'Mật khẩu (ít nhất 8 ký tự)' : 'Mật khẩu'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              maxLength={128}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="go-live" disabled={busy || !valid}>
            {busy ? 'Đang xử lý…' : mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
          </button>
        </form>
        {error && <div className="notice err">{error}</div>}
        {mode === 'register' && <p className="muted small">Tên đăng nhập: 3-32 ký tự, chữ thường, số, dấu _ hoặc dấu chấm.</p>}
        <p className="muted small">
          <CloudIcon size={12} /> Mật khẩu được băm scrypt, không lưu dạng gốc.
        </p>
      </div>
    </main>
  );
}
