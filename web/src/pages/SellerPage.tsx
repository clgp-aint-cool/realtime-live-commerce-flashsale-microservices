import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError, formatVnd, LiveDetail, Product, SellerProfile } from '../api';
import {
  BagIcon, CloudIcon, CopyIcon, DownloadIcon, EyeIcon, ImageIcon, KeyIcon, LiveIcon, LogoutIcon, PackageIcon, PinIcon,
  PlusIcon, RefreshIcon, ServerIcon, StopIcon, StoreIcon, WalletIcon,
} from '../components/Icons';
import { href } from '../router';
import { avatarColor, initials, LiveBadge } from '../ui';

const TOKEN_KEY = 'lc.sellerToken';
const errorText = (err: unknown) => (err instanceof ApiError ? `Lỗi ${err.status}: ${err.message}` : 'Lỗi mạng');

// Trang cá nhân người bán dùng OBS: server/key, tải profile OBS, đặt lại key, mở phiên, ghim sản phẩm.
export function SellerPage() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '');
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [error, setError] = useState('');

  const loadCatalog = useCallback(() => {
    api.myProducts(token).then(setCatalog).catch(() => setCatalog([]));
  }, [token]);

  useEffect(() => {
    if (profile) loadCatalog();
  }, [profile?.id, loadCatalog]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async (t: string) => {
    try {
      setProfile(await api.me(t));
      setError('');
    } catch (err) {
      setProfile(null);
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    if (token) load(token);
    // chỉ chạy khi mở trang với token đã lưu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = (e: FormEvent) => {
    e.preventDefault();
    localStorage.setItem(TOKEN_KEY, token.trim());
    load(token.trim());
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
    setProfile(null);
  };

  if (!profile) {
    return (
      <main className="auth">
        <div className="auth-card">
          <span className="auth-icon">
            <StoreIcon size={28} />
          </span>
          <h2>Creator Studio</h2>
          <p className="muted">Đăng nhập bằng token người bán để lấy cấu hình OBS, mở phiên live và ghim sản phẩm.</p>
          <form onSubmit={login}>
            <input type="password" placeholder="Token người bán (lcs_…)" value={token} onChange={(e) => setToken(e.target.value)} />
            <button disabled={!token.trim()}>Đăng nhập</button>
          </form>
          {error && <div className="notice err">{error}</div>}
          <p className="muted small">
            Chưa có token? Quản trị viên tạo ở trang <a href={href.admin}>Quản trị</a>, token chỉ hiện một lần.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="studio">
      <div className="studio-head">
        <span className="host-avatar big" style={{ background: avatarColor(profile.id) }}>
          {initials(profile.name)}
        </span>
        <div className="grow">
          <span className="eyebrow">Creator Studio</span>
          <h2>{profile.name}</h2>
          <span className="muted small">
            <CloudIcon size={12} /> Kênh IVS riêng · {profile.ivsMode === 'mock' ? 'chế độ mock (local)' : 'AWS IVS'}
          </span>
        </div>
        <button className="btn-secondary" onClick={logout}>
          <LogoutIcon size={16} /> Đăng xuất
        </button>
      </div>
      {profile.ivsMode === 'mock' && (
        <div className="notice info">IVS đang chạy chế độ mock (local): server/key là giả, player phát luồng demo.</div>
      )}
      <div className="studio-grid">
        <SessionPanel token={token} profile={profile} catalog={catalog} onChange={() => load(token)} />
        <StreamSetup token={token} profile={profile} onChange={() => load(token)} />
      </div>
      <ProductManager token={token} profile={profile} catalog={catalog} onAdded={loadCatalog} />
    </main>
  );
}

function StreamSetup({ token, profile, onChange }: { token: string; profile: SellerProfile; onChange: () => void }) {
  const [key, setKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const reveal = () => run(async () => setKey(key ? null : (await api.streamKey(token)).streamKey));
  const writeClipboard = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    setMsg({ ok: true, text: `Đã chép ${label}` });
  };
  const copy = (value: string, label: string) => run(() => writeClipboard(value, label));
  const copyKey = () => run(async () => writeClipboard(key ?? (await api.streamKey(token)).streamKey, 'stream key'));

  const download = () =>
    run(async () => {
      const { name, blob } = await api.obsProfile(token);
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      a.click();
      URL.revokeObjectURL(url);
      setMsg({ ok: true, text: `Đã tải ${name}. Giải nén rồi làm theo DOC-TOI.txt để import vào OBS.` });
    });

  const reset = () => {
    if (!confirm('Đặt lại key sẽ ngắt luồng đang phát và key cũ hết hiệu lực. Tiếp tục?')) return;
    run(async () => {
      const { streamKey } = await api.resetStreamKey(token);
      setKey(streamKey);
      setMsg({ ok: true, text: 'Đã tạo key mới. Cập nhật lại OBS (hoặc tải lại profile).' });
      onChange();
    });
  };

  return (
    <section className="card">
      <h3 className="card-title">
        <ServerIcon /> Cấu hình phát (OBS)
      </h3>
      <label className="field-label">Server</label>
      <div className="field">
        <code>{profile.ingestServer}</code>
        <button className="icon-btn" onClick={() => copy(profile.ingestServer, 'server')} aria-label="Chép server">
          <CopyIcon size={16} />
        </button>
      </div>
      <label className="field-label">
        <KeyIcon size={13} /> Stream key
      </label>
      <div className="field">
        <code data-testid="stream-key">{key ?? (profile.hasStreamKey ? '••••••••••••••••••••' : '(chưa có key)')}</code>
        <button className="link" disabled={busy || !profile.hasStreamKey} onClick={reveal}>{key ? 'Ẩn' : 'Hiện'}</button>
        <button className="icon-btn" disabled={busy || !profile.hasStreamKey} onClick={copyKey} aria-label="Chép stream key">
          <CopyIcon size={16} />
        </button>
      </div>
      <div className="actions">
        <button disabled={busy || !profile.hasStreamKey} onClick={download}>
          <DownloadIcon size={16} /> Tải profile OBS
        </button>
        <button className="btn-secondary" disabled={busy} onClick={reset}>
          <RefreshIcon size={16} /> Đặt lại key
        </button>
      </div>
      <p className="muted small">🔒 Không chia sẻ stream key. Ai có key đều phát được lên kênh của bạn.</p>
      {msg && <div className={msg.ok ? 'notice ok' : 'notice err'}>{msg.text}</div>}
    </section>
  );
}

function SessionPanel({
  token,
  profile,
  catalog,
  onChange,
}: {
  token: string;
  profile: SellerProfile;
  catalog: Product[];
  onChange: () => void;
}) {
  const [live, setLive] = useState<LiveDetail | null>(null);
  const [title, setTitle] = useState('');
  const [stock, setStock] = useState<Record<number, number>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sessionId = profile.currentSessionId;

  useEffect(() => {
    if (!sessionId) return setLive(null);
    const load = () => api.live(sessionId).then(setLive).catch(() => undefined);
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [sessionId]);

  const act = async (fn: () => Promise<string>) => {
    try {
      setMsg({ ok: true, text: await fn() });
    } catch (err) {
      setMsg({ ok: false, text: errorText(err) });
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    const products = Object.entries(stock)
      .filter(([, s]) => s > 0)
      .map(([productId, s]) => ({ productId: Number(productId), stock: s }));
    act(async () => {
      await api.createSession(token, title.trim(), products);
      setTitle('');
      setStock({});
      onChange();
      return 'Đã mở phiên live. Bắt đầu phát từ OBS.';
    });
  };

  const pin = (productId: number | null) =>
    act(async () => {
      const r = await api.pin(token, sessionId!, productId);
      setLive((l) => (l ? { ...l, pinnedProductId: productId } : l));
      const via = r.metadata === 'sent' ? 'timed metadata + chat' : `chat (metadata: ${r.metadata})`;
      return productId === null ? 'Đã bỏ ghim' : `Đã ghim, gửi qua ${via}`;
    });

  const end = () => {
    if (!confirm('Kết thúc phiên? Người xem sẽ không đặt được nữa.')) return;
    act(async () => {
      await api.endSession(token, sessionId!);
      onChange();
      return 'Đã kết thúc phiên';
    });
  };

  if (sessionId) {
    const sold = live?.products.reduce((n, p) => n + Math.max(0, p.initialStock - p.stock), 0) ?? 0;
    const revenue = live?.products.reduce((n, p) => n + Math.max(0, p.initialStock - p.stock) * p.price, 0) ?? 0;
    const viewerUrl = location.origin + '/' + href.live(sessionId);
    return (
      <section className="card session-live">
        <div className="card-head">
          <h3 className="card-title">
            <LiveIcon /> {live?.title ?? '…'}
          </h3>
          {live && (live.streamState === 'LIVE' ? <LiveBadge live /> : <span className="badge">OBS chưa phát</span>)}
        </div>
        <div className="stats">
          <div className="stat">
            <EyeIcon /> <b>{live?.viewerCount ?? 0}</b> <span>người xem</span>
          </div>
          <div className="stat">
            <BagIcon /> <b>{sold}</b> <span>đã bán</span>
          </div>
          <div className="stat">
            <WalletIcon /> <b>{formatVnd(revenue)}</b> <span>doanh thu</span>
          </div>
        </div>
        <div className="field">
          <code>{viewerUrl}</code>
          <a className="link" href={href.live(sessionId)} target="_blank" rel="noreferrer">Mở</a>
        </div>
        <div className="studio-products">
          {live?.products.map((p) => {
            const pinned = live.pinnedProductId === p.id;
            return (
              <div key={p.id} className={pinned ? 'studio-product pinned' : 'studio-product'}>
                <img src={p.imageUrl} alt="" />
                <div className="grow">
                  <strong>{p.name}</strong>
                  <span className="muted small">
                    {formatVnd(p.price)} · còn {p.stock}/{p.initialStock}
                  </span>
                </div>
                {pinned ? (
                  <button className="btn-secondary" onClick={() => pin(null)}>Bỏ ghim</button>
                ) : (
                  <button onClick={() => pin(p.id)}>
                    <PinIcon size={15} /> Ghim
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="actions">
          <button className="danger" onClick={end}>
            <StopIcon size={15} /> Kết thúc phiên
          </button>
        </div>
        {msg && <div className={msg.ok ? 'notice ok' : 'notice err'}>{msg.text}</div>}
      </section>
    );
  }

  const selected = Object.values(stock).filter((s) => s > 0).length;
  return (
    <section className="card">
      <h3 className="card-title">
        <PlusIcon /> Mở phiên live mới
      </h3>
      <form onSubmit={create} className="session-form">
        <input placeholder="Tiêu đề phiên, ví dụ: Xả kho cuối tuần, giảm 50%" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        <span className="field-label">Chọn sản phẩm và số lượng bán trong phiên</span>
        <div className="studio-products">
          {catalog.map((p) => (
            <label key={p.id} className={(stock[p.id] ?? 0) > 0 ? 'studio-product pinned' : 'studio-product'}>
              <img src={p.imageUrl} alt="" />
              <div className="grow">
                <strong>{p.name}</strong>
                <span className="muted small">
                  {formatVnd(p.price)}
                  {p.sellerId === profile.id && <span className="tag">Của shop</span>}
                </span>
              </div>
              <input
                type="number"
                min={0}
                value={stock[p.id] ?? 0}
                onChange={(e) => setStock((s) => ({ ...s, [p.id]: Math.max(0, Number(e.target.value)) }))}
                aria-label={`Số lượng ${p.name}`}
              />
            </label>
          ))}
        </div>
        <button className="go-live" disabled={title.trim().length < 3 || selected === 0}>
          <LiveIcon size={18} /> Bắt đầu phiên live
        </button>
      </form>
      {msg && <div className={msg.ok ? 'notice ok' : 'notice err'}>{msg.text}</div>}
    </section>
  );
}

const EMPTY_PRODUCT = { name: '', price: '', description: '', imageUrl: '' };

// Danh mục riêng của shop: thêm sản phẩm rồi chọn vào phiên live. Sản phẩm dùng chung (seed) không sửa được ở đây.
function ProductManager({
  token,
  profile,
  catalog,
  onAdded,
}: {
  token: string;
  profile: SellerProfile;
  catalog: Product[];
  onAdded: () => void;
}) {
  const [form, setForm] = useState(EMPTY_PRODUCT);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const mine = catalog.filter((p) => p.sellerId === profile.id);
  const price = Number(form.price);
  const valid = form.name.trim().length >= 2 && Number.isInteger(price) && price >= 1000;
  const set = (field: keyof typeof EMPTY_PRODUCT) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const p = await api.addProduct(token, {
        name: form.name.trim(),
        price,
        description: form.description.trim(),
        imageUrl: form.imageUrl.trim(),
      });
      setMsg({ ok: true, text: `Đã thêm "${p.name}". Chọn số lượng ở mục "Mở phiên live mới".` });
      setForm(EMPTY_PRODUCT);
      setOpen(false);
      onAdded();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card product-manager">
      <div className="card-head">
        <h3 className="card-title">
          <PackageIcon /> Sản phẩm của shop <span className="count">{mine.length}</span>
        </h3>
        <button className={open ? 'btn-secondary' : ''} onClick={() => setOpen((o) => !o)}>
          {open ? 'Đóng' : <><PlusIcon size={16} /> Thêm sản phẩm</>}
        </button>
      </div>
      {open && (
        <form className="product-form" onSubmit={submit}>
          <div className="product-preview">
            {/^https?:\/\//.test(form.imageUrl.trim()) ? <img src={form.imageUrl.trim()} alt="" /> : <ImageIcon size={32} />}
          </div>
          <div className="product-fields">
            <input placeholder="Tên sản phẩm *" value={form.name} maxLength={80} onChange={set('name')} />
            <input type="number" placeholder="Giá (₫) *, tối thiểu 1.000" min={1000} step={1000} value={form.price} onChange={set('price')} />
            <input placeholder="Link ảnh https://… (bỏ trống = ảnh ngẫu nhiên)" value={form.imageUrl} maxLength={500} onChange={set('imageUrl')} />
            <textarea placeholder="Mô tả ngắn" value={form.description} maxLength={500} rows={2} onChange={set('description')} />
            <button disabled={busy || !valid}>{busy ? 'Đang lưu…' : 'Lưu sản phẩm'}</button>
          </div>
        </form>
      )}
      {mine.length === 0 && !open && <p className="muted small">Chưa có sản phẩm riêng. Bấm "Thêm sản phẩm" để bán hàng của bạn trong live.</p>}
      <div className="product-grid">
        {mine.map((p) => (
          <div key={p.id} className="product-tile">
            <img src={p.imageUrl} alt="" loading="lazy" />
            <strong>{p.name}</strong>
            <span className="price">{formatVnd(p.price)}</span>
            {p.description && <span className="muted small clamp">{p.description}</span>}
          </div>
        ))}
      </div>
      {msg && <div className={msg.ok ? 'notice ok' : 'notice err'}>{msg.text}</div>}
    </section>
  );
}
