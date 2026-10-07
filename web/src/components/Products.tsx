import { formatVnd, LiveProduct } from '../api';
import { BagIcon, CloseIcon, FireIcon, PinIcon } from './Icons';

interface BuyProps {
  ended: boolean;
  busy: number | null;
  onBuy: (p: LiveProduct) => void;
}

function BuyButton({ p, ended, busy, onBuy, small }: BuyProps & { p: LiveProduct; small?: boolean }) {
  const soldOut = p.stock <= 0;
  return (
    <button className={small ? 'buy small' : 'buy'} disabled={ended || soldOut || busy === p.id} onClick={() => onBuy(p)}>
      {ended ? 'Đã kết thúc' : soldOut ? 'Hết hàng' : busy === p.id ? 'Đang đặt…' : 'Mua ngay'}
    </button>
  );
}

function StockBar({ p }: { p: LiveProduct }) {
  const sold = Math.max(0, p.initialStock - p.stock);
  const pct = p.initialStock ? (p.stock / p.initialStock) * 100 : 0;
  return (
    <div className="stockbar" title={`Còn ${p.stock}/${p.initialStock}`}>
      <div className="stockbar-fill" style={{ width: `${100 - pct}%` }} />
      <span>
        {p.stock <= 0 ? 'Đã bán hết' : pct <= 20 ? <><FireIcon size={11} /> Sắp hết · còn {p.stock}</> : `Đã bán ${sold} · còn ${p.stock}`}
      </span>
    </div>
  );
}

// Thẻ sản phẩm đang ghim nổi trên video (kiểu Shopee Live).
export function PinnedCard({ p, onClose, ...buy }: BuyProps & { p: LiveProduct; onClose: () => void }) {
  return (
    <div className="pinned-card" data-testid={`pinned-${p.id}`}>
      <span className="pinned-tag">
        <PinIcon size={12} /> Đang giới thiệu
      </span>
      <button className="pinned-close" onClick={onClose} aria-label="Ẩn">
        <CloseIcon size={14} />
      </button>
      <img src={p.imageUrl} alt={p.name} />
      <div className="pinned-body">
        <strong>{p.name}</strong>
        <span className="price">{formatVnd(p.price)}</span>
        <StockBar p={p} />
      </div>
      <BuyButton p={p} small {...buy} />
    </div>
  );
}

// Giỏ hàng của phiên live: danh sách đánh số như Shopee Live, sản phẩm đang ghim lên đầu.
export function Products({ products, pinnedProductId, ...buy }: BuyProps & { products: LiveProduct[]; pinnedProductId: number | null }) {
  const sorted = [...products].sort((a, b) => Number(b.id === pinnedProductId) - Number(a.id === pinnedProductId));
  return (
    <section className="cart-list">
      <header>
        <BagIcon /> Giỏ hàng live <span className="count">{products.length}</span>
      </header>
      {sorted.map((p) => {
        const index = products.indexOf(p) + 1;
        const pinned = p.id === pinnedProductId;
        return (
          <article key={p.id} className={pinned ? 'cart-item pinned' : 'cart-item'} data-testid={`product-${p.id}`}>
            <div className="cart-thumb">
              <img src={p.imageUrl} alt={p.name} loading="lazy" />
              <span className="cart-index">{index}</span>
              {pinned && (
                <span className="cart-pin">
                  <PinIcon size={11} /> Đang ghim
                </span>
              )}
            </div>
            <div className="cart-body">
              <strong>{p.name}</strong>
              <span className="muted small clamp">{p.description}</span>
              <span className="price">{formatVnd(p.price)}</span>
              <StockBar p={p} />
            </div>
            <BuyButton p={p} small {...buy} />
          </article>
        );
      })}
    </section>
  );
}
