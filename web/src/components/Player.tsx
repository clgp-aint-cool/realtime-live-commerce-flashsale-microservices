import { useEffect, useRef, useState } from 'react';
import { config } from '../config';

// Kiểu tối thiểu của IVS Player SDK (nạp qua thẻ <script> từ CDN của AWS).
interface IvsPlayer {
  attachHTMLVideoElement(el: HTMLVideoElement): void;
  load(url: string): void;
  play(): void;
  delete(): void;
  addEventListener(event: string, cb: (payload: unknown) => void): void;
}
interface IvsSdk {
  isPlayerSupported: boolean;
  create(): IvsPlayer;
  PlayerState: Record<string, string>;
  PlayerEventType: Record<string, string>;
}
declare global {
  interface Window {
    IVSPlayer?: IvsSdk;
  }
}

let sdkPromise: Promise<IvsSdk> | null = null;
function loadSdk(src: string): Promise<IvsSdk> {
  sdkPromise ??= new Promise((resolve, reject) => {
    if (window.IVSPlayer) return resolve(window.IVSPlayer);
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => (window.IVSPlayer ? resolve(window.IVSPlayer) : reject(new Error('SDK không khởi tạo')));
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error('Không tải được IVS Player SDK'));
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

// Timed metadata do người bán gửi qua PutMetadata (ví dụ ghim sản phẩm), đồng bộ với khung hình.
export type MetadataHandler = (data: Record<string, unknown>) => void;

export function Player({ playbackUrl, onMetadata }: { playbackUrl: string; onMetadata?: MetadataHandler }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<string>(playbackUrl ? 'Đang kết nối…' : '');
  const [muted, setMuted] = useState(true);
  const metadataRef = useRef(onMetadata);
  metadataRef.current = onMetadata;

  // React không cập nhật thuộc tính muted sau lần render đầu: gán trực tiếp.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  useEffect(() => {
    if (!playbackUrl || !videoRef.current) return;
    let player: IvsPlayer | null = null;
    let cancelled = false;

    loadSdk(config.ivsPlayerSdkUrl)
      .then((sdk) => {
        if (cancelled || !videoRef.current) return;
        if (!sdk.isPlayerSupported) return setStatus('Trình duyệt không hỗ trợ IVS Player');
        player = sdk.create();
        player.attachHTMLVideoElement(videoRef.current);
        player.addEventListener(sdk.PlayerState.PLAYING, () => setStatus(''));
        player.addEventListener(sdk.PlayerState.ENDED, () => setStatus('Buổi live đã kết thúc'));
        player.addEventListener(sdk.PlayerEventType.ERROR, () => setStatus('Kênh chưa phát hoặc đã dừng'));
        player.addEventListener(sdk.PlayerEventType.TEXT_METADATA_CUE, (cue) => {
          try {
            metadataRef.current?.(JSON.parse((cue as { text: string }).text));
          } catch {
            // metadata không phải JSON của mình: bỏ qua
          }
        });
        player.load(playbackUrl);
        player.play();
      })
      .catch((err: Error) => setStatus(err.message));

    return () => {
      cancelled = true;
      player?.delete();
    };
  }, [playbackUrl]);

  return (
    <div className="player">
      <video ref={videoRef} playsInline muted />
      {!playbackUrl && <div className="player-overlay">Phiên live chưa có playback URL</div>}
      {playbackUrl && status && (
        <div className="player-overlay">
          <span className="spinner" aria-hidden />
          {status}
        </div>
      )}
      {/* Trình duyệt chỉ cho tự phát khi tắt tiếng: người xem bấm để bật */}
      <button className={muted ? 'unmute pulse' : 'unmute'} onClick={() => setMuted((m) => !m)}>
        {muted ? '🔇 Bật tiếng' : '🔊'}
      </button>
    </div>
  );
}
