// Cấu hình bucket ảnh (S3 của CMC Cloud hoặc RustFS local), chạy lại bao nhiêu lần cũng được:
//   1. tạo bucket nếu chưa có
//   2. policy: ai cũng đọc được products/* và avatars/* (ảnh hiển thị trên web), phần còn lại riêng tư
//   3. CORS: trình duyệt từ S3_CORS_ORIGINS được PUT (presigned URL) và GET
//
// Biến: S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE,
//       S3_CORS_ORIGINS (phân tách bằng dấu phẩy, ví dụ https://cmc-cloud-hcm1.cloud).
// Cần @aws-sdk/client-s3: chạy trong image live-manager (cwd /app), xem docs/object-storage.md bên repo infra.
const { S3Client, CreateBucketCommand, HeadBucketCommand, PutBucketPolicyCommand, PutBucketCorsCommand } = require('@aws-sdk/client-s3');

const env = (name, fallback) => {
  const value = process.env[name] || fallback;
  if (value === undefined) throw new Error(`Thiếu biến ${name}`);
  return value;
};
const bucket = env('S3_BUCKET');
const origins = env('S3_CORS_ORIGINS').split(',').map((o) => o.trim()).filter(Boolean);
const s3 = new S3Client({
  endpoint: env('S3_ENDPOINT'),
  region: env('S3_REGION', 'us-east-1'),
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  credentials: { accessKeyId: env('S3_ACCESS_KEY_ID'), secretAccessKey: env('S3_SECRET_ACCESS_KEY') },
});

(async () => {
  const exists = await s3.send(new HeadBucketCommand({ Bucket: bucket })).then(() => true, () => false);
  if (!exists) await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log(`bucket ${bucket}: ${exists ? 'đã có' : 'đã tạo'}`);

  const policy = {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'PublicReadImages',
        Effect: 'Allow',
        Principal: '*',
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/products/*`, `arn:aws:s3:::${bucket}/avatars/*`],
      },
    ],
  };
  await s3.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify(policy) }));
  console.log('policy: đọc công khai products/*, avatars/*');

  await s3.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [{ AllowedOrigins: origins, AllowedMethods: ['PUT', 'GET'], AllowedHeaders: ['content-type'], MaxAgeSeconds: 3600 }],
      },
    }),
  );
  console.log(`cors: PUT/GET từ ${origins.join(', ')}`);
})().catch((err) => {
  console.error(`Lỗi: ${err.name}: ${err.message}`);
  process.exit(1);
});
