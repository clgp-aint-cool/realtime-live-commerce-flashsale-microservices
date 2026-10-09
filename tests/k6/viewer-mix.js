// Tải người xem phiên live: mỗi VU = 1 người xem, làm đúng việc trình duyệt làm.
//   - vào trang danh sách: GET /api/lives
//   - mở 1 phiên: GET /api/lives/:id, sau đó poll lại mỗi 2 giây (LivePage POLL_MS)
//   - thỉnh thoảng xem sản phẩm: GET /api/products
//   - BUY_RATE (mặc định 0.02) xác suất bấm mua mỗi vòng: POST /api/orders (201 hoặc 409 đều hợp lệ)
// Không gọi IVS, không tạo người bán: dùng các phiên demo (scripts/seed-demo.cjs) hoặc phiên đang mở.
//
// Chạy (từ máy trong VPC, xem live-commerce-infra/docs/load-testing.md):
//   k6 run -e BASE_URL=https://cmc-cloud-hcm1.cloud -e PROFILE=load -e TARGET=2000 tests/k6/viewer-mix.js
// PROFILE: smoke | load | stress | spike | soak. TARGET = số người xem đồng thời ở đỉnh.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'https://cmc-cloud-hcm1.cloud';
const TARGET = Number(__ENV.TARGET || 500);
const BUY_RATE = Number(__ENV.BUY_RATE || 0.02);
const POLL_S = 2;

const PROFILES = {
  smoke: [{ duration: '1m', target: 10 }],
  load: [
    { duration: '5m', target: TARGET },
    { duration: '15m', target: TARGET },
    { duration: '2m', target: 0 },
  ],
  // Tăng dần tới 3x TARGET để tìm điểm gãy
  stress: [
    { duration: '5m', target: TARGET },
    { duration: '5m', target: TARGET * 2 },
    { duration: '5m', target: TARGET * 3 },
    { duration: '5m', target: TARGET * 3 },
    { duration: '3m', target: 0 },
  ],
  // Flash sale: người bán hô "mở bán", lượng người xem x10 trong 30 giây
  spike: [
    { duration: '2m', target: Math.ceil(TARGET / 10) },
    { duration: '30s', target: TARGET },
    { duration: '5m', target: TARGET },
    { duration: '1m', target: Math.ceil(TARGET / 10) },
  ],
  soak: [
    { duration: '10m', target: TARGET },
    { duration: __ENV.SOAK_DURATION || '4h', target: TARGET },
    { duration: '5m', target: 0 },
  ],
};

export const options = {
  insecureSkipTLSVerify: true, // cert tự ký ở dev; bỏ khi có cert thật
  scenarios: {
    viewers: { executor: 'ramping-vus', startVUs: 0, stages: PROFILES[__ENV.PROFILE || 'smoke'], gracefulRampDown: '30s' },
  },
  // SLO, xem bảng trong docs/load-testing.md. Vượt ngưỡng: k6 trả mã lỗi 99.
  thresholds: {
    http_req_failed: ['rate<0.001'],
    'http_req_duration{api:lives}': ['p(95)<300', 'p(99)<1000'],
    'http_req_duration{api:live}': ['p(95)<300', 'p(99)<1000'],
    'http_req_duration{api:products}': ['p(95)<300', 'p(99)<1000'],
    'http_req_duration{api:order}': ['p(95)<500', 'p(99)<1500'],
    orders_unexpected: ['count==0'],
  },
};

http.setResponseCallback(http.expectedStatuses(200, 201, 409));
const ordersOk = new Counter('orders_success');
const ordersSoldOut = new Counter('orders_rejected');
const ordersBad = new Counter('orders_unexpected');
const watchTime = new Trend('viewer_session_s');

export function setup() {
  const res = http.get(`${BASE}/api/lives`, { tags: { api: 'lives' } });
  const lives = res.json() || [];
  if (!lives.length) throw new Error('Không có phiên live nào đang mở: chạy scripts/seed-demo.cjs trước');
  return { lives: lives.map((l) => ({ id: l.sessionId })) };
}

export default function (data) {
  const started = Date.now();
  const live = data.lives[Math.floor(Math.random() * data.lives.length)];
  http.get(`${BASE}/api/lives`, { tags: { api: 'lives' } });
  if (Math.random() < 0.3) http.get(`${BASE}/api/products`, { tags: { api: 'products' } });

  // Ở lại phiên 30-120 giây, poll như trình duyệt
  const stay = 30 + Math.random() * 90;
  let detail = null;
  for (let t = 0; t < stay; t += POLL_S) {
    const res = http.get(`${BASE}/api/lives/${live.id}`, { tags: { api: 'live' } });
    check(res, { 'live 200': (r) => r.status === 200 });
    if (res.status === 200) detail = res.json();

    if (detail && Math.random() < BUY_RATE / (stay / POLL_S)) buy(live.id, detail);
    sleep(POLL_S);
  }
  watchTime.add((Date.now() - started) / 1000);
}

function buy(sessionId, detail) {
  const products = detail.products || [];
  if (!products.length) return;
  const p = products[Math.floor(Math.random() * products.length)];
  const res = http.post(
    `${BASE}/api/orders`,
    JSON.stringify({ sessionId, productId: p.productId || p.id, userId: `k6-${__VU}-${__ITER}` }),
    { headers: { 'content-type': 'application/json' }, tags: { api: 'order' } },
  );
  if (res.status === 201) ordersOk.add(1);
  else if (res.status === 409) ordersSoldOut.add(1);
  else ordersBad.add(1);
}
