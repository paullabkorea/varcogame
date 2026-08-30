/**
 * assets/models/source/*.glb 를 게임용 .opt.glb 로 굽는 스크립트.
 *
 *   npm i -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions sharp meshoptimizer
 *   node tools/optimize-glb.mjs
 *
 * 새 모델을 추가하면 source/ 에 원본을 넣고 아래 JOBS 에 한 줄 추가하면 된다.
 * 이 4개 모델은 삼각형이 이미 5,000개뿐이라 용량은 사실상 전부 텍스처였다
 * (4096 PNG baseColor + 2048 PNG normal = 20MB). 그래서 simplify 는 끄고
 * 텍스처 재인코딩 + 양자화만으로 98% 를 줄였다.
 *
 * 쓰는 확장은 EXT_texture_webp / KHR_mesh_quantization 두 개뿐이고
 * 둘 다 three.js GLTFLoader 가 내장 지원한다 (Draco·meshopt 디코더 불필요).
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMeshQuantization, EXTTextureWebP } from '@gltf-transform/extensions';
import { weld, dedup, prune, reorder, quantize, simplify, textureCompress, flatten, join } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;

const SRC = path.resolve(import.meta.dirname, '../assets/models/source');
const OUT = path.resolve(import.meta.dirname, '../assets/models');

// 모델별 예산: 화면에서 차지하는 크기 / 동시 등장 수 기준
const JOBS = [
  { file: 'Cute Green Slime.glb',        base: 1024, normal: 512, tris: 0 },
  { file: 'Hooded Skeleton Warrior_2.glb', base: 1024, normal: 512, tris: 0 },   // 리깅본 (23본). _1 은 rig 없는 구버전
  { file: 'Barbarian Skull Sword.glb',   base: 1024, normal: 512, tris: 0 },
  { file: 'Crystal Skull Staff.glb',     base: 1024, normal: 512, tris: 0 },
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const MB = (n) => (n / 1048576).toFixed(2) + ' MB';

function stats(doc) {
  let tris = 0, verts = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices(), pos = prim.getAttribute('POSITION');
      tris += (idx ? idx.getCount() : pos.getCount()) / 3;
      verts += pos.getCount();
    }
  return { tris: Math.round(tris), verts };
}

for (const job of JOBS) {
  const src = path.join(SRC, job.file);
  const dst = path.join(OUT, job.file.replace(/\.glb$/i, '.opt.glb'));
  const srcSize = fs.statSync(src).size;
  const doc = await io.read(src);
  const before = stats(doc);

  // 1) 지오메트리 ------------------------------------------------
  await doc.transform(
    weld(),                                   // 완전히 겹치는 버텍스 병합
    ...(job.tris ? [simplify({ simplifier: MeshoptSimplifier, ratio: job.tris / before.tris, error: 0.001, lockBorder: false })] : []),
    dedup(),                                  // 중복 accessor/material/texture 제거
    prune({ keepAttributes: false, keepLeaves: false, keepSolidTextures: false }),
    reorder({ encoder: MeshoptEncoder, target: 'performance' }), // GPU 캐시 친화 순서
  );

  // 2) 텍스처 -----------------------------------------------------
  // baseColor: sRGB 컬러 → 손실 WebP 로 충분
  await doc.transform(
    textureCompress({
      encoder: sharp, targetFormat: 'webp', slots: /baseColor/i,
      resize: [job.base, job.base], resizeFilter: 'lanczos3', quality: 82,
    }),
    // normal: 값 자체가 방향 벡터라 뭉개지면 라이팅이 얼룩짐 → 품질 높게
    textureCompress({
      encoder: sharp, targetFormat: 'webp', slots: /normal/i,
      resize: [job.normal, job.normal], resizeFilter: 'lanczos3', quality: 92,
    }),
    // 나머지 슬롯(metallicRoughness/emissive/occlusion)이 있으면 같이
    textureCompress({
      encoder: sharp, targetFormat: 'webp', slots: /metallicRoughness|emissive|occlusion/i,
      resize: [512, 512], resizeFilter: 'lanczos3', quality: 85,
    }),
  );

  // 3) 양자화 (반드시 마지막) --------------------------------------
  await doc.transform(
    quantize({
      quantizePosition: 14, quantizeNormal: 10,
      quantizeTexcoord: 12, quantizeWeight: 8, quantizeColor: 8,
    }),
  );

  doc.createExtension(KHRMeshQuantization).setRequired(true);
  await io.write(dst, doc);

  const after = stats(doc);
  const outSize = fs.statSync(dst).size;
  console.log(`${job.file}`);
  console.log(`   ${MB(srcSize)} -> ${MB(outSize)}  (-${(100 - outSize / srcSize * 100).toFixed(1)}%)`);
  console.log(`   tris ${before.tris} -> ${after.tris}, verts ${before.verts} -> ${after.verts}`);
  for (const tex of doc.getRoot().listTextures()) {
    const s = tex.getSize();
    console.log(`   tex ${tex.getName()} ${tex.getMimeType()} ${s ? s.join('x') : '?'} ${MB(tex.getImage().byteLength)}`);
  }
  console.log('');
}
