// Những gì live-manager cần từ Amazon IVS. Có hai bản cài đặt:
//   - AwsIvsGateway: gọi IVS thật bằng IAM user quyền tối thiểu (IVS_MODE=aws)
//   - MockIvsGateway: giả lập trong Redis để chạy docker compose / e2e không cần AWS (IVS_MODE=mock)
export interface CreatedChannel {
  channelArn: string;
  ingestEndpoint: string;
  playbackUrl: string;
  streamKeyArn: string;
}

export interface StreamInfo {
  channelArn: string;
  state: 'LIVE' | 'OFFLINE';
  viewerCount: number;
  startTime?: string;
}

// Kênh demo do scripts/seed-demo.cjs tạo: ARN giả, phát luồng mẫu công khai của AWS, không tồn tại trên IVS.
// Luôn coi là LIVE và không gọi IVS cho chúng.
export const DEMO_CHANNEL_PREFIX = 'arn:demo:ivs:';
export const isDemoChannel = (channelArn: string) => channelArn.startsWith(DEMO_CHANNEL_PREFIX);

export type PutMetadataResult = 'sent' | 'not_broadcasting' | 'throttled';

export abstract class IvsGateway {
  abstract readonly mode: 'aws' | 'mock';
  abstract createChannel(name: string, tags: Record<string, string>): Promise<CreatedChannel>;
  abstract deleteChannel(channelArn: string): Promise<void>;
  /** Giá trị stream key; chỉ trả cho chính người bán. */
  abstract getStreamKeyValue(streamKeyArn: string): Promise<string>;
  abstract createStreamKey(channelArn: string): Promise<string>;
  abstract deleteStreamKey(streamKeyArn: string): Promise<void>;
  /** Tất cả stream đang phát trong region (ListStreams, có phân trang). */
  abstract listLiveStreams(): Promise<StreamInfo[]>;
  /** Dừng stream nếu đang phát; không lỗi nếu kênh đang offline. */
  abstract stopStream(channelArn: string): Promise<void>;
  abstract putMetadata(channelArn: string, metadata: string): Promise<PutMetadataResult>;
}

/** URL server điền vào OBS. IVS nhận RTMPS ở cổng 443, application "app". */
export const ingestServer = (ingestEndpoint: string) => `rtmps://${ingestEndpoint}:443/app/`;
