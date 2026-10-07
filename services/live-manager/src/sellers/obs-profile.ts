import { strToU8, zipSync } from 'fflate';
import { ingestServer } from '../ivs/ivs.gateway';

// Sinh profile OBS Studio (thư mục gồm basic.ini, service.json, streamEncoder.json) đã điền sẵn
// server + stream key của người bán, nén zip để tải về.
// Người bán: giải nén → OBS > Profile > Import → chọn thư mục vừa giải nén.
//
// CHƯA KIỂM CHỨNG trên mọi bản OBS: định dạng dựa trên cấu trúc profile của OBS Studio 28-31.
// Cấu hình encoder theo khuyến nghị IVS: CBR, keyframe 2 giây, 720p30 ~3,5 Mbps.

const safeAscii = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'seller';

export function buildObsProfileZip(sellerName: string, ingestEndpoint: string, streamKey: string) {
  const folder = `LiveCommerce-${safeAscii(sellerName)}`;
  const profileName = `LiveCommerce - ${sellerName.replace(/[\r\n\[\]=]/g, ' ').trim()}`;

  const basicIni = [
    '[General]',
    `Name=${profileName}`,
    '',
    '[Output]',
    'Mode=Advanced',
    '',
    '[AdvOut]',
    'Encoder=obs_x264',
    'ApplyServiceSettings=true',
    'TrackIndex=1',
    '',
    '[Video]',
    'BaseCX=1280',
    'BaseCY=720',
    'OutputCX=1280',
    'OutputCY=720',
    'FPSType=0',
    'FPSCommon=30',
    '',
    '[Audio]',
    'SampleRate=48000',
    'ChannelSetup=Stereo',
    '',
  ].join('\r\n');

  const service = {
    type: 'rtmp_custom',
    settings: {
      server: ingestServer(ingestEndpoint),
      key: streamKey,
      use_auth: false,
      bwtest: false,
    },
  };

  const encoder = {
    rate_control: 'CBR',
    bitrate: 3500,
    keyint_sec: 2,
    preset: 'veryfast',
    profile: 'main',
    tune: 'zerolatency',
  };

  const readme = [
    'Profile OBS cho Live Commerce',
    '',
    '1. Giải nén file zip này.',
    '2. Mở OBS Studio > menu Profile > Import, chọn thư mục ' + folder + '.',
    '3. Profile > chọn "' + profileName + '".',
    '4. Settings > Stream: kiểm tra Server bắt đầu bằng rtmps:// và Stream Key đã được điền.',
    '5. Bấm Start Streaming.',
    '',
    'GIỮ BÍ MẬT stream key. Nếu lộ, vào trang người bán bấm "Đặt lại key" rồi tải lại profile.',
    '',
  ].join('\r\n');

  return {
    filename: `${folder}.zip`,
    data: zipSync({
      [folder]: {
        'basic.ini': strToU8(basicIni),
        'service.json': strToU8(JSON.stringify(service, null, 2)),
        'streamEncoder.json': strToU8(JSON.stringify(encoder, null, 2)),
      },
      'DOC-TOI.txt': strToU8(readme),
    }),
  };
}
