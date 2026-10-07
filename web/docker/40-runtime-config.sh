#!/bin/sh
# Chạy bởi entrypoint của image nginx trước khi nginx khởi động.
# Sinh config.js từ biến môi trường để một image dùng được cho mọi môi trường (dev, prod).
# playbackUrl không còn ở đây: trang người xem lấy theo từng phiên từ GET /api/lives/:id.
set -eu

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

cat > /usr/share/nginx/html/config.js <<CONFIG
window.__APP_CONFIG__ = {
  ivsPlayerSdkUrl: "$(json_escape "${IVS_PLAYER_SDK_URL:-https://player.live-video.net/1.57.0/amazon-ivs-player.min.js}")"
};
CONFIG
echo "runtime config: IVS_PLAYER_SDK_URL=${IVS_PLAYER_SDK_URL:-<mặc định>}"
