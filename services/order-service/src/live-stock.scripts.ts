// Lua chạy nguyên tử trong Redis (một lệnh EVALSHA): không có request nào chen vào giữa
// bước kiểm tra tồn kho và bước trừ, nên không bao giờ bán quá số lượng.
// Kho được khóa theo (phiên live, sản phẩm); live-manager nạp khi mở phiên và xóa khi kết thúc.
//
// KEYS: 1=stock 2=buyers 3=seller   ARGV: 1=userId 2=quantity
// Trả về {code, sellerId}: 1 = thành công, 0 = hết hàng, -1 = phiên/sản phẩm không mở bán, -2 = user đã mua
export const RESERVE_LUA = `
local stock = redis.call('GET', KEYS[1])
if not stock then return {-1, ''} end
local seller = redis.call('GET', KEYS[3])
if not seller then return {-1, ''} end
if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then return {-2, ''} end
local qty = tonumber(ARGV[2])
if tonumber(stock) < qty then return {0, ''} end
redis.call('DECRBY', KEYS[1], qty)
redis.call('SADD', KEYS[2], ARGV[1])
return {1, seller}
`;

// Hoàn lại tồn kho khi ghi DB thất bại. Nếu phiên đã kết thúc (khóa stock bị xóa) thì không hoàn,
// tránh tạo lại khóa "mồ côi" làm phiên cũ bán tiếp được.
// KEYS: 1=stock 2=buyers   ARGV: 1=userId 2=quantity
export const RELEASE_LUA = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('INCRBY', KEYS[1], tonumber(ARGV[2]))
redis.call('SREM', KEYS[2], ARGV[1])
return 1
`;

export const RESERVE = {
  OK: 1,
  SOLD_OUT: 0,
  NOT_ACTIVE: -1,
  ALREADY_BOUGHT: -2,
} as const;
