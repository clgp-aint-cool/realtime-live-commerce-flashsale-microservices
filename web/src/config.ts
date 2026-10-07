export interface AppConfig {
  ivsPlayerSdkUrl: string;
}

declare global {
  interface Window {
    __APP_CONFIG__?: Partial<AppConfig>;
  }
}

// playbackUrl không còn cấu hình cố định: mỗi phiên live lấy từ GET /api/lives/:id.
export const config: AppConfig = {
  ivsPlayerSdkUrl: 'https://player.live-video.net/1.57.0/amazon-ivs-player.min.js',
  ...window.__APP_CONFIG__,
};
