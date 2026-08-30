/**
 * assets/sound/source/*.wav 를 게임용 효과음으로 다듬는 스크립트 (의존성 없음).
 *
 *   node tools/build-sfx.mjs
 *
 * 원본은 앞뒤로 무음과 긴 페이드가 붙어 있는 "감상용" 길이라 그대로 쓰면
 * 클릭하고 한참 뒤에 소리가 나고, 쿨다운이 짧은 화염구는 소리가 계속 겹쳐 뭉갠다.
 * 그래서 (1) 소리의 몸통만 잘라 내 트리거 즉시 최대음량이 나오게 하고,
 * (2) 꼬리를 페이드로 정리해 쿨다운 안에 끝나게 하고, (3) 피크를 맞춰 둔다.
 *
 * 새 효과음을 추가하면 source/ 에 원본을 넣고 아래 JOBS 에 한 줄 추가하면 된다.
 * 자를 구간은 `node tools/build-sfx.mjs --scan` 으로 25ms 단위 엔벨로프를 찍어 보고 고른다.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(import.meta.dirname, '../assets/sound/source');
const OUT = path.resolve(import.meta.dirname, '../assets/sound');

// start/end 는 원본 기준 초. fadeIn 은 클릭 잡음 방지용, fadeOut 은 꼬리 정리용.
const JOBS = [
  {
    file: 'Fireball_launch_1.wav', out: 'fireball.wav',
    // 원본 0~0.75s 는 서서히 부푸는 예열 구간이라 통째로 버린다. 쿨다운이 0.4s 뿐이라
    // 뒤쪽 지속음도 1.31s 에서 끊고 0.25s 페이드로 마무리 — 연사해도 뭉치지 않는다.
    start: 0.76, end: 1.31, fadeIn: 0.005, fadeOut: 0.25
  },
  {
    file: 'Ice_spell_2.wav', out: 'frost.wav',
    // 서리 폭발은 쿨다운 5.5s 라 여운을 길게 남겨도 된다. 앞 0.2s 의 도입부만 잘라
    // 폭발 순간과 최대음량을 맞춘다.
    start: 0.20, end: 1.10, fadeIn: 0.004, fadeOut: 0.30
  }
];

const PEAK = 0.84;              // -1.5 dBFS. 합성음(피크 0.3 내외)과 섞으므로 여유를 둔다.

/** 청크를 훑어 fmt/data 를 찾는 최소 WAV 리더 (16bit PCM 전용) */
function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('RIFF/WAVE 가 아니다');
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = buf.subarray(pos + 8, pos + 8 + size);
    if (id === 'fmt ') fmt = { format: body.readUInt16LE(0), ch: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) };
    else if (id === 'data') data = body;
    pos += 8 + size + (size & 1);          // 청크는 짝수 바이트로 패딩된다
  }
  if (!fmt || !data) throw new Error('fmt/data 청크가 없다');
  if (fmt.format !== 1 || fmt.bits !== 16) throw new Error(`16bit PCM 만 지원 (format=${fmt.format}, bits=${fmt.bits})`);

  // 채널 평균 → 모노 Float32
  const frames = data.length / 2 / fmt.ch;
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < fmt.ch; c++) s += data.readInt16LE((i * fmt.ch + c) * 2) / 32768;
    out[i] = s / fmt.ch;
  }
  return { rate: fmt.rate, ch: fmt.ch, samples: out };
}

function writeWav(file, samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);          // PCM, 모노
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([head, data]));
}

/** 어디를 자를지 고를 때 쓰는 25ms 피크 엔벨로프 덤프 */
function scan() {
  for (const job of JOBS) {
    const { rate, samples } = readWav(fs.readFileSync(path.join(SRC, job.file)));
    const win = Math.round(rate * 0.025);
    const rows = [];
    for (let i = 0; i < samples.length; i += win) {
      let m = 0;
      for (let j = i; j < Math.min(i + win, samples.length); j++) m = Math.max(m, Math.abs(samples[j]));
      rows.push(`${(i / rate).toFixed(3)}s ${m.toFixed(3)}`);
    }
    console.log(`\n${job.file} — ${(samples.length / rate).toFixed(2)}s @ ${rate}Hz`);
    for (let i = 0; i < rows.length; i += 5) console.log('  ' + rows.slice(i, i + 5).join('   '));
  }
}

if (process.argv.includes('--scan')) { scan(); process.exit(0); }

const KB = (n) => (n / 1024).toFixed(0) + ' KB';

for (const job of JOBS) {
  const src = path.join(SRC, job.file);
  const dst = path.join(OUT, job.out);
  const srcSize = fs.statSync(src).size;
  const { rate, samples } = readWav(fs.readFileSync(src));

  // 1) 몸통만 잘라 낸다
  const a = Math.max(0, Math.round(job.start * rate));
  const b = Math.min(samples.length, Math.round(job.end * rate));
  const cut = samples.slice(a, b);

  // 2) DC 오프셋 제거 — 원본에 ±0.001 정도 치우침이 있어서, 겹쳐 재생하면
  //    오프셋이 누적돼 헤드룸을 잡아먹는다
  let mean = 0;
  for (const v of cut) mean += v;
  mean /= cut.length;
  for (let i = 0; i < cut.length; i++) cut[i] -= mean;

  // 3) 페이드 — 인은 잘린 파형이 만드는 클릭 방지, 아웃은 raised-cosine 으로 부드럽게
  const fi = Math.round(job.fadeIn * rate), fo = Math.round(job.fadeOut * rate);
  for (let i = 0; i < fi; i++) cut[i] *= i / fi;
  for (let i = 0; i < fo; i++) {
    const k = i / fo;                                   // 0 → 1 (끝으로 갈수록)
    cut[cut.length - fo + i] *= 0.5 * (1 + Math.cos(Math.PI * k));
  }

  // 4) 피크 정규화
  let peak = 0;
  for (const v of cut) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0 ? PEAK / peak : 1;
  for (let i = 0; i < cut.length; i++) cut[i] *= g;

  writeWav(dst, cut, rate);
  console.log(
    `${job.file} → ${job.out}\n` +
    `   ${(samples.length / rate).toFixed(2)}s ${KB(srcSize)}  →  ` +
    `${(cut.length / rate).toFixed(2)}s ${KB(fs.statSync(dst).size)}  (gain ×${g.toFixed(2)})`
  );
}
