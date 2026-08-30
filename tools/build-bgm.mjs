/**
 * assets/sound/source/music/*.wav 를 게임용 배경음악 mp3 로 인코딩하는 스크립트.
 *
 *   npm i -D @breezystack/lamejs
 *   node tools/build-bgm.mjs
 *
 * 원본 wav 는 48kHz 스테레오 32MB 다. 모델 전부를 합쳐도 3.4MB 인 게임에
 * 배경음악 하나가 32MB 를 먹을 수는 없어서 mp3 로 굽는다 (약 2.4MB, -93%).
 * 동굴 앰비언스라 고역이 성글어 112kbps 에서도 뭉개지는 게 들리지 않는다.
 *
 * 원본은 재작업용이라 .gitignore 로 빼 두었다 (게임이 읽는 건 bgm.mp3 뿐).
 */
import lamejs from '@breezystack/lamejs';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(import.meta.dirname, '../assets/sound/source/music');
const OUT = path.resolve(import.meta.dirname, '../assets/sound');

const JOBS = [
  { file: 'Wenivspace - Shallow Cavern.wav', out: 'bgm.mp3', kbps: 112 }
];

/** 청크를 훑어 fmt/data 를 찾는 최소 WAV 리더 (16bit PCM 전용) */
function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('RIFF/WAVE 가 아니다');
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      const b = buf.subarray(pos + 8, pos + 8 + size);
      fmt = { format: b.readUInt16LE(0), ch: b.readUInt16LE(2), rate: b.readUInt32LE(4), bits: b.readUInt16LE(14) };
    } else if (id === 'data') {
      data = buf.subarray(pos + 8, pos + 8 + size);
    }
    pos += 8 + size + (size & 1);              // 청크는 짝수 바이트로 패딩된다
  }
  if (!fmt || !data) throw new Error('fmt/data 청크가 없다');
  if (fmt.format !== 1 || fmt.bits !== 16) throw new Error(`16bit PCM 만 지원 (format=${fmt.format}, bits=${fmt.bits})`);
  return { fmt, pcm: new Int16Array(data.buffer, data.byteOffset, data.length / 2) };
}

const MB = (n) => (n / 1048576).toFixed(2) + ' MB';

for (const job of JOBS) {
  const src = path.join(SRC, job.file);
  const dst = path.join(OUT, job.out);
  const srcSize = fs.statSync(src).size;
  const { fmt, pcm } = readWav(fs.readFileSync(src));
  const frames = pcm.length / fmt.ch;

  // lamejs 는 채널별로 나뉜 Int16Array 를 받는다 (wav 는 L,R,L,R… 로 섞여 있다)
  let left, right = null;
  if (fmt.ch === 1) {
    left = pcm;
  } else {
    left = new Int16Array(frames);
    right = new Int16Array(frames);
    for (let i = 0; i < frames; i++) { left[i] = pcm[i * fmt.ch]; right[i] = pcm[i * fmt.ch + 1]; }
  }

  const enc = new lamejs.Mp3Encoder(right ? 2 : 1, fmt.rate, job.kbps);
  const out = [];
  // 반드시 1152(= mp3 프레임 1개) 이하로 넣어야 한다. 이보다 크게 주면 lamejs 는
  // 앞의 1152 샘플만 인코딩하고 나머지를 버려서, 소리가 뚝뚝 끊긴 파일이 나온다
  // (크기는 CBR 이라 정상으로 보이므로 눈으로는 안 잡힌다).
  const BLOCK = 1152;
  for (let i = 0; i < frames; i += BLOCK) {
    const buf = right
      ? enc.encodeBuffer(left.subarray(i, i + BLOCK), right.subarray(i, i + BLOCK))
      : enc.encodeBuffer(left.subarray(i, i + BLOCK));
    if (buf.length) out.push(Buffer.from(buf));
  }
  const tail = enc.flush();
  if (tail.length) out.push(Buffer.from(tail));

  fs.writeFileSync(dst, Buffer.concat(out));
  const dstSize = fs.statSync(dst).size;
  console.log(
    `${job.file} → ${job.out}\n` +
    `   ${(frames / fmt.rate).toFixed(1)}초 ${fmt.ch}ch ${fmt.rate}Hz  ${MB(srcSize)} → ${MB(dstSize)} ` +
    `(${job.kbps}kbps, -${(100 - dstSize / srcSize * 100).toFixed(1)}%)`
  );
}
