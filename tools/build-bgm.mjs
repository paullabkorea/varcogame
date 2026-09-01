/**
 * assets/sound/source/music/ 의 배경음악 원본을 게임용 mp3 로 인코딩하는 스크립트.
 *
 *   node tools/build-bgm.mjs
 *
 * 원본은 Varco Sound 가 뽑아 준 mp4(영상+AAC 48kHz 스테레오, 4.1MB) 다. 게임이
 * 필요한 건 소리뿐이라 영상 트랙을 버리고 112kbps mp3 로 굽는다 (3.0MB).
 * 곡 평균이 원곡 -15.4dB, 예전 곡이 -16.7dB 이었어서 -1.3dB 를 먹여 맞춰 두었다.
 * 이렇게 해야 src/audio.js 의 재생 게인(0.28)을 건드리지 않고 곡만 갈아끼울 수 있다.
 *
 * 원본은 재작업용이라 .gitignore 로 빼 두었다 (게임이 읽는 건 bgm.mp3 뿐).
 *
 * ffmpeg 은 PATH 에서 찾고, 없으면 FFMPEG 환경변수로 경로를 넘긴다.
 * (파이썬 imageio-ffmpeg 가 깔려 있다면 그 안의 바이너리를 써도 된다.)
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(import.meta.dirname, '../assets/sound/source/music');
const OUT = path.resolve(import.meta.dirname, '../assets/sound');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

const JOBS = [
  { file: 'Varco Sound - Runeguard.mp4', out: 'bgm.mp3', kbps: 112, gainDb: -1.3 },
];

const MB = (n) => (n / 1048576).toFixed(2) + ' MB';

for (const job of JOBS) {
  const src = path.join(SRC, job.file);
  const dst = path.join(OUT, job.out);
  if (!fs.existsSync(src)) {
    console.error(`원본이 없습니다: ${src}`);
    process.exitCode = 1;
    continue;
  }

  const r = spawnSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', src,
    '-vn',                                   // 영상 트랙 버리기
    '-af', `volume=${job.gainDb}dB`,
    '-ar', '44100', '-ac', '2',
    '-c:a', 'libmp3lame', '-b:a', `${job.kbps}k`,
    dst,
  ], { stdio: ['ignore', 'inherit', 'inherit'] });

  if (r.error || r.status !== 0) {
    console.error(`ffmpeg 실행 실패 (${FFMPEG}). PATH 에 없으면 FFMPEG 로 경로를 넘기세요.`);
    process.exitCode = 1;
    continue;
  }

  const srcSize = fs.statSync(src).size, dstSize = fs.statSync(dst).size;
  console.log(
    `${job.file} → ${job.out}\n` +
    `   ${MB(srcSize)} → ${MB(dstSize)} (${job.kbps}kbps, ${job.gainDb}dB, -${(100 - dstSize / srcSize * 100).toFixed(1)}%)`
  );
}
