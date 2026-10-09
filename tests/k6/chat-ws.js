// Tải chat realtime (Socket.IO qua /ws, chỉ transport websocket). Mỗi VU = 1 kết nối giữ suốt bài test.
// Đo: số kết nối giữ được, tỉ lệ join thành công, độ trễ fan-out (gửi -> nhận lại broadcast của chính mình).
// SENDER_RATE (mặc định 0.05): tỉ lệ kết nối có gửi tin, mỗi người gửi 1 tin / MSG_EVERY_S giây.
// Phòng chat = sessionId; ROOMS lấy từ /api/lives nếu không truyền (-e ROOMS=id1,id2).
//
//   k6 run -e BASE_URL=https://cmc-cloud-hcm1.cloud -e CONNS=5000 -e HOLD_S=600 tests/k6/chat-ws.js
//
// Giao thức Socket.IO v4 viết tay để không phụ thuộc thư viện: "40" connect, "42[...]" event,
// "42<id>[...]" event có ack, server trả "43<id>[...]"; server ping "2" thì trả "3".
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'https://cmc-cloud-hcm1.cloud';
const CONNS = Number(__ENV.CONNS || 200);
const RAMP_S = Number(__ENV.RAMP_S || 180);
const HOLD_S = Number(__ENV.HOLD_S || 300);
const SENDER_RATE = Number(__ENV.SENDER_RATE || 0.05);
const MSG_EVERY_S = Number(__ENV.MSG_EVERY_S || 10);

export const options = {
  insecureSkipTLSVerify: true,
  scenarios: {
    chat: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: `${RAMP_S}s`, target: CONNS },
        { duration: `${HOLD_S}s`, target: CONNS },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    chat_join_ok: ['rate>0.999'],
    chat_fanout_ms: ['p(95)<1000', 'p(99)<2000'],
    chat_disconnects: ['count<' + Math.ceil(CONNS * 0.001 + 1)],
  },
};

const joinOk = new Rate('chat_join_ok');
const fanout = new Trend('chat_fanout_ms', true);
const sent = new Counter('chat_sent');
const received = new Counter('chat_received');
const disconnects = new Counter('chat_disconnects');

export function setup() {
  // Mọi kết nối tự đóng cùng lúc ở cuối pha giữ tải: đóng do k6 ramp-down không bị tính là rớt kết nối.
  const closeAt = Date.now() + (RAMP_S + HOLD_S) * 1000;
  if (__ENV.ROOMS) return { rooms: __ENV.ROOMS.split(','), closeAt };
  const rooms = (http.get(`${BASE}/api/lives`).json() || []).map((l) => l.sessionId);
  if (!rooms.length) throw new Error('Không có phiên live nào đang mở');
  return { rooms, closeAt };
}

export default function (data) {
  // Hết pha giữ tải: không mở kết nối mới trong lúc ramp-down
  if (Date.now() >= data.closeAt) return sleep(5);
  const room = data.rooms[__VU % data.rooms.length];
  const me = `k6-${__VU}`;
  const isSender = Math.random() < SENDER_RATE;
  const url = BASE.replace(/^http/, 'ws') + '/ws/?EIO=4&transport=websocket';
  let closedByUs = false;

  const res = ws.connect(url, {}, (socket) => {
    socket.on('message', (raw) => {
      if (raw === '2') return socket.send('3'); // ping/pong engine.io
      if (raw.startsWith('0')) return socket.send('40'); // mở engine.io -> connect namespace "/"
      if (raw.startsWith('40')) {
        return socket.send('420' + JSON.stringify(['join', { room, username: me }]));
      }
      if (raw.startsWith('430')) {
        const ack = JSON.parse(raw.slice(3))[0];
        joinOk.add(ack && ack.ok === true);
        if (ack && ack.ok && isSender) {
          socket.setInterval(() => {
            socket.send('42' + JSON.stringify(['message', { text: `t=${Date.now()}` }]));
            sent.add(1);
          }, MSG_EVERY_S * 1000);
        }
        return;
      }
      if (raw.startsWith('42["message"')) {
        received.add(1);
        const msg = JSON.parse(raw.slice(2))[1];
        const m = /^t=(\d+)$/.exec(msg && msg.text);
        if (m && msg.username === me) fanout.add(Date.now() - Number(m[1]));
      }
    });
    socket.on('close', () => {
      if (!closedByUs) disconnects.add(1);
    });
    socket.setTimeout(() => {
      closedByUs = true;
      socket.close();
    }, Math.max(1000, data.closeAt - Date.now()));
  });
  check(res, { 'ws 101': (r) => r && r.status === 101 });
}
