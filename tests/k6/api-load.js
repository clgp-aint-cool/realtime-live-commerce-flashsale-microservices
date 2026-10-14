// Test tải API chuẩn hành vi người dùng (User Session Flow):
// 1. Đăng nhập 1 lần lúc vào phiên để nhận JWT Token
// 2. Liên tục lướt xem danh sách sản phẩm: GET /api/products
// 3. Liên tục thăm dò danh sách phiên live: GET /api/lives
//
// Tiêu chuẩn đạt SLO: p95 < 300 ms, tỉ lệ lỗi < 1%
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'https://dev.cmc-cloud-hcm1.cloud';
const TARGET = Number(__ENV.TARGET || 50);
const DURATION = __ENV.DURATION || '1m';

export const options = {
  insecureSkipTLSVerify: true,
  scenarios: {
    user_browsing: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: TARGET },
        { duration: DURATION, target: TARGET },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'], // tỉ lệ lỗi < 1% theo yêu cầu
    'http_req_duration{api:products}': ['p(90)<600', 'p(95)<800'], // tính thêm latency WAN/Wi-Fi
    'http_req_duration{api:lives}': ['p(90)<500', 'p(95)<700'],
    'http_req_duration{api:login}': ['p(95)<1000'],
  },
};

const jsonHeaders = { headers: { 'content-type': 'application/json' } };

export function setup() {
  const users = [];
  for (let i = 1; i <= 30; i++) {
    const username = `k6_buyer_${i}`;
    const password = 'TestPassword123!';
    http.post(
      `${BASE}/api/auth/register`,
      JSON.stringify({ username, password, displayName: `Buyer ${i}` }),
      jsonHeaders,
    );
    users.push({ username, password });
  }
  return { users };
}

export default function (data) {
  // Bước 1: Đăng nhập đầu phiên
  const user = data.users[__VU % data.users.length];
  const loginRes = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({ username: user.username, password: user.password }),
    Object.assign({ tags: { api: 'login' } }, jsonHeaders),
  );
  check(loginRes, {
    'login ok': (r) => r.status === 200 && r.json('token') !== undefined,
  });

  const token = loginRes.status === 200 ? loginRes.json('token') : null;
  const authHeaders = token
    ? { headers: { authorization: `Bearer ${token}` } }
    : {};

  // Bước 2: Người dùng lướt xem hàng hóa và phiên live trong 5-10 vòng lặp
  for (let i = 0; i < 5; i++) {
    // Xem danh sách sản phẩm
    const resProd = http.get(
      `${BASE}/api/products`,
      Object.assign({ tags: { api: 'products' } }, authHeaders),
    );
    check(resProd, { 'products 200': (r) => r.status === 200 });

    sleep(0.5);

    // Xem danh sách các phiên live
    const resLives = http.get(
      `${BASE}/api/lives`,
      Object.assign({ tags: { api: 'lives' } }, authHeaders),
    );
    check(resLives, { 'lives 200': (r) => r.status === 200 });

    sleep(1);
  }
}
