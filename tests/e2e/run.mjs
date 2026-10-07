// Test end-to-end toàn bộ luồng (người bán OBS + phiên live + chốt đơn + chat + moderation) qua Kong, giống cách người dùng thật truy cập.
// Chạy: docker compose --profile test run --rm e2e
// Hoặc từ máy host: GATEWAY_URL=http://localhost:8000 MODERATION_URL=http://localhost:3004 node run.mjs
import { randomUUID } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { io } from "socket.io-client";

const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:8000";
const MODERATION = process.env.MODERATION_URL ?? "http://localhost:3004";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "dev-admin-token";
const WEBHOOK_SECRET =
  process.env.WEBHOOK_SHARED_SECRET ?? "dev-webhook-secret";
const LIVE_MANAGER = process.env.LIVE_MANAGER_URL ?? "http://localhost:3005";
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN ?? "dev-internal-token";
const CONCURRENT_ORDERS = Number(process.env.CONCURRENT_ORDERS ?? 1000);
const STOCK = Number(process.env.STOCK ?? 100);
const RUN = randomUUID().slice(0, 8);

let failures = 0;
const results = [];

function check(name, condition, detail = "") {
  results.push({ name, ok: !!condition });
  if (condition) console.log(`  ✔ ${name}`);
  else {
    failures++;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function http(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const admin = { "x-admin-token": ADMIN_TOKEN };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(GATEWAY, {
      path: "/ws",
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });
    const timer = setTimeout(
      () => reject(new Error("timeout kết nối socket")),
      5000,
    );
    socket.once("hello", ({ instance }) => {
      clearTimeout(timer);
      resolve({ socket, instance });
    });
    socket.once("connect_error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function waitForEvent(socket, event, predicate = () => true, ms = 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, ms);
    const handler = (data) => {
      if (predicate(data)) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(data);
      }
    };
    socket.on(event, handler);
  });
}
const waitForMessage = (socket, predicate, ms) =>
  waitForEvent(socket, "message", predicate, ms);
const bearer = (token) => ({ authorization: `Bearer ${token}` });
const order = (sessionId, productId, userId) =>
  http("POST", `${GATEWAY}/api/orders`, { sessionId, productId, userId });

async function testGateway() {
  console.log("\n[1] Gateway & web");
  const home = await fetch(`${GATEWAY}/`);
  const html = await home.text();
  check(
    "GET / trả về trang web qua Kong",
    home.status === 200 && html.includes('<div id="root">'),
  );
  const cfg = await fetch(`${GATEWAY}/config.js`).then((r) => r.text());
  check(
    "GET /config.js có cấu hình runtime, không còn playback URL cố định",
    cfg.includes("__APP_CONFIG__") && !cfg.includes("ivsPlaybackUrl"),
  );
  const internal = await http(
    "GET",
    `${GATEWAY}/internal/channels/open-session?channelArn=x`,
  );
  check(
    "/internal của live-manager không lộ qua Kong (rơi về web)",
    typeof internal.body === "string" &&
      internal.body.includes('<div id="root">'),
    JSON.stringify(internal.body).slice(0, 200),
  );
}

async function testProducts() {
  console.log("\n[2] Product service (danh mục)");
  const list = await http("GET", `${GATEWAY}/api/products`);
  check(
    "GET /api/products trả danh sách đã seed",
    list.status === 200 && Array.isArray(list.body) && list.body.length >= 2,
    JSON.stringify(list.body),
  );
  const missing = await http("GET", `${GATEWAY}/api/products/999999`);
  check(
    "Sản phẩm không tồn tại trả 404",
    missing.status === 404,
    `status=${missing.status}`,
  );
  const legacy = await http(
    "POST",
    `${GATEWAY}/api/products/1/flash-sale`,
    { stock: 5 },
    admin,
  );
  check(
    "API flash sale cũ đã gỡ (404)",
    legacy.status === 404,
    `status=${legacy.status}`,
  );
  return list.body.map((p) => p.id);
}

async function testSellers() {
  console.log("\n[3] Người bán: đăng ký kênh IVS, stream key, profile OBS");
  const noAuth = await http("POST", `${GATEWAY}/api/sellers`, {
    name: "Không token",
  });
  check(
    "Đăng ký người bán không có admin token bị từ chối (401)",
    noAuth.status === 401,
    `status=${noAuth.status}`,
  );
  const badName = await http(
    "POST",
    `${GATEWAY}/api/sellers`,
    { name: "x" },
    admin,
  );
  check(
    "Tên quá ngắn trả 400",
    badName.status === 400,
    `status=${badName.status}`,
  );

  const regA = await http(
    "POST",
    `${GATEWAY}/api/sellers`,
    { name: `Shop Áo Thun ${RUN}` },
    admin,
  );
  const regB = await http(
    "POST",
    `${GATEWAY}/api/sellers`,
    { name: `Shop Cốc ${RUN}` },
    admin,
  );
  check(
    "Đăng ký người bán tạo kênh IVS (201)",
    regA.status === 201 && regB.status === 201,
    JSON.stringify(regA.body),
  );
  const a = { token: regA.body.token, ...regA.body.seller };
  const b = { token: regB.body.token, ...regB.body.seller };
  check(
    "Trả token lcs_ một lần, có channelArn/ingestServer/playbackUrl",
    a.token?.startsWith("lcs_") &&
      a.channelArn &&
      a.ingestServer?.startsWith("rtmps://") &&
      a.playbackUrl,
  );
  check(
    "Hồ sơ đăng ký không chứa stream key",
    !("streamKey" in regA.body) && !("streamKey" in regA.body.seller),
    JSON.stringify(regA.body),
  );

  const me401 = await http(
    "GET",
    `${GATEWAY}/api/sellers/me`,
    undefined,
    bearer("lcs_sai"),
  );
  check(
    "Token sai bị từ chối (401)",
    me401.status === 401,
    `status=${me401.status}`,
  );
  const me = await http(
    "GET",
    `${GATEWAY}/api/sellers/me`,
    undefined,
    bearer(a.token),
  );
  check(
    "GET /api/sellers/me đúng người bán, hasStreamKey",
    me.status === 200 && me.body.id === a.id && me.body.hasStreamKey === true,
    JSON.stringify(me.body),
  );

  const key1 = await http(
    "GET",
    `${GATEWAY}/api/sellers/me/stream-key`,
    undefined,
    bearer(a.token),
  );
  check(
    "Lấy stream key (GetStreamKey) khi cần",
    key1.status === 200 &&
      typeof key1.body.streamKey === "string" &&
      key1.body.streamKey.length > 8,
    JSON.stringify(key1.body),
  );
  const keyB = await http(
    "GET",
    `${GATEWAY}/api/sellers/me/stream-key`,
    undefined,
    bearer(b.token),
  );
  check(
    "Mỗi người bán một key riêng",
    keyB.body?.streamKey && keyB.body.streamKey !== key1.body.streamKey,
  );
  const reset = await http(
    "POST",
    `${GATEWAY}/api/sellers/me/stream-key/reset`,
    {},
    bearer(a.token),
  );
  check(
    '"Đặt lại key" trả key mới khác key cũ',
    reset.status === 200 &&
      reset.body.streamKey &&
      reset.body.streamKey !== key1.body.streamKey,
    JSON.stringify(reset.body),
  );
  const key2 = await http(
    "GET",
    `${GATEWAY}/api/sellers/me/stream-key`,
    undefined,
    bearer(a.token),
  );
  check(
    "Sau khi đặt lại, GetStreamKey trả key mới",
    key2.body?.streamKey === reset.body.streamKey,
  );
  a.streamKey = reset.body.streamKey;

  const zipRes = await fetch(`${GATEWAY}/api/sellers/me/obs-profile`, {
    headers: bearer(a.token),
  });
  const files = zipRes.ok
    ? unzipSync(new Uint8Array(await zipRes.arrayBuffer()))
    : {};
  const names = Object.keys(files);
  const service = names.find((n) => n.endsWith("/service.json"));
  const serviceJson = service ? JSON.parse(strFromU8(files[service])) : {};
  check(
    "Tải profile OBS (zip, no-store)",
    zipRes.status === 200 &&
      zipRes.headers.get("cache-control")?.includes("no-store") &&
      names.some((n) => n.endsWith("/basic.ini")),
    names.join(","),
  );
  check(
    "service.json đã điền server + key hiện tại",
    serviceJson.settings?.server === a.ingestServer &&
      serviceJson.settings?.key === a.streamKey,
    JSON.stringify(serviceJson),
  );
  return { a, b };
}

async function testAuth() {
  console.log("\n[2b] Tài khoản người mua (auth-service)");
  const username = `e2e_${RUN}`;
  const password = `pw-${randomUUID()}`;
  const register = (body) => http("POST", `${GATEWAY}/api/auth/register`, body);
  const login = (body) => http("POST", `${GATEWAY}/api/auth/login`, body);

  const created = await register({ username, password, displayName: "E2E Buyer" });
  check(
    "Đăng ký trả token + user (id usr_…)",
    created.status === 201 &&
      typeof created.body.token === "string" &&
      created.body.user?.id?.startsWith("usr_") &&
      created.body.user.username === username &&
      !("passwordHash" in created.body.user),
    `status=${created.status}`,
  );
  const dup = await register({ username: username.toUpperCase(), password });
  check("Trùng username (không phân biệt hoa thường) trả 409", dup.status === 409, `status=${dup.status}`);
  const weak = await register({ username: `e2e_${RUN}_w`, password: "123" });
  check("Mật khẩu ngắn trả 400", weak.status === 400, `status=${weak.status}`);
  const badName = await register({ username: "a b", password });
  check("Username sai định dạng trả 400", badName.status === 400, `status=${badName.status}`);

  const wrong = await login({ username, password: "wrong-password" });
  check("Sai mật khẩu trả 401", wrong.status === 401, `status=${wrong.status}`);
  const ghost = await login({ username: `ghost_${RUN}`, password });
  check("Username không tồn tại cũng trả 401", ghost.status === 401, `status=${ghost.status}`);
  const ok = await login({ username, password });
  check("Đăng nhập đúng trả token mới", ok.status === 200 && typeof ok.body.token === "string", `status=${ok.status}`);

  const me = await http("GET", `${GATEWAY}/api/auth/me`, undefined, bearer(ok.body.token));
  check("GET /api/auth/me trả đúng user", me.status === 200 && me.body.id === created.body.user.id, `status=${me.status}`);
  const tampered = await http("GET", `${GATEWAY}/api/auth/me`, undefined, bearer(`${ok.body.token.slice(0, -2)}xx`));
  check("Token bị sửa trả 401", tampered.status === 401, `status=${tampered.status}`);
  const noToken = await http("GET", `${GATEWAY}/api/auth/me`);
  check("Thiếu token trả 401", noToken.status === 401, `status=${noToken.status}`);

  // Không được mạo danh tài khoản bằng userId dạng usr_ khi không có token.
  const spoofList = await http("GET", `${GATEWAY}/api/orders?userId=${created.body.user.id}`);
  check("Xem đơn của tài khoản không có token bị chặn (403)", spoofList.status === 403, `status=${spoofList.status}`);
  const badBearer = await http("GET", `${GATEWAY}/api/orders`, undefined, bearer("not-a-jwt"));
  check("Xem đơn với token hỏng trả 401", badBearer.status === 401, `status=${badBearer.status}`);
  return { token: ok.body.token, user: created.body.user };
}

async function testSellerProducts(sellers) {
  console.log("\n[3b] Người bán tự thêm sản phẩm");
  const { a, b } = sellers;
  const url = `${GATEWAY}/api/sellers/me/products`;
  const noAuth = await http("POST", url, { name: "Áo", price: 100000 });
  check("Thêm sản phẩm không đăng nhập bị từ chối (401)", noAuth.status === 401, `status=${noAuth.status}`);
  const cheap = await http("POST", url, { name: "Áo", price: 5 }, bearer(a.token));
  check("Giá dưới 1.000đ trả 400", cheap.status === 400, `status=${cheap.status}`);
  const badImage = await http("POST", url, { name: "Áo", price: 100000, imageUrl: "javascript:alert(1)" }, bearer(a.token));
  check("Link ảnh không phải http(s) trả 400", badImage.status === 400, `status=${badImage.status}`);

  const created = await http(
    "POST",
    url,
    { name: `Áo E2E ${RUN}`, price: 159000, description: "Sản phẩm riêng của shop A" },
    bearer(a.token),
  );
  check(
    "Thêm sản phẩm thành công, gắn sellerId + ảnh mặc định",
    created.status === 201 && created.body.sellerId === a.id && created.body.imageUrl?.startsWith("https://"),
    JSON.stringify(created.body),
  );
  const mineA = await http("GET", url, undefined, bearer(a.token));
  const mineB = await http("GET", url, undefined, bearer(b.token));
  check(
    "Danh mục shop A có sản phẩm mới, shop B thì không",
    mineA.body.some?.((p) => p.id === created.body.id) && !mineB.body.some?.((p) => p.id === created.body.id),
    `a=${mineA.status} b=${mineB.status}`,
  );
  const internal = await http("POST", `${GATEWAY}/internal/products`, { name: "Hack", price: 1000 });
  check("Gateway không mở /internal/products", internal.status !== 201, `status=${internal.status}`);
  const foreign = await http(
    "POST",
    `${GATEWAY}/api/sessions`,
    { title: "Mượn hàng shop A", products: [{ productId: created.body.id, stock: 1 }] },
    bearer(b.token),
  );
  check("Shop B không mở phiên với sản phẩm của shop A (400)", foreign.status === 400, JSON.stringify(foreign.body));
  return created.body.id;
}

async function testAccountOrders(account, sessionId, productId) {
  console.log("\n[5b] Đơn hàng gắn tài khoản");
  const created = await http(
    "POST",
    `${GATEWAY}/api/orders`,
    { sessionId, productId, userId: "ai-do-khac" },
    bearer(account.token),
  );
  check(
    "Có token: userId lấy từ token, bỏ qua userId trong body",
    created.status === 201 && created.body.userId === account.user.id,
    JSON.stringify(created.body),
  );
  const spoof = await order(sessionId, productId, account.user.id);
  check("Khách đặt đơn với userId usr_… bị chặn (403)", spoof.status === 403, `status=${spoof.status}`);
  const mine = await http("GET", `${GATEWAY}/api/orders`, undefined, bearer(account.token));
  check(
    "GET /api/orders với token trả đơn của tài khoản",
    mine.status === 200 && mine.body.length === 1 && mine.body[0].id === created.body.id,
    JSON.stringify(mine.body),
  );
}

async function testSessions(sellers, productIds) {
  console.log("\n[4] Phiên live: tạo, danh sách /lives");
  const [p1, p2] = productIds;
  const { a, b } = sellers;
  const noAuth = await http("POST", `${GATEWAY}/api/sessions`, {
    title: "x",
    products: [],
  });
  check(
    "Tạo phiên không đăng nhập bị từ chối (401)",
    noAuth.status === 401,
    `status=${noAuth.status}`,
  );
  const badProduct = await http(
    "POST",
    `${GATEWAY}/api/sessions`,
    { title: "Phiên lỗi", products: [{ productId: 999999, stock: 1 }] },
    bearer(a.token),
  );
  check(
    "Sản phẩm không tồn tại trả 400",
    badProduct.status === 400,
    JSON.stringify(badProduct.body),
  );

  const created = await http(
    "POST",
    `${GATEWAY}/api/sessions`,
    {
      title: `Xả kho ${RUN}`,
      products: [
        { productId: p1, stock: 2 },
        { productId: p2, stock: STOCK },
      ],
    },
    bearer(a.token),
  );
  check(
    "POST /api/sessions mở phiên (201)",
    created.status === 201 && created.body.status === "OPEN",
    JSON.stringify(created.body),
  );
  const sessionId = created.body.sessionId;
  const dup = await http(
    "POST",
    `${GATEWAY}/api/sessions`,
    { title: "Phiên thứ hai", products: [{ productId: p1, stock: 1 }] },
    bearer(a.token),
  );
  check(
    "Một người bán chỉ một phiên mở (409)",
    dup.status === 409,
    `status=${dup.status}`,
  );

  const createdB = await http(
    "POST",
    `${GATEWAY}/api/sessions`,
    { title: `Phiên B ${RUN}`, products: [{ productId: p1, stock: 5 }] },
    bearer(b.token),
  );
  check("Người bán khác mở phiên song song được", createdB.status === 201);

  const lives = await http("GET", `${GATEWAY}/api/lives`);
  const mine = Array.isArray(lives.body)
    ? lives.body.find((l) => l.sessionId === sessionId)
    : null;
  check(
    "GET /api/lives có phiên: tiêu đề, người bán, playbackUrl, viewerCount",
    mine &&
      mine.title === `Xả kho ${RUN}` &&
      mine.seller.id === a.id &&
      mine.playbackUrl === a.playbackUrl &&
      typeof mine.viewerCount === "number",
    JSON.stringify(mine),
  );
  const raw = JSON.stringify(lives.body);
  check(
    "/lives không lộ stream key, ingest hay channel ARN",
    !raw.includes(a.streamKey) &&
      !raw.includes("rtmps://") &&
      !raw.includes("channelArn"),
  );

  const detail = await http("GET", `${GATEWAY}/api/lives/${sessionId}`);
  const stock = (id) => detail.body?.products?.find((p) => p.id === id)?.stock;
  check(
    "GET /api/lives/:id trả sản phẩm + tồn kho của phiên",
    detail.status === 200 && stock(p1) === 2 && stock(p2) === STOCK,
    JSON.stringify(detail.body?.products),
  );
  const me = await http(
    "GET",
    `${GATEWAY}/api/sellers/me`,
    undefined,
    bearer(a.token),
  );
  check(
    "Hồ sơ người bán có currentSessionId",
    me.body?.currentSessionId === sessionId,
  );
  return { sessionId, sessionB: createdB.body.sessionId };
}

async function testOrderRules(sellers, sessionId, sessionB, [p1, p2, p3]) {
  console.log("\n[5] Đơn hàng gắn phiên: quy tắc cơ bản");
  const noSession = await http("POST", `${GATEWAY}/api/orders`, {
    productId: p1,
    userId: `e2e-${RUN}-x`,
  });
  check(
    "Thiếu sessionId trả 400",
    noSession.status === 400,
    `status=${noSession.status}`,
  );
  const unknown = await order(randomUUID(), p1, `e2e-${RUN}-x`);
  check(
    "Phiên không tồn tại trả 404",
    unknown.status === 404,
    `status=${unknown.status}`,
  );
  if (p3) {
    const notInSession = await order(sessionId, p3, `e2e-${RUN}-x`);
    check(
      "Sản phẩm không thuộc phiên trả 404",
      notInSession.status === 404,
      `status=${notInSession.status}`,
    );
  }
  const user = `e2e-${RUN}-dup`;
  const first = await order(sessionId, p1, user);
  check(
    "Đơn đầu tiên thành công, gắn seller_id + session_id",
    first.status === 201 &&
      first.body.sessionId === sessionId &&
      first.body.sellerId === sellers.a.id,
    JSON.stringify(first.body),
  );
  const second = await order(sessionId, p1, user);
  check(
    "Cùng user mua lần 2 trong phiên bị chặn (409 ALREADY_BOUGHT)",
    second.status === 409 && second.body?.code === "ALREADY_BOUGHT",
    JSON.stringify(second.body),
  );
  const otherSession = await order(sessionB, p1, user);
  check(
    "Kho tách theo phiên: cùng sản phẩm ở phiên khác vẫn mua được",
    otherSession.status === 201 && otherSession.body.sellerId === sellers.b.id,
    JSON.stringify(otherSession.body),
  );
  await order(sessionId, p1, `e2e-${RUN}-u2`);
  const soldOut = await order(sessionId, p1, `e2e-${RUN}-u3`);
  check(
    "Hết hàng trả 409 SOLD_OUT",
    soldOut.status === 409 && soldOut.body?.code === "SOLD_OUT",
    JSON.stringify(soldOut.body),
  );
  const invalid = await order(sessionId, p1, "có dấu cách");
  check(
    "userId không hợp lệ trả 400",
    invalid.status === 400,
    `status=${invalid.status}`,
  );
  const mine = await http("GET", `${GATEWAY}/api/orders?userId=${user}`);
  check(
    "Lịch sử đơn theo userId (2 phiên)",
    mine.status === 200 && mine.body.length === 2,
    JSON.stringify(mine.body),
  );
}

async function testConcurrency(sessionId, productId) {
  console.log(
    `\n[6] Chốt đơn: ${CONCURRENT_ORDERS} request đồng thời, tồn kho ${STOCK} (phiên ${sessionId.slice(0, 8)})`,
  );
  const t0 = Date.now();
  const responses = await Promise.all(
    Array.from({ length: CONCURRENT_ORDERS }, (_, i) =>
      order(sessionId, productId, `e2e-${RUN}-c${i}`).catch((e) => ({
        status: 0,
        body: e.message,
      })),
    ),
  );
  const count = (s) => responses.filter((r) => r.status === s).length;
  console.log(
    `    201=${count(201)} 409=${count(409)} khác=${CONCURRENT_ORDERS - count(201) - count(409)} (${Date.now() - t0} ms)`,
  );
  check(`Đúng ${STOCK} đơn thành công`, count(201) === STOCK);
  check(
    "Không có lỗi ngoài 201/409",
    count(201) + count(409) === CONCURRENT_ORDERS,
  );
  const stats = await http(
    "GET",
    `${GATEWAY}/api/orders/stats?sessionId=${sessionId}&productId=${productId}`,
  );
  check(
    `Số đơn trong PostgreSQL = ${STOCK}`,
    stats.body?.orders === STOCK,
    JSON.stringify(stats.body),
  );
  const detail = await http("GET", `${GATEWAY}/api/lives/${sessionId}`);
  check(
    "Tồn kho Redis của phiên còn 0",
    detail.body?.products?.find((p) => p.id === productId)?.stock === 0,
  );
}

async function testChatAndPin(sellers, sessionId, sessionB, [p1, p2, p3]) {
  console.log("\n[7] Chat theo phòng sessionId (xuyên pod) + ghim sản phẩm");
  const sockets = [];
  const byInstance = new Map();
  for (let i = 0; i < 20 && byInstance.size < 2; i++) {
    const conn = await connect();
    sockets.push(conn.socket);
    if (!byInstance.has(conn.instance))
      byInstance.set(conn.instance, conn.socket);
    else await sleep(200);
  }
  const instances = [...byInstance.keys()];
  check(
    "Kết nối được 2 instance chat-service khác nhau",
    instances.length >= 2,
    `chỉ thấy: ${instances.join(", ")}`,
  );
  const [a, b] =
    instances.length >= 2
      ? [...byInstance.values()]
      : [sockets[0], sockets[sockets.length - 1] ?? sockets[0]];
  const other = (await connect()).socket;
  sockets.push(other);

  const joinA = await emitAck(a, "join", {
    room: sessionId,
    username: "Alice",
  });
  const joinB = await emitAck(b, "join", { room: sessionId, username: "Bob" });
  await emitAck(other, "join", { room: sessionB, username: "Carol" });
  check(
    "Join phòng = sessionId (UUID) thành công",
    joinA.ok && joinB.ok,
    JSON.stringify({ joinA, joinB }),
  );

  const text = `xin chào ${RUN}`;
  const received = waitForMessage(b, (m) => m.text === text);
  const leaked = waitForMessage(other, (m) => m.text === text, 1500);
  const ack = await emitAck(a, "message", { text });
  check("Gửi tin nhắn được ack", ack.ok, JSON.stringify(ack));
  check(
    `Tin nhắn từ ${instances[0]} tới được ${instances[1] ?? "?"} cùng phiên`,
    await received,
  );
  check("Phiên khác không nhận tin nhắn", !(await leaked));

  const { a: sa, b: sb } = sellers;
  const pinPath = `${GATEWAY}/api/sessions/${sessionId}/pin`;
  const pinEvent = waitForEvent(b, "pin", (d) => d.productId === p2);
  const pinned = await http(
    "POST",
    pinPath,
    { productId: p2 },
    bearer(sa.token),
  );
  check(
    "Ghim sản phẩm: PutMetadata sent + đẩy socket",
    pinned.status === 200 &&
      pinned.body.metadata === "sent" &&
      pinned.body.socket === true,
    JSON.stringify(pinned.body),
  );
  check('Người xem nhận sự kiện "pin" qua socket', await pinEvent);
  const tooFast = await http(
    "POST",
    pinPath,
    { productId: p1 },
    bearer(sa.token),
  );
  check(
    "Ghim liên tiếp < 200 ms bị chặn 429 (giới hạn 5 lần/giây/kênh)",
    tooFast.status === 429,
    `status=${tooFast.status}`,
  );
  await sleep(250);
  if (p3) {
    const notIn = await http(
      "POST",
      pinPath,
      { productId: p3 },
      bearer(sa.token),
    );
    check(
      "Ghim sản phẩm không thuộc phiên trả 400",
      notIn.status === 400,
      `status=${notIn.status}`,
    );
  }
  const foreign = await http(
    "POST",
    pinPath,
    { productId: p1 },
    bearer(sb.token),
  );
  check(
    "Người bán khác không ghim được phiên này (404)",
    foreign.status === 404,
    `status=${foreign.status}`,
  );
  const detail = await http("GET", `${GATEWAY}/api/lives/${sessionId}`);
  check(
    "Trang xem live thấy pinnedProductId",
    detail.body?.pinnedProductId === p2,
    JSON.stringify(detail.body?.pinnedProductId),
  );
  return { sockets, listener: b };
}

async function testModeration(sellers, sessionId, listener) {
  console.log(
    "\n[8] Moderation webhook -> phòng chat của phiên (tra theo channelArn)",
  );
  const eventId = `e2e-${RUN}`;
  const event = {
    eventId,
    type: "IMAGE_VIOLATION",
    action: "STREAM_STOPPED",
    channelArn: sellers.a.channelArn,
    labels: [{ name: "Violence", confidence: 97.3 }],
    thumbnailUrl: "s3://demo-bucket/thumb.jpg",
    occurredAt: new Date().toISOString(),
  };
  const wrong = await http("POST", `${MODERATION}/webhooks/moderation`, event, {
    "x-webhook-secret": "sai",
  });
  check(
    "Sai secret bị từ chối (401)",
    wrong.status === 401,
    `status=${wrong.status}`,
  );
  const invalid = await http(
    "POST",
    `${MODERATION}/webhooks/moderation`,
    { type: "X" },
    { "x-webhook-secret": WEBHOOK_SECRET },
  );
  check(
    "Thiếu eventId trả 400",
    invalid.status === 400,
    `status=${invalid.status}`,
  );

  const lookup = await http(
    "GET",
    `${LIVE_MANAGER}/internal/channels/open-session?channelArn=${encodeURIComponent(sellers.a.channelArn)}`,
    undefined,
    { "x-internal-token": INTERNAL_TOKEN },
  );
  check(
    "live-manager tra phiên đang mở theo channelArn (nội bộ)",
    lookup.body?.sessionId === sessionId,
    JSON.stringify(lookup.body),
  );

  const alert = waitForMessage(
    listener,
    (m) =>
      m.type === "system" && m.level === "alert" && m.text.includes("Violence"),
  );
  const ok = await http("POST", `${MODERATION}/webhooks/moderation`, event, {
    "x-webhook-secret": WEBHOOK_SECRET,
  });
  check(
    "Webhook hợp lệ được xử lý (notified)",
    ok.status === 200 && ok.body?.result === "notified",
    JSON.stringify(ok.body),
  );
  check("Người xem đúng phiên nhận cảnh báo", await alert);
  const dup = await http("POST", `${MODERATION}/webhooks/moderation`, event, {
    "x-webhook-secret": WEBHOOK_SECRET,
  });
  check(
    "Gửi lại cùng eventId không thông báo lần 2 (duplicate)",
    dup.body?.result === "duplicate",
    JSON.stringify(dup.body),
  );
  const log = await http(
    "GET",
    `${MODERATION}/api/moderation/events`,
    undefined,
    { "x-webhook-secret": WEBHOOK_SECRET },
  );
  check(
    "Sự kiện được ghi log trong PostgreSQL",
    Array.isArray(log.body) && log.body.some((e) => e.event_id === eventId),
  );
}

async function testEndSession(sellers, sessionId, sessionB, listener, [p1]) {
  console.log("\n[9] Kết thúc phiên");
  const foreign = await http(
    "POST",
    `${GATEWAY}/api/sessions/${sessionId}/end`,
    {},
    bearer(sellers.b.token),
  );
  check(
    "Người bán khác không kết thúc được phiên (404)",
    foreign.status === 404,
    `status=${foreign.status}`,
  );
  const ended = waitForEvent(listener, "session_ended");
  const end = await http(
    "POST",
    `${GATEWAY}/api/sessions/${sessionId}/end`,
    {},
    bearer(sellers.a.token),
  );
  check(
    "Kết thúc phiên (200)",
    end.status === 200 && end.body.status === "ENDED",
    JSON.stringify(end.body),
  );
  check('Người xem nhận sự kiện "session_ended"', await ended);
  const after = await order(sessionId, p1, `e2e-${RUN}-late`);
  check(
    "Đặt hàng sau khi kết thúc trả 404",
    after.status === 404,
    `status=${after.status}`,
  );
  const lives = await http("GET", `${GATEWAY}/api/lives`);
  check(
    "Phiên đã kết thúc không còn trong /lives",
    !lives.body.some((l) => l.sessionId === sessionId),
  );
  const detail = await http("GET", `${GATEWAY}/api/lives/${sessionId}`);
  check("Trang xem phiên cũ báo ENDED", detail.body?.status === "ENDED");
  const again = await http(
    "POST",
    `${GATEWAY}/api/sessions`,
    { title: `Phiên mới ${RUN}`, products: [{ productId: p1, stock: 1 }] },
    bearer(sellers.a.token),
  );
  check(
    "Kết thúc xong mở được phiên mới",
    again.status === 201,
    JSON.stringify(again.body),
  );
  for (const [s, id] of [
    [sellers.a, again.body.sessionId],
    [sellers.b, sessionB],
  ]) {
    if (id)
      await http(
        "POST",
        `${GATEWAY}/api/sessions/${id}/end`,
        {},
        bearer(s.token),
      );
  }
}

async function main() {
  console.log(
    `E2E run ${RUN} — gateway ${GATEWAY}, moderation ${MODERATION}, live-manager ${LIVE_MANAGER}`,
  );
  await testGateway();
  const productIds = await testProducts();
  const account = await testAuth();
  // E2E_ONLY=auth: chỉ chạy phần không tạo người bán. Khi IVS_MODE=aws, mỗi người bán là một kênh IVS thật.
  if (process.env.E2E_ONLY === "auth") return finish();
  const sellers = await testSellers();
  await testSellerProducts(sellers);
  const { sessionId, sessionB } = await testSessions(sellers, productIds);
  await testOrderRules(sellers, sessionId, sessionB, productIds);
  await testAccountOrders(account, sessionId, productIds[0]);
  await testConcurrency(sessionId, productIds[1]);
  const { sockets, listener } = await testChatAndPin(
    sellers,
    sessionId,
    sessionB,
    productIds,
  );
  await testModeration(sellers, sessionId, listener);
  await testEndSession(sellers, sessionId, sessionB, listener, productIds);
  sockets.forEach((s) => s.disconnect());
  finish();
}

function finish() {
  console.log(`\n${results.length - failures}/${results.length} kiểm tra đạt`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("E2E lỗi:", err);
  process.exit(1);
});
