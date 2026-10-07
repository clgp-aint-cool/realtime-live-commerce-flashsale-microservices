import {
  ChannelLatencyMode,
  ChannelType,
  CreateChannelCommand,
  CreateStreamKeyCommand,
  DeleteChannelCommand,
  DeleteStreamKeyCommand,
  GetStreamKeyCommand,
  IvsClient,
  ListStreamsCommand,
  PutMetadataCommand,
  StopStreamCommand,
} from '@aws-sdk/client-ivs';
import { Logger } from '@nestjs/common';
import { CreatedChannel, IvsGateway, PutMetadataResult, StreamInfo } from './ivs.gateway';

const isNotBroadcasting = (err: unknown) => (err as Error)?.name === 'ChannelNotBroadcasting';
const isThrottled = (err: unknown) => (err as Error)?.name === 'ThrottlingException';

// Thông tin đăng nhập lấy theo chuỗi mặc định của AWS SDK: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
// (từ SealedSecret trên K8s). Region: AWS_REGION.
export class AwsIvsGateway extends IvsGateway {
  readonly mode = 'aws' as const;
  private readonly logger = new Logger(AwsIvsGateway.name);
  private readonly client = new IvsClient({ region: process.env.AWS_REGION ?? 'ap-southeast-1' });
  private readonly recordingConfigurationArn = process.env.IVS_RECORDING_CONFIGURATION_ARN || undefined;
  private readonly channelType = (process.env.IVS_CHANNEL_TYPE ?? 'STANDARD') as ChannelType;
  private readonly latencyMode = (process.env.IVS_LATENCY_MODE ?? 'LOW') as ChannelLatencyMode;

  async createChannel(name: string, tags: Record<string, string>): Promise<CreatedChannel> {
    const res = await this.client.send(
      new CreateChannelCommand({
        name,
        type: this.channelType,
        latencyMode: this.latencyMode,
        // Recording configuration dùng chung: ghi thumbnail ra S3 cho luồng moderation hình ảnh.
        recordingConfigurationArn: this.recordingConfigurationArn,
        tags,
      }),
    );
    const { channel, streamKey } = res;
    if (!channel?.arn || !channel.ingestEndpoint || !channel.playbackUrl || !streamKey?.arn) {
      throw new Error('CreateChannel trả về thiếu thông tin');
    }
    // Không giữ streamKey.value: chỉ lưu ARN, lấy giá trị bằng GetStreamKey khi người bán cần.
    return {
      channelArn: channel.arn,
      ingestEndpoint: channel.ingestEndpoint,
      playbackUrl: channel.playbackUrl,
      streamKeyArn: streamKey.arn,
    };
  }

  async deleteChannel(channelArn: string): Promise<void> {
    await this.client.send(new DeleteChannelCommand({ arn: channelArn }));
  }

  async getStreamKeyValue(streamKeyArn: string): Promise<string> {
    const res = await this.client.send(new GetStreamKeyCommand({ arn: streamKeyArn }));
    if (!res.streamKey?.value) throw new Error('GetStreamKey không trả về giá trị');
    return res.streamKey.value;
  }

  async createStreamKey(channelArn: string): Promise<string> {
    const res = await this.client.send(new CreateStreamKeyCommand({ channelArn }));
    if (!res.streamKey?.arn) throw new Error('CreateStreamKey không trả về ARN');
    return res.streamKey.arn;
  }

  async deleteStreamKey(streamKeyArn: string): Promise<void> {
    await this.client.send(new DeleteStreamKeyCommand({ arn: streamKeyArn }));
  }

  async listLiveStreams(): Promise<StreamInfo[]> {
    const streams: StreamInfo[] = [];
    let nextToken: string | undefined;
    do {
      const res = await this.client.send(new ListStreamsCommand({ nextToken, maxResults: 100 }));
      for (const s of res.streams ?? []) {
        if (!s.channelArn) continue;
        streams.push({
          channelArn: s.channelArn,
          state: s.state === 'LIVE' ? 'LIVE' : 'OFFLINE',
          viewerCount: s.viewerCount ?? 0,
          startTime: s.startTime?.toISOString(),
        });
      }
      nextToken = res.nextToken;
    } while (nextToken);
    return streams;
  }

  async stopStream(channelArn: string): Promise<void> {
    try {
      await this.client.send(new StopStreamCommand({ channelArn }));
    } catch (err) {
      if (!isNotBroadcasting(err)) throw err;
    }
  }

  async putMetadata(channelArn: string, metadata: string): Promise<PutMetadataResult> {
    try {
      await this.client.send(new PutMetadataCommand({ channelArn, metadata }));
      return 'sent';
    } catch (err) {
      if (isNotBroadcasting(err)) return 'not_broadcasting';
      if (isThrottled(err)) return 'throttled';
      this.logger.error(`PutMetadata lỗi: ${(err as Error).message}`);
      throw err;
    }
  }
}
