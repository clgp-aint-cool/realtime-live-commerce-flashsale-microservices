export const MIGRATION = `
CREATE TABLE IF NOT EXISTS sellers (
  id              UUID PRIMARY KEY,
  name            TEXT NOT NULL,
  token_hash      TEXT UNIQUE NOT NULL,
  channel_arn     TEXT UNIQUE NOT NULL,
  ingest_endpoint TEXT NOT NULL,
  playback_url    TEXT NOT NULL,
  stream_key_arn  TEXT,              -- chỉ lưu ARN; giá trị key lấy bằng GetStreamKey khi cần
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS live_sessions (
  id                UUID PRIMARY KEY,
  seller_id         UUID NOT NULL REFERENCES sellers (id),
  title             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ENDED')),
  pinned_product_id INTEGER,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ
);
-- Mỗi người bán có một kênh IVS nên chỉ mở được một phiên tại một thời điểm.
CREATE UNIQUE INDEX IF NOT EXISTS live_sessions_one_open_per_seller ON live_sessions (seller_id) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS live_sessions_status_idx ON live_sessions (status, started_at DESC);

CREATE TABLE IF NOT EXISTS session_products (
  session_id    UUID NOT NULL REFERENCES live_sessions (id),
  product_id    INTEGER NOT NULL,
  initial_stock INTEGER NOT NULL CHECK (initial_stock >= 0),
  position      INTEGER NOT NULL,
  PRIMARY KEY (session_id, product_id)
);
`;

export interface SellerRow {
  id: string;
  name: string;
  token_hash: string;
  channel_arn: string;
  ingest_endpoint: string;
  playback_url: string;
  stream_key_arn: string | null;
  created_at: Date;
}

export interface SessionRow {
  id: string;
  seller_id: string;
  title: string;
  status: 'OPEN' | 'ENDED';
  pinned_product_id: number | null;
  started_at: Date;
  ended_at: Date | null;
}
