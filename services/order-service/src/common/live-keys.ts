// Phải giữ giống hệt live-manager/src/common/live-keys.ts (live-manager ghi, order-service trừ kho).
// Khóa Redis của một phiên live. Hash tag {sessionId} đặt mọi khóa của phiên trên cùng slot
// (Lua vẫn chạy được nếu chuyển sang Redis Cluster). Phải giữ giống hệt bên order-service.
export const liveKeys = {
  seller: (sessionId: string) => `live:{${sessionId}}:seller`,
  stock: (sessionId: string, productId: number) => `live:{${sessionId}}:p:${productId}:stock`,
  initial: (sessionId: string, productId: number) => `live:{${sessionId}}:p:${productId}:initial`,
  buyers: (sessionId: string, productId: number) => `live:{${sessionId}}:p:${productId}:buyers`,
};
