// Dữ liệu demo: 10 người bán (kênh mock, không gọi AWS), 100 sản phẩm mô hình anime / manga / light novel,
// mỗi người bán một phiên live mở sẵn 24/24 phát luồng mẫu công khai của AWS IVS.
// Chạy lại được nhiều lần (idempotent). Chạy trong cluster bằng image live-manager (có sẵn pg + ioredis):
//
//   kubectl -n live-commerce-dev run seed-demo --rm -i --restart=Never \
//     --image=192.168.6.194/live-commerce/live-manager:<TAG> \
//     --overrides='{"spec":{"imagePullSecrets":[{"name":"harbor-registry"}],"containers":[{"name":"seed-demo","image":"192.168.6.194/live-commerce/live-manager:<TAG>","stdin":true,"workingDir":"/app","command":["node","-"],"envFrom":[{"secretRef":{"name":"live-manager-secret"}}],"env":[{"name":"SEED_MODE","value":"seed"}]}]}}' \
//     < scripts/seed-demo.cjs
//
// SEED_MODE=clean: kết thúc phiên demo, xóa kho Redis của chúng (giữ người bán/sản phẩm vì đơn hàng có thể tham chiếu).
// Biến: DATABASE_URL, REDIS_URL (từ live-manager-secret), DEMO_PLAYBACK_URL (đặt thì mọi người bán dùng chung 1 luồng;
// mặc định chia lần lượt các luồng mẫu 24/7 công khai của AWS, lấy từ https://ivs.rocks/live/).
'use strict';
const { createHash, randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const Redis = require('ioredis');

// Kênh demo: ARN giả có tiền tố này. live-manager coi là luôn LIVE và không gọi IVS cho chúng.
const DEMO_PREFIX = 'arn:demo:ivs:';
const PLAYBACKS = process.env.DEMO_PLAYBACK_URL
  ? [process.env.DEMO_PLAYBACK_URL]
  : [
      'https://fcc3ddae59ed.us-west-2.playback.live-video.net/api/video/v1/us-west-2.893648527354.channel.DmumNckWFTqz.m3u8',
      'https://4c62a87c1810.us-west-2.playback.live-video.net/api/video/v1/us-west-2.049054135175.channel.LaSuL3bHBRR7.m3u8', // 1080p ngang
      'https://4c62a87c1810.us-west-2.playback.live-video.net/api/video/v1/us-west-2.049054135175.channel.WP4bWqiALo67.m3u8', // 1080p vuông
      'https://4c62a87c1810.us-west-2.playback.live-video.net/api/video/v1/us-west-2.049054135175.channel.iNMK0w9JnUkC.m3u8', // 1080p dọc
    ];

// UUID cố định theo tên để chạy lại không tạo trùng.
const uuidFrom = (s) => {
  const h = createHash('sha256').update(`lc-demo:${s}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
// Ảnh minh họa lấy từ CDN AniList (nhân vật / bìa manga, LN, anime liên quan tới tên sản phẩm).
// Bản quyền thuộc tác giả/nhà phát hành: chỉ dùng cho demo. Thiếu SKU thì rơi về ảnh ngẫu nhiên picsum.
const IMAGES = {
  'DEMO-AKIBA-FIGURE-01': 'https://s4.anilist.co/file/anilistcdn/character/large/b176754-PCnpqIOkjhFk.png',
  'DEMO-AKIBA-FIGURE-02': 'https://s4.anilist.co/file/anilistcdn/character/large/b88575-Ayu8UPDA8NS6.png',
  'DEMO-AKIBA-FIGURE-03': 'https://s4.anilist.co/file/anilistcdn/character/large/b36828-j5ib0adAzGMx.png',
  'DEMO-AKIBA-FIGURE-04': 'https://s4.anilist.co/file/anilistcdn/character/large/b137080-UHcynYNjb5ZU.png',
  'DEMO-AKIBA-FIGURE-05': 'https://s4.anilist.co/file/anilistcdn/character/large/b89361-tq8PQQ4MmF0M.png',
  'DEMO-AKIBA-FIGURE-06': 'https://s4.anilist.co/file/anilistcdn/character/large/b40881-F3gr1PkreDvj.png',
  'DEMO-AKIBA-FIGURE-07': 'https://s4.anilist.co/file/anilistcdn/character/large/b137079-6yLEUYR3bmpr.png',
  'DEMO-AKIBA-FIGURE-08': 'https://s4.anilist.co/file/anilistcdn/character/large/b124381-2gAVq76HPfL2.png',
  'DEMO-AKIBA-FIGURE-09': 'https://s4.anilist.co/file/anilistcdn/character/large/b70069-DEV7X6o2L7oG.jpg',
  'DEMO-AKIBA-FIGURE-10': 'https://s4.anilist.co/file/anilistcdn/character/large/b61-ywXUyyocEEqt.png',
  'DEMO-NENDO-PARADISE-01': 'https://s4.anilist.co/file/anilistcdn/character/large/b138100-4Li0tWRCa5bQ.png',
  'DEMO-NENDO-PARADISE-02': 'https://s4.anilist.co/file/anilistcdn/character/large/b127691-9zqh1xpIubn7.png',
  'DEMO-NENDO-PARADISE-03': 'https://s4.anilist.co/file/anilistcdn/character/large/b257562-Ru35NYPfsqhY.png',
  'DEMO-NENDO-PARADISE-04': 'https://s4.anilist.co/file/anilistcdn/character/large/b126071-BTNEc1nRIv68.png',
  'DEMO-NENDO-PARADISE-05': 'https://s4.anilist.co/file/anilistcdn/character/large/b7156-DUwViOmpWw2B.jpg',
  'DEMO-NENDO-PARADISE-06': 'https://s4.anilist.co/file/anilistcdn/character/large/b40-MNypXsxSRb1R.png',
  'DEMO-NENDO-PARADISE-07': 'https://s4.anilist.co/file/anilistcdn/character/large/b120649-NPaWaIpWy60E.png',
  'DEMO-NENDO-PARADISE-08': 'https://s4.anilist.co/file/anilistcdn/character/large/b183965-uGFohBjlFoTp.png',
  'DEMO-NENDO-PARADISE-09': 'https://s4.anilist.co/file/anilistcdn/character/large/b172759-cccVhJ2fQA92.png',
  'DEMO-NENDO-PARADISE-10': 'https://s4.anilist.co/file/anilistcdn/character/large/b121103-UGLxT8utLPnq.png',
  'DEMO-GUNDAM-BASE-SG-01': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx80-pdYJ12vSTmad.jpg',
  'DEMO-GUNDAM-BASE-SG-02': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx87-SCCIlaJZjSvz.png',
  'DEMO-GUNDAM-BASE-SG-03': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx139274-0NJTOKWHdDew.png',
  'DEMO-GUNDAM-BASE-SG-04': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx80-pdYJ12vSTmad.jpg',
  'DEMO-GUNDAM-BASE-SG-05': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx94-tng83ksiXm5E.jpg',
  'DEMO-GUNDAM-BASE-SG-06': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx87-SCCIlaJZjSvz.png',
  'DEMO-GUNDAM-BASE-SG-07': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx114842-AMEG5qd5h6Fw.jpg',
  'DEMO-GUNDAM-BASE-SG-08': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx134761-UCVG3V6t6gJq.jpg',
  'DEMO-GUNDAM-BASE-SG-09': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/b90-umBjF3yaeIdo.png',
  'DEMO-GUNDAM-BASE-SG-10': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx19319-0YuU672PSgix.jpg',
  'DEMO-MANGA-CORNER-01': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx30013-BeslEMqiPhlk.jpg',
  'DEMO-MANGA-CORNER-02': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx105778-euxXZEIfDY2u.png',
  'DEMO-MANGA-CORNER-03': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx101517-H3TdM3g5ZUe9.jpg',
  'DEMO-MANGA-CORNER-04': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx108556-NHjkz0BNJhLx.jpg',
  'DEMO-MANGA-CORNER-05': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx53390-1RsuABC34P9D.jpg',
  'DEMO-MANGA-CORNER-06': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx31032-EnHYnoLVqlWG.jpg',
  'DEMO-MANGA-CORNER-07': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx31061-SJQb7931MG7m.jpg',
  'DEMO-MANGA-CORNER-08': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx86508-QSahE7mTFEXl.png',
  'DEMO-MANGA-CORNER-09': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx106130-yPNeuSu75ey1.jpg',
  'DEMO-MANGA-CORNER-10': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx118586-CXKgWikBFQgS.jpg',
  'DEMO-LIGHTNOVEL-STATION-01': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx165131-R4pedWdbZiAW.jpg',
  'DEMO-LIGHTNOVEL-STATION-02': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx85737-WkWOr5EgwPyo.jpg',
  'DEMO-LIGHTNOVEL-STATION-03': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx85976-hVr99G1kD1M5.png',
  'DEMO-LIGHTNOVEL-STATION-04': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx73921-HKvbNY03AzY0.jpg',
  'DEMO-LIGHTNOVEL-STATION-05': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx94970-q77X5sfRIKvU.jpg',
  'DEMO-LIGHTNOVEL-STATION-06': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx39115-2uLgBuM30i1b.jpg',
  'DEMO-LIGHTNOVEL-STATION-07': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/nx99026-5Eg650WAd9Rj.jpg',
  'DEMO-LIGHTNOVEL-STATION-08': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx86355-pGwmLqVTwwE4.jpg',
  'DEMO-LIGHTNOVEL-STATION-09': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx30399-ePRU1jgaOBCG.jpg',
  'DEMO-LIGHTNOVEL-STATION-10': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx145157-RS52tkBY4YSB.jpg',
  'DEMO-SHONEN-SHELF-01': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/nx30011-9yUF1dXWgDOx.jpg',
  'DEMO-SHONEN-SHELF-02': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx30012-1epmVfTSv2rr.png',
  'DEMO-SHONEN-SHELF-03': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx30026-uCvXMudMzmwI.jpg',
  'DEMO-SHONEN-SHELF-04': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx85486-INqnYx8gL3eX.jpg',
  'DEMO-SHONEN-SHELF-05': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx87216-c9bSNVD10UuD.png',
  'DEMO-SHONEN-SHELF-06': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx181735-xIoXaQmtjkuC.png',
  'DEMO-SHONEN-SHELF-07': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/medium/b98416-L44f4idEGMAX.jpg',
  'DEMO-SHONEN-SHELF-08': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx125828-p78Z8SflkfmO.jpg',
  'DEMO-SHONEN-SHELF-09': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx120760-MtXvMgujLBpe.jpg',
  'DEMO-SHONEN-SHELF-10': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx132029-prGF4gePdSKv.jpg',
  'DEMO-WAIFU-STUDIO-01': 'https://s4.anilist.co/file/anilistcdn/character/large/b133676-kV2czE3C8Qls.png',
  'DEMO-WAIFU-STUDIO-02': 'https://s4.anilist.co/file/anilistcdn/character/large/b127518-NRlq1CQ1v1ro.png',
  'DEMO-WAIFU-STUDIO-03': 'https://s4.anilist.co/file/anilistcdn/character/large/b138102-ZOAu9jI2d5ke.png',
  'DEMO-WAIFU-STUDIO-04': 'https://s4.anilist.co/file/anilistcdn/character/large/b7156-DUwViOmpWw2B.jpg',
  'DEMO-WAIFU-STUDIO-05': 'https://s4.anilist.co/file/anilistcdn/character/large/b260329-1Z5n1QgViEBI.png',
  'DEMO-WAIFU-STUDIO-06': 'https://s4.anilist.co/file/anilistcdn/character/large/b723-vp5hPptgnNEC.png',
  'DEMO-WAIFU-STUDIO-07': 'https://s4.anilist.co/file/anilistcdn/character/large/b126371-0KQpl80s8kXQ.png',
  'DEMO-WAIFU-STUDIO-08': 'https://s4.anilist.co/file/anilistcdn/character/large/b127222-Jh5hhP7vZ7s1.png',
  'DEMO-WAIFU-STUDIO-09': 'https://s4.anilist.co/file/anilistcdn/character/large/b217334-buImnwO26SgS.jpg',
  'DEMO-WAIFU-STUDIO-10': 'https://s4.anilist.co/file/anilistcdn/character/large/b183884-iyo3BmTuhJ0l.jpg',
  'DEMO-OTAKU-GOODS-01': 'https://s4.anilist.co/file/anilistcdn/character/large/b88032-YQOBGYKIpgnN.png',
  'DEMO-OTAKU-GOODS-02': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx113415-LHBAeoZDIsnF.jpg',
  'DEMO-OTAKU-GOODS-03': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx154587-qQTzQnEJJ3oB.jpg',
  'DEMO-OTAKU-GOODS-04': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/97962-3rBcawJt63sG.jpg',
  'DEMO-OTAKU-GOODS-05': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx140960-Kb6R5nYQfjmP.jpg',
  'DEMO-OTAKU-GOODS-06': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx118123-xqn5fYsjKXJU.png',
  'DEMO-OTAKU-GOODS-07': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx523-fErBvxOHP7IX.jpg',
  'DEMO-OTAKU-GOODS-08': 'https://s4.anilist.co/file/anilistcdn/character/large/b170266-bBXPkNJnd3mg.png',
  'DEMO-OTAKU-GOODS-09': 'https://s4.anilist.co/file/anilistcdn/character/large/b127691-9zqh1xpIubn7.png',
  'DEMO-OTAKU-GOODS-10': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx199-sWefXJvXkDOb.jpg',
  'DEMO-ISEKAI-BOOKS-01': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/nx86399-NwbRFVh5koqc.jpg',
  'DEMO-ISEKAI-BOOKS-02': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx85564-egXRASF0x9B9.jpg',
  'DEMO-ISEKAI-BOOKS-03': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx85934-QbxLx34J8D4o.png',
  'DEMO-ISEKAI-BOOKS-04': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/nx87259-yJMWileGmcl5.jpg',
  'DEMO-ISEKAI-BOOKS-05': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/nx85702-bViMuf2lzC0f.jpg',
  'DEMO-ISEKAI-BOOKS-06': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx105398-b673Vt5ZSuz3.jpg',
  'DEMO-ISEKAI-BOOKS-07': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx106758-jtXpQYQqyNJv.jpg',
  'DEMO-ISEKAI-BOOKS-08': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx85442-pIcvm2OjfTjR.jpg',
  'DEMO-ISEKAI-BOOKS-09': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx86082-MXizJxzbijdd.jpg',
  'DEMO-ISEKAI-BOOKS-10': 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx86952-ah2w3DFY2Uek.jpg',
  'DEMO-RETRO-ANIME-01': 'https://s4.anilist.co/file/anilistcdn/character/large/b2030-GQvVYPEYkXCy.jpg',
  'DEMO-RETRO-ANIME-02': 'https://s4.anilist.co/file/anilistcdn/character/large/246-wsRRr6z1kii8.png',
  'DEMO-RETRO-ANIME-03': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx30-AI1zr74Dh4ye.jpg',
  'DEMO-RETRO-ANIME-04': 'https://s4.anilist.co/file/anilistcdn/character/large/b1-ChxaldmieFlQ.png',
  'DEMO-RETRO-ANIME-05': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx47-4CR68arv452h.jpg',
  'DEMO-RETRO-ANIME-06': 'https://s4.anilist.co/file/anilistcdn/character/large/b1353-xsZhvfi7IFzT.png',
  'DEMO-RETRO-ANIME-07': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx30-AI1zr74Dh4ye.jpg',
  'DEMO-RETRO-ANIME-08': 'https://s4.anilist.co/file/anilistcdn/character/large/b147-miunGYp6fkzb.png',
  'DEMO-RETRO-ANIME-09': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx481-Qpqy1TQBOxZO.png',
  'DEMO-RETRO-ANIME-10': 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx523-fErBvxOHP7IX.jpg',
};
const img = (sku) => IMAGES[sku] ?? `https://picsum.photos/seed/${sku.toLowerCase()}/400/400`;

// [slug, tên người bán, tiêu đề phiên, [[tên, mô tả, giá], ...]]
const SELLERS = [
  ['akiba-figure', 'Akiba Figure House', 'Săn figure scale chính hãng giá mềm', [
    ['Figure 1/7 Frieren - Sousou no Frieren', 'Scale 1/7, cao 24cm, hàng chính hãng Good Smile', 3290000],
    ['Figure 1/7 Rem - Re:Zero Crystal Dress', 'Scale 1/7, váy pha lê, đế tròn', 3890000],
    ['Figure 1/8 Asuna - Sword Art Online', 'Scale 1/8, cao 21cm, phiên bản Undine', 2490000],
    ['Figure 1/7 Makima - Chainsaw Man', 'Scale 1/7, cao 26cm, tư thế ngồi', 3590000],
    ['Figure 1/6 Megumin - KonoSuba', 'Scale 1/6, kèm trượng phép, cao 28cm', 4190000],
    ['Figure 1/7 Mikasa Ackerman - Attack on Titan', 'Scale 1/7, kèm dao 3D maneuver', 2990000],
    ['Figure 1/7 Power - Chainsaw Man', 'Scale 1/7, cao 23cm, hàng Kotobukiya', 3190000],
    ['Figure 1/7 Zero Two - Darling in the Franxx', 'Scale 1/7, cao 25cm, đồng phục phi công', 3490000],
    ['Figure 1/8 Kurumi Tokisaki - Date A Live', 'Scale 1/8, váy gothic đỏ đen', 2790000],
    ['Figure 1/7 Nico Robin - One Piece', 'Scale 1/7, cao 27cm, phiên bản Egghead', 4590000],
  ]],
  ['nendo-paradise', 'Nendo Paradise', 'Nendoroid & chibi mở hộp trực tiếp', [
    ['Nendoroid Anya Forger - Spy x Family', 'Kèm 3 biểu cảm, đậu phộng mini', 990000],
    ['Nendoroid Gojo Satoru - Jujutsu Kaisen', 'Kèm băng mắt và hiệu ứng Vô Hạn', 1090000],
    ['Nendoroid Bocchi - Bocchi the Rock!', 'Kèm guitar Les Paul mini', 1050000],
    ['Nendoroid Tanjiro Kamado - Kimetsu no Yaiba', 'Kèm kiếm Nichirin và hiệu ứng nước', 950000],
    ['Nendoroid Hatsune Miku 2025', 'Phiên bản kỷ niệm, kèm hành lá', 1190000],
    ['Nendoroid Luffy Gear 5 - One Piece', 'Kèm hiệu ứng mây và mặt cười', 1150000],
    ['Nendoroid Kaguya Shinomiya - Love is War', 'Kèm quạt và biểu cảm "Đáng yêu quá"', 990000],
    ['Nendoroid Frieren - Sousou no Frieren', 'Kèm sách phép và trượng', 1090000],
    ['Nendoroid Ai Hoshino - Oshi no Ko', 'Kèm micro và đôi mắt ngôi sao', 1250000],
    ['Nendoroid Chika Fujiwara - Love is War', 'Kèm đàn karaoke, tư thế nhảy', 990000],
  ]],
  ['gundam-base-sg', 'Gundam Base Sài Gòn', 'Ráp Gunpla live cùng anh em', [
    ['Gunpla MG RX-78-2 Ver.3.0', 'Master Grade 1/100, khung trong chi tiết', 1290000],
    ['Gunpla RG Nu Gundam', 'Real Grade 1/144, kèm Fin Funnel', 990000],
    ['Gunpla HG Gundam Aerial - Witch from Mercury', 'High Grade 1/144, kèm khiên Bit', 390000],
    ['Gunpla PG Unleashed RX-78-2', 'Perfect Grade 1/60, khung kim loại', 6490000],
    ['Gunpla MG Strike Freedom Full Burst', 'Master Grade 1/100, cánh vàng mạ', 1990000],
    ['Gunpla RG Sazabi', 'Real Grade 1/144, kèm Funnel và khiên', 1190000],
    ['Gunpla HG Barbatos Lupus Rex', 'High Grade 1/144, kèm chùy', 420000],
    ['Gunpla MGEX Strike Freedom', 'Master Grade EX 1/100, đèn LED', 4990000],
    ['Gunpla SD Wing Zero EW', 'SD Cross Silhouette, ráp nhanh', 290000],
    ['Bộ kìm cắt Gunpla God Hand', 'Kìm 1 lưỡi chuyên dụng cho nhựa', 1190000],
  ]],
  ['manga-corner', 'Manga Corner VN', 'Đập hộp boxset manga bản đặc biệt', [
    ['Boxset One Piece tập 1-23 (Arc East Blue)', 'Bản tiếng Việt, hộp cứng kèm poster', 1290000],
    ['Chainsaw Man tập 1-11 trọn bộ phần 1', 'Bản tiếng Việt, kèm bookmark', 495000],
    ['Jujutsu Kaisen tập 0-25', 'Bản tiếng Việt, bìa áo', 1150000],
    ['Spy x Family tập 1-13', 'Bản tiếng Việt, tặng postcard', 520000],
    ['Attack on Titan Boxset trọn bộ 34 tập', 'Bản tiếng Việt, hộp cứng sưu tầm', 1890000],
    ['Doraemon truyện dài trọn bộ 24 tập', 'Bản kỷ niệm, bìa cứng', 960000],
    ['Thám tử lừng danh Conan tập 100 bản đặc biệt', 'Kèm standee và bọc plastic', 145000],
    ['Dragon Ball Super tập 1-21', 'Bản tiếng Việt', 420000],
    ['Blue Lock tập 1-25', 'Bản tiếng Việt, tặng thẻ nhân vật', 625000],
    ['Frieren tập 1-12', 'Bản tiếng Việt, bìa áo kim tuyến', 540000],
  ]],
  ['lightnovel-station', 'Light Novel Station', 'Light novel mới về, đọc thử trên live', [
    ['Light novel Mushoku Tensei tập 1-10', 'Bản tiếng Việt, kèm tranh màu', 1250000],
    ['Light novel Re:Zero tập 1-15', 'Bản tiếng Việt, bìa áo', 1650000],
    ['Light novel Overlord tập 1-8', 'Bản tiếng Việt, kèm postcard Ainz', 1120000],
    ['Light novel Sword Art Online Progressive 1-6', 'Bản tiếng Việt', 720000],
    ['Light novel Classroom of the Elite tập 1-11', 'Bản tiếng Việt, bìa áo', 1210000],
    ['Light novel Spice and Wolf tập 1-5', 'Bản tiếng Việt, bản đặc biệt', 650000],
    ['Light novel Kusuriya no Hitorigoto tập 1-6', 'Bản tiếng Việt (Dược Sư Tự Sự)', 840000],
    ['Light novel Tensura tập 1-10', 'Bản tiếng Việt (Chuyển sinh thành Slime)', 1300000],
    ['Light novel Kino no Tabi tập 1-4', 'Bản tiếng Việt, minh họa màu', 480000],
    ['Light novel Bunny Girl Senpai tập 1-9', 'Bản tiếng Việt, kèm bookmark', 990000],
  ]],
  ['shonen-shelf', 'Shonen Jump Shelf', 'Manga shounen hot nhất tuần', [
    ['Naruto Boxset tập 1-72', 'Bản tiếng Việt trọn bộ, hộp gỗ', 2590000],
    ['Bleach tập 1-74 trọn bộ', 'Bản tiếng Việt', 2490000],
    ['Hunter x Hunter tập 1-37', 'Bản tiếng Việt', 1290000],
    ['My Hero Academia tập 1-40', 'Bản tiếng Việt, bìa áo', 1390000],
    ['Kimetsu no Yaiba tập 1-23 trọn bộ', 'Bản tiếng Việt, kèm sticker', 805000],
    ['Haikyu!! tập 1-45 trọn bộ', 'Bản tiếng Việt', 1575000],
    ['Dr. Stone tập 1-26 trọn bộ', 'Bản tiếng Việt', 910000],
    ['Sakamoto Days tập 1-18', 'Bản tiếng Việt, tặng thẻ', 630000],
    ['Kaiju No.8 tập 1-14', 'Bản tiếng Việt', 490000],
    ['Dandadan tập 1-16', 'Bản tiếng Việt, bìa áo', 560000],
  ]],
  ['waifu-studio', 'Waifu Figure Studio', 'Prize figure giá sinh viên', [
    ['Prize figure Marin Kitagawa - Sono Bisque Doll', 'Hàng Taito, cao 18cm', 450000],
    ['Prize figure Nezuko Kamado - Noodle Stopper', 'Hàng Furyu, ngồi trên ly mì', 320000],
    ['Prize figure Yor Forger - Spy x Family', 'Hàng Sega, cao 20cm', 480000],
    ['Prize figure Hatsune Miku Racing', 'Hàng Bandai Spirits, cao 19cm', 420000],
    ['Prize figure Chisato Nishikigi - Lycoris Recoil', 'Hàng Sega, cao 18cm', 450000],
    ['Prize figure Nami - One Piece Glitter & Glamours', 'Hàng Banpresto, cao 25cm', 520000],
    ['Prize figure Ichika Nakano - 5Toubun', 'Hàng Taito, áo cưới', 460000],
    ['Prize figure Mai Sakurajima - Bunny Girl Senpai', 'Hàng Taito, cao 20cm', 470000],
    ['Prize figure Alya - Roshidere', 'Hàng Sega, đồng phục học sinh', 450000],
    ['Prize figure Ruby Hoshino - Oshi no Ko', 'Hàng Furyu, trang phục idol', 430000],
  ]],
  ['otaku-goods', 'Otaku Goods Kho Sỉ', 'Xả kho phụ kiện anime đồng giá', [
    ['Gối ôm Dakimakura Kafuu Chino', 'Vỏ gối 2 mặt 150x50cm, vải peach skin', 390000],
    ['Móc khóa acrylic Jujutsu Kaisen (set 6)', '6 nhân vật, in 2 mặt', 150000],
    ['Standee acrylic Frieren & Fern', 'Cao 15cm, đế rời', 180000],
    ['Poster lụa Your Name A2', 'Khổ A2, in lụa sắc nét', 120000],
    ['Huy hiệu Spy x Family (set 8)', 'Đường kính 58mm', 160000],
    ['Thẻ bài Weiss Schwarz booster Hololive', 'Hộp 20 gói, hàng Nhật', 1650000],
    ['Cốc sứ Totoro - Studio Ghibli', 'Dung tích 350ml, chính hãng Benelic', 420000],
    ['Túi tote Chainsaw Man Pochita', 'Vải canvas, khổ 38x42cm', 190000],
    ['Đèn ngủ 3D Gojo Satoru', 'Đèn LED 16 màu, điều khiển từ xa', 250000],
    ['Bộ bookmark kim loại Ghibli (set 5)', 'Kim loại mạ vàng, hộp quà', 140000],
  ]],
  ['isekai-books', 'Isekai Books', 'Truyện tranh chuyển sinh đọc là ghiền', [
    ['Manga Tensei Shitara Slime tập 1-25', 'Bản tiếng Việt', 875000],
    ['Manga Mushoku Tensei tập 1-19', 'Bản tiếng Việt', 665000],
    ['Manga Overlord tập 1-17', 'Bản tiếng Việt', 595000],
    ['Manga Re:Zero Chương 1-3 trọn bộ', 'Bản tiếng Việt, 11 tập', 440000],
    ['Manga Konosuba tập 1-17', 'Bản tiếng Việt', 595000],
    ['Manga Solo Leveling tập 1-11', 'Bản màu tiếng Việt', 1100000],
    ['Manga The Eminence in Shadow tập 1-11', 'Bản tiếng Việt', 440000],
    ['Manga Shield Hero tập 1-23', 'Bản tiếng Việt', 805000],
    ['Manga Dungeon Meshi tập 1-14 trọn bộ', 'Bản tiếng Việt (Mỹ vị hầm ngục)', 630000],
    ['Manga Kumo desu ga, Nani ka? tập 1-14', 'Bản tiếng Việt', 490000],
  ]],
  ['retro-anime', 'Retro Anime Collectibles', 'Đồ cổ anime 90s, hàng hiếm', [
    ['Figure Sailor Moon S.H.Figuarts', 'Khớp linh hoạt, kèm gậy phép', 1450000],
    ['Figure Son Goku SSJ - Dragon Ball Z Ichiban Kuji', 'Giải A, cao 25cm', 1850000],
    ['Mô hình Evangelion Unit-01 Metal Build', 'Khung kim loại, cao 22cm', 7990000],
    ['Figure Spike Spiegel - Cowboy Bebop', 'Scale 1/8, kèm súng Jericho', 2690000],
    ['Mô hình xe Akira Kaneda Bike 1/12', 'Mô hình lắp ráp Bandai', 2390000],
    ['Figure Inuyasha & Kagome bộ đôi', 'Hàng Banpresto, cao 20cm', 990000],
    ['Artbook Neon Genesis Evangelion Der Mond', 'Artbook Sadamoto, bản Nhật', 1250000],
    ['Figure Kenshin Himura - Rurouni Kenshin', 'Hàng Bandai, kèm kiếm ngược', 1350000],
    ['Bộ thẻ Yu-Gi-Oh! LOB tái bản 25th', 'Hộp 24 gói, bản Anh', 1890000],
    ['Mô hình Totoro chờ xe buýt - Ghibli', 'Diorama trạm xe buýt, có đèn', 1690000],
  ]],
];

async function main() {
  const mode = process.env.SEED_MODE || 'seed';
  const pg = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2 });
  const keys = (sid, pid) => ({
    seller: `live:{${sid}}:seller`,
    stock: `live:{${sid}}:p:${pid}:stock`,
    initial: `live:{${sid}}:p:${pid}:initial`,
    buyers: `live:{${sid}}:p:${pid}:buyers`,
  });

  try {
    if (mode === 'clean') {
      const { rows } = await pg.query(
        `UPDATE live_sessions s SET status = 'ENDED', ended_at = now() FROM sellers se
         WHERE se.id = s.seller_id AND se.channel_arn LIKE $1 AND s.status = 'OPEN' RETURNING s.id`,
        [`${DEMO_PREFIX}%`],
      );
      for (const { id } of rows) {
        const items = await pg.query('SELECT product_id FROM session_products WHERE session_id = $1', [id]);
        const del = [keys(id, 0).seller];
        for (const { product_id } of items.rows) {
          const k = keys(id, product_id);
          del.push(k.stock, k.initial, k.buyers);
        }
        await redis.del(...del);
      }
      console.log(`Đã kết thúc ${rows.length} phiên demo`);
      return;
    }

    let products = 0;
    for (const [i, [slug, name, title, items]] of SELLERS.entries()) {
      const sellerId = uuidFrom(slug);
      const playback = PLAYBACKS[i % PLAYBACKS.length];
      // Token ngẫu nhiên không lưu ở đâu: người bán demo không đăng nhập được, chỉ để hiển thị.
      await pg.query(
        `INSERT INTO sellers (id, name, token_hash, channel_arn, ingest_endpoint, playback_url, stream_key_arn)
         VALUES ($1, $2, $3, $4, 'demo', $5, NULL)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, playback_url = EXCLUDED.playback_url`,
        [sellerId, name, createHash('sha256').update(randomBytes(32)).digest('hex'), `${DEMO_PREFIX}channel/${slug}`, playback],
      );

      const productIds = [];
      for (const [i, [pname, desc, price]] of items.entries()) {
        const sku = `DEMO-${slug.toUpperCase()}-${String(i + 1).padStart(2, '0')}`;
        const { rows } = await pg.query(
          `INSERT INTO products (sku, name, description, price, image_url, seller_id) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (sku) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
             price = EXCLUDED.price, image_url = EXCLUDED.image_url, seller_id = EXCLUDED.seller_id
           RETURNING id`,
          [sku, pname, desc, price, img(sku), sellerId],
        );
        productIds.push(rows[0].id);
        products++;
      }

      // Một phiên OPEN cho mỗi người bán (index unique đảm bảo không trùng); có rồi thì dùng lại.
      let { rows: open } = await pg.query(`SELECT id FROM live_sessions WHERE seller_id = $1 AND status = 'OPEN'`, [sellerId]);
      const sessionId = open[0]?.id ?? uuidFrom(`${slug}:session:${Date.now()}`);
      if (!open.length) {
        await pg.query('INSERT INTO live_sessions (id, seller_id, title, pinned_product_id) VALUES ($1, $2, $3, $4)', [
          sessionId, sellerId, title, productIds[0],
        ]);
      }
      const multi = redis.multi().set(keys(sessionId, 0).seller, sellerId);
      for (const [position, pid] of productIds.entries()) {
        const stock = 20 + ((position * 37 + slug.length * 11) % 180);
        await pg.query(
          `INSERT INTO session_products (session_id, product_id, initial_stock, position) VALUES ($1, $2, $3, $4)
           ON CONFLICT (session_id, product_id) DO NOTHING`,
          [sessionId, pid, stock, position],
        );
        const k = keys(sessionId, pid);
        // NX: chạy lại không reset số đã bán; chỉ nạp lại khi Redis mất dữ liệu.
        multi.set(k.stock, stock, 'NX').set(k.initial, stock, 'NX');
      }
      await multi.exec();
      console.log(`ok  ${name.padEnd(26)} phiên ${sessionId} (${productIds.length} sản phẩm)`);
    }
    console.log(`Xong: ${SELLERS.length} người bán, ${products} sản phẩm, ${SELLERS.length} phiên live demo`);
  } finally {
    await pg.end();
    redis.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
