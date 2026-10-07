// Test tải chốt đơn trong phiên live: REQUESTS request (mặc định 5.000) tranh STOCK sản phẩm (mặc định 100)
// của một phiên. Đạt khi số đơn trong PostgreSQL đúng bằng STOCK và không có lỗi ngoài 201/409.
// setup: đăng ký người bán mới (admin) + mở phiên live; teardown: kiểm số đơn rồi kết thúc phiên.
// Chạy: docker compose --profile loadtest run --rm k6
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const GATEWAY = __ENV.GATEWAY_URL || 'http://localhost:8000';
const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || 'dev-admin-token';
const PRODUCT_ID = Number(__ENV.PRODUCT_ID || 1);
const STOCK = Number(__ENV.STOCK || 100);
const REQUESTS = Number(__ENV.REQUESTS || 5000);
const VUS = Number(__ENV.VUS || 200);

const success = new Counter('orders_success');
const rejected = new Counter('orders_rejected');
const unexpected = new Counter('orders_unexpected');

export const options = {
  scenarios: {
    live_order: { executor: 'shared-iterations', vus: VUS, iterations: REQUESTS, maxDuration: '2m' },
  },
  thresholds: {
    orders_unexpected: ['count==0'],
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.01'],
  },
};

// 409 (hết hàng / đã mua) là kết quả hợp lệ, không tính vào http_req_failed.
http.setResponseCallback(http.expectedStatuses(200, 201, 409));

const headers = (extra) => ({ headers: Object.assign({ 'content-type': 'application/json' }, extra || {}) });

export function setup() {
  const reg = http.post(
    `${GATEWAY}/api/sellers`,
    JSON.stringify({ name: `k6 seller ${Date.now()}` }),
    headers({ 'x-admin-token': ADMIN_TOKEN }),
  );
  if (reg.status !== 201) throw new Error(`Không đăng ký được người bán: ${reg.status} ${reg.body}`);
  const sellerToken = reg.json('token');

  const ses = http.post(
    `${GATEWAY}/api/sessions`,
    JSON.stringify({ title: 'k6 load test', products: [{ productId: PRODUCT_ID, stock: STOCK }] }),
    headers({ authorization: `Bearer ${sellerToken}` }),
  );
  if (ses.status !== 201) throw new Error(`Không mở được phiên live: ${ses.status} ${ses.body}`);
  return { sellerToken, sessionId: ses.json('sessionId') };
}

export default function (data) {
  const userId = `k6-${data.sessionId.slice(0, 8)}-${__VU}-${__ITER}`;
  const res = http.post(
    `${GATEWAY}/api/orders`,
    JSON.stringify({ sessionId: data.sessionId, productId: PRODUCT_ID, userId }),
    headers(),
  );
  if (res.status === 201) success.add(1);
  else if (res.status === 409) rejected.add(1);
  else unexpected.add(1);
  check(res, { 'status 201 hoặc 409': (r) => r.status === 201 || r.status === 409 });
}

export function teardown(data) {
  const stats = http.get(`${GATEWAY}/api/orders/stats?sessionId=${data.sessionId}&productId=${PRODUCT_ID}`).json();
  console.log(`Phiên ${data.sessionId}: ${stats.orders} đơn trong DB / tồn kho ${STOCK}`);
  http.post(`${GATEWAY}/api/sessions/${data.sessionId}/end`, '{}', headers({ authorization: `Bearer ${data.sellerToken}` }));
  if (stats.orders !== STOCK) throw new Error(`OVERSOLD/UNDERSOLD: ${stats.orders} đơn, mong đợi ${STOCK}`);
}
