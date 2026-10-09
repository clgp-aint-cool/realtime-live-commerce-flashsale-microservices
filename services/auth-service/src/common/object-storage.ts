import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

// Ảnh lưu trên Object Storage S3 của CMC Cloud, DB chỉ giữ URL công khai.
// Trình duyệt PUT thẳng file lên S3 bằng presigned URL: ảnh không đi qua pod, không vào PostgreSQL.
// Bản sao giống hệt ở live-manager/src/common/object-storage.ts: sửa thì sửa cả hai.
//
// Biến: S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (Secret),
//       S3_PUBLIC_URL (gốc URL đọc ảnh; mặc định <endpoint>/<bucket>), S3_FORCE_PATH_STYLE (mặc định true),
//       S3_PRESIGN_ENDPOINT (tùy chọn: endpoint trình duyệt thấy, khi khác endpoint nội bộ, ví dụ MinIO trong docker-compose).
// Không đặt S3_BUCKET thì tắt upload (503), các chức năng khác vẫn chạy.

export const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PRESIGN_TTL_S = 300;

export interface ImageUpload {
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  publicUrl: string;
  expiresIn: number;
}

@Injectable()
export class ObjectStorage {
  private readonly logger = new Logger(ObjectStorage.name);
  private readonly bucket = process.env.S3_BUCKET ?? '';
  private readonly endpoint = (process.env.S3_ENDPOINT ?? '').replace(/\/+$/, '');
  private readonly publicBase = (process.env.S3_PUBLIC_URL || `${this.endpoint}/${this.bucket}`).replace(/\/+$/, '');
  private readonly client = this.makeClient(this.endpoint);
  // Ký URL không cần gọi mạng: dùng client riêng nếu trình duyệt truy cập S3 qua host khác.
  private readonly signer = process.env.S3_PRESIGN_ENDPOINT ? this.makeClient(process.env.S3_PRESIGN_ENDPOINT) : this.client;

  private makeClient(endpoint: string): S3Client | null {
    return this.bucket
      ? new S3Client({
          endpoint: endpoint || undefined,
          region: process.env.S3_REGION || 'us-east-1',
          forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
          // Khai báo tường minh: không để SDK lấy nhầm credential AWS khác trong môi trường.
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
          },
        })
      : null;
  }

  get enabled() {
    return this.client !== null;
  }

  // prefix do server quyết định (ví dụ products/<sellerId>), client chỉ chọn loại file và kích thước.
  async presignImage(prefix: string, contentType: unknown, size: unknown): Promise<ImageUpload> {
    if (!this.signer) throw new ServiceUnavailableException('Chưa cấu hình lưu trữ ảnh (S3_BUCKET)');
    const type = typeof contentType === 'string' ? contentType : '';
    const ext = IMAGE_TYPES[type];
    if (!ext) throw new BadRequestException('Chỉ nhận ảnh JPEG, PNG hoặc WebP');
    const bytes = Number(size);
    if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_IMAGE_BYTES) {
      throw new BadRequestException(`Ảnh tối đa ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
    }
    const key = `${prefix}/${randomUUID()}.${ext}`;
    // Ký cả content-type và content-length: S3 từ chối nếu file khác loại hoặc khác kích thước đã khai.
    const uploadUrl = await getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: type,
        ContentLength: bytes,
      }),
      {
        expiresIn: PRESIGN_TTL_S,
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    return {
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': type },
      publicUrl: `${this.publicBase}/${key}`,
      expiresIn: PRESIGN_TTL_S,
    };
  }

  // URL có phải ảnh do chính hệ thống cấp dưới prefix này không (chặn gán avatar là link tùy ý).
  owns(url: string, prefix: string): boolean {
    const base = `${this.publicBase}/${prefix}/`;
    return url.startsWith(base) && /^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(url.slice(base.length));
  }

  // Xóa ảnh cũ khi thay avatar. Lỗi chỉ ghi log: ảnh mồ côi không ảnh hưởng người dùng.
  async remove(url: string, prefix: string): Promise<void> {
    if (!this.client || !this.owns(url, prefix)) return;
    const key = url.slice(this.publicBase.length + 1);
    await this.client
      .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
      .catch((err: Error) => this.logger.warn(`Không xóa được ${key}: ${err.message}`));
  }
}
