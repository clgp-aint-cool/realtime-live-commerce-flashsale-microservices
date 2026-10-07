import { FormEvent, useState } from "react";
import { api, ApiError } from "../api";
import { CopyIcon, ShieldIcon } from "../components/Icons";
import { href } from "../router";

// Quản trị (MVP): đăng ký người bán => tạo kênh IVS. Token người bán chỉ hiện MỘT lần.
export function AdminPage() {
  const [adminToken, setAdminToken] = useState(
    () => sessionStorage.getItem("lc.adminToken") ?? "",
  );
  const [name, setName] = useState("");
  const [result, setResult] = useState<{ name: string; token: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    sessionStorage.setItem("lc.adminToken", adminToken);
    setBusy(true);
    try {
      const r = await api.registerSeller(adminToken, name.trim());
      setResult({ name: r.seller.name, token: r.token });
      setCopied(false);
      setName("");
      setError("");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Lỗi ${err.status}: ${err.message}`
          : "Lỗi mạng",
      );
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.token);
    setCopied(true);
  };

  return (
    <main className="auth">
      <div className="auth-card">
        <span className="auth-icon">
          <ShieldIcon size={28} />
        </span>
        <h2>Đăng ký người bán</h2>
        <p className="muted">
          Mỗi người bán được cấp một kênh AWS IVS và stream key riêng, tự ghi
          hình bằng recording configuration dùng chung.
        </p>
        <form onSubmit={submit}>
          <input
            type="password"
            placeholder="Admin token (biến ADMIN_TOKEN)"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
          />
          <input
            placeholder="Tên shop, ví dụ: Shop Demo HCM"
            value={name}
            minLength={2}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
          <button disabled={busy || name.trim().length < 2}>
            {busy ? "Đang tạo kênh…" : "Tạo người bán"}
          </button>
        </form>
        {error && <div className="notice err">{error}</div>}
        {result && (
          <div className="token-box">
            <span>
              Đã tạo <b>{result.name}</b>. Token đăng nhập{" "}
              <b>chỉ hiện một lần</b>, hãy gửi riêng cho người bán:
            </span>
            <div className="field">
              <code className="secret">{result.token}</code>
              <button
                className="icon-btn"
                onClick={copy}
                aria-label="Chép token"
              >
                <CopyIcon size={16} />
              </button>
            </div>
            {copied && <span className="small ok-text">Đã chép token</span>}
            <a className="btn" href={href.seller}>
              Mở Creator Studio
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
