import { randomBytes, randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { CreatedChannel, IvsGateway, PutMetadataResult, StreamInfo } from './ivs.gateway';

// Giả lập IVS cho môi trường local. Lưu trạng thái trong Redis để nhiều replica thấy giống nhau.
// Mọi kênh mock được coi là "đang phát" (như thể OBS đã kết nối), viewerCount = 0.
const ACCOUNT = '000000000000';
const REGION = 'ap-southeast-1';
const channelsKey = 'mockivs:channels';
const keyKey = (arn: string) => `mockivs:streamkey:${arn}`;
export const mockMetadataKey = (channelArn: string) => `mockivs:metadata:${channelArn}`;

export class MockIvsGateway extends IvsGateway {
  readonly mode = 'mock' as const;
  private readonly playbackUrl = process.env.MOCK_PLAYBACK_URL ?? '';
  private readonly ingestEndpoint = process.env.MOCK_INGEST_ENDPOINT ?? 'mock.global-contribute.live-video.net';

  constructor(private readonly redis: Redis) {
    super();
  }

  async createChannel(): Promise<CreatedChannel> {
    const id = randomUUID().replace(/-/g, '').slice(0, 12);
    const channelArn = `arn:aws:ivs:${REGION}:${ACCOUNT}:channel/${id}`;
    await this.redis.sadd(channelsKey, channelArn);
    return {
      channelArn,
      ingestEndpoint: this.ingestEndpoint,
      playbackUrl: this.playbackUrl,
      streamKeyArn: await this.createStreamKey(channelArn),
    };
  }

  async deleteChannel(channelArn: string): Promise<void> {
    await this.redis.srem(channelsKey, channelArn);
  }

  async getStreamKeyValue(streamKeyArn: string): Promise<string> {
    const value = await this.redis.get(keyKey(streamKeyArn));
    if (!value) throw Object.assign(new Error('Stream key không tồn tại'), { name: 'ResourceNotFoundException' });
    return value;
  }

  async createStreamKey(channelArn: string): Promise<string> {
    const id = randomUUID().replace(/-/g, '').slice(0, 12);
    const arn = `arn:aws:ivs:${REGION}:${ACCOUNT}:stream-key/${id}`;
    await this.redis.set(keyKey(arn), `sk_${REGION}_${randomBytes(18).toString('base64url')}`);
    return arn;
  }

  async deleteStreamKey(streamKeyArn: string): Promise<void> {
    await this.redis.del(keyKey(streamKeyArn));
  }

  async listLiveStreams(): Promise<StreamInfo[]> {
    const arns = await this.redis.smembers(channelsKey);
    return arns.map((channelArn) => ({ channelArn, state: 'LIVE' as const, viewerCount: 0 }));
  }

  async stopStream(): Promise<void> {}

  async putMetadata(channelArn: string, metadata: string): Promise<PutMetadataResult> {
    await this.redis.set(mockMetadataKey(channelArn), metadata);
    return 'sent';
  }
}
