import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/**
 * 몹 GLB 에셋 로더 / 캐시.
 *
 * 모델마다 애니메이션 클립이 없어서 동작은 enemies.js 가 절차적으로 만든다.
 * 리그 유무에 따라 두 가지로 나눠 처리한다:
 *
 *  - **skinned** (해골): 23본 휴머노이드 리그가 있으니 그대로 살린다. 씬을 템플릿으로
 *    두고 SkeletonUtils 로 복제해서 몹마다 자기 스켈레톤을 갖는다. 지오메트리·텍스처는
 *    복제본끼리 공유된다. rest 포즈와 "모델 공간 축 → 본 로컬 축" 변환을 미리 캐시해 둬서
 *    본의 roll 이 제각각이어도 항상 같은 방향으로 굽힐 수 있다 (player.js 와 같은 수법).
 *
 *  - **baked** (슬라임·무기): 리그가 없거나 쓸모가 없어서 바인드 포즈를 지오메트리에
 *    구워 정적 메시로 만든다. 본 업데이트 비용이 0이고 지오메트리를 통째로 공유한다.
 */

const BASE = './assets/models/';

export const MODEL_DEFS = {
  slime: {
    url: BASE + 'Cute%20Green%20Slime.opt.glb', height: 1.15,
  },
  skeleton: {
    url: BASE + 'Hooded%20Skeleton%20Warrior_2.opt.glb', height: 1.80,
    skinned: true,          // 23본 휴머노이드 리그 (Hips/Spine/Arm/Leg…) — 본으로 걷는다
    handBone: 'RightHand',  // 무기를 매다는 본
    /**
     * 바인드가 T포즈라 팔을 내려 A포즈로 만들고 **그걸 rest 로 삼는다.**
     * 축 캐시가 rest 기준이라서, T포즈를 기준으로 잡으면 팔을 내린 뒤의 스윙 축이
     * 어긋난다 (T포즈에선 팔이 옆을 보므로 앞뒤 스윙이 y축, 내린 뒤엔 x축).
     * 내린 상태를 기준으로 다시 캐시하면 이후 전부 모델 공간 x/y/z 로 다룰 수 있다.
     */
    restPose: [
      ['LeftForeArm', [['y', -0.28]]],   // 팔꿈치 먼저 (부모가 아직 rest 일 때)
      ['RightForeArm', [['y', 0.28]]],
      ['LeftArm', [['z', -1.28]]],       // +X 쪽 팔 → -z 가 아래
      ['RightArm', [['z', 1.28]]],       // -X 쪽 팔 → +z 가 아래
    ],
  },
  sword: {
    url: BASE + 'Barbarian%20Skull%20Sword.opt.glb', height: 1.05,
    grip: { y: 0.86, flip: true },    // 모델이 날을 아래로 두고 서 있어서 뒤집는다
  },
  staff: {
    url: BASE + 'Crystal%20Skull%20Staff.opt.glb', height: 1.55,
    grip: { y: 0.55, flip: false },
    tip: 1.42,                        // 수정 구슬 높이 (원본 기준) — 마법탄 발사 지점
  },
};

const cache = new Map();

/* ------------------------------------------------------------------ */
/*  바인드 포즈 굽기                                                    */
/* ------------------------------------------------------------------ */

/**
 * 스킨 메시를 rest 포즈 그대로 정적 지오메트리로 변환한다.
 * 정점마다 블렌드 본 행렬 M = bindMatrixInverse · (Σ wᵢ·boneMatᵢ) · bindMatrix 를 만들어
 * 위치에는 M 을, 노멀에는 M 의 normal matrix 를 적용한다.
 * (rest == bind 인 보통의 경우 M 은 단위행렬이라 결과가 원본과 같다.)
 */
function bakeSkin(mesh) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const si = geo.attributes.skinIndex;
  const sw = geo.attributes.skinWeight;
  const skel = mesh.skeleton;

  const outP = new Float32Array(pos.count * 3);
  const outN = nrm ? new Float32Array(nrm.count * 3) : null;

  const blend = new THREE.Matrix4();
  const bone = new THREE.Matrix4();
  const nMat = new THREE.Matrix3();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const idx = new THREE.Vector4();
  const wgt = new THREE.Vector4();

  for (let i = 0; i < pos.count; i++) {
    idx.fromBufferAttribute(si, i);
    wgt.fromBufferAttribute(sw, i);

    blend.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    let total = 0;
    for (let k = 0; k < 4; k++) {
      const w = wgt.getComponent(k);
      if (w === 0) continue;
      const b = idx.getComponent(k);
      bone.multiplyMatrices(skel.bones[b].matrixWorld, skel.boneInverses[b]);
      for (let e = 0; e < 16; e++) blend.elements[e] += bone.elements[e] * w;
      total += w;
    }
    if (total === 0) blend.identity();                       // 웨이트 없는 정점은 그대로
    else blend.premultiply(mesh.bindMatrixInverse).multiply(mesh.bindMatrix);

    v.fromBufferAttribute(pos, i).applyMatrix4(blend);
    outP[i * 3] = v.x; outP[i * 3 + 1] = v.y; outP[i * 3 + 2] = v.z;

    if (outN) {
      nMat.getNormalMatrix(blend);
      n.fromBufferAttribute(nrm, i).applyMatrix3(nMat).normalize();
      outN[i * 3] = n.x; outN[i * 3 + 1] = n.y; outN[i * 3 + 2] = n.z;
    }
  }

  const out = new THREE.BufferGeometry();
  out.setIndex(geo.index ? geo.index.clone() : null);
  out.setAttribute('position', new THREE.BufferAttribute(outP, 3));
  if (outN) out.setAttribute('normal', new THREE.BufferAttribute(outN, 3));
  if (geo.attributes.uv) out.setAttribute('uv', geo.attributes.uv.clone());
  return out;
}

/** 스킨이 없는 메시는 위치/노멀만 양자화 해제해 복사한다. */
function bakePlain(mesh) {
  const geo = mesh.geometry;
  const out = new THREE.BufferGeometry();
  out.setIndex(geo.index ? geo.index.clone() : null);
  const get = ['getX', 'getY', 'getZ', 'getW'];
  for (const name of ['position', 'normal', 'uv']) {
    const a = geo.attributes[name];
    if (!a) continue;
    const dst = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++)
      for (let c = 0; c < a.itemSize; c++) dst[i * a.itemSize + c] = a[get[c]](i);
    out.setAttribute(name, new THREE.BufferAttribute(dst, a.itemSize));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  리그 캐시                                                           */
/* ------------------------------------------------------------------ */

/**
 * rest 포즈와 "모델 공간 축 → 본 로컬 축" 변환을 미리 재 둔다.
 * 본마다 로컬 축(roll)이 제각각이라 그냥 rotation.x 를 만지면 본마다 다른 방향으로 꺾인다.
 * rest 월드 회전의 역을 축에 곱해 두면 어느 본이든 "모델 기준 X축으로 θ" 가 통한다.
 */
function buildRig(root, handBone) {
  root.updateMatrixWorld(true);
  const rootQ = new THREE.Quaternion();
  root.getWorldQuaternion(rootQ).invert();

  const rest = new Map();
  root.traverse(o => {
    if (!o.isBone) return;
    const wq = new THREE.Quaternion();
    o.getWorldQuaternion(wq).premultiply(rootQ);   // 모델 공간 기준 회전
    const inv = wq.clone().invert();
    rest.set(o.name, {
      q: o.quaternion.clone(),
      x: new THREE.Vector3(1, 0, 0).applyQuaternion(inv),
      y: new THREE.Vector3(0, 1, 0).applyQuaternion(inv),
      z: new THREE.Vector3(0, 0, 1).applyQuaternion(inv),
    });
  });

  // 무기를 손 본에 매달 때 필요한 스케일 보정값
  let handScale = 1;
  const hand = root.getObjectByName(handBone);
  if (hand) {
    const s = new THREE.Vector3();
    hand.getWorldScale(s);
    handScale = s.x || 1;
  }
  return { rest, handBone, handScale };
}

/** T포즈 축 캐시를 써서 기본 자세를 한 번 적용한다 (이후 캐시를 다시 뜬다). */
function applyRestPose(root, rig, ops) {
  const q = new THREE.Quaternion();
  const acc = new THREE.Quaternion();
  const inv = new THREE.Quaternion();
  const ax = new THREE.Vector3();
  for (const [name, rots] of ops) {
    const b = root.getObjectByName(name);
    const r = rig.rest.get(name);
    if (!b || !r) continue;
    acc.identity();
    for (const [axis, angle] of rots) {
      ax.copy(r[axis]).applyQuaternion(inv.copy(acc).invert());
      acc.multiply(q.setFromAxisAngle(ax, angle));
    }
    b.quaternion.multiply(acc);
  }
  root.updateMatrixWorld(true);
}

/* ------------------------------------------------------------------ */
/*  로드                                                               */
/* ------------------------------------------------------------------ */
const loader = new GLTFLoader();

/**
 * 리그를 살린 채로 템플릿을 만든다. 원점 = 발밑 중앙, 높이 = def.height 가 되도록
 * 래퍼 Group 에 스케일/오프셋을 넣는다 (스킨 메시 정점을 건드리면 리그가 깨진다).
 */
function loadSkinned(key, def, scene) {
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const s = def.height / Math.max(1e-6, size.y);

  const template = new THREE.Group();
  template.add(scene);
  template.scale.setScalar(s);
  template.updateMatrixWorld(true);

  const b2 = new THREE.Box3().setFromObject(template);
  const c = b2.getCenter(new THREE.Vector3());
  scene.position.x -= c.x / s;
  scene.position.z -= c.z / s;
  scene.position.y -= b2.min.y / s;
  template.updateMatrixWorld(true);

  let material = null;
  template.traverse(o => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;         // 본으로 움직이면 바운딩이 안 맞을 수 있다
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    tuneMaterial(m);
    material = material ?? m;
  });

  // 기본 자세를 굽고, 그 자세 기준으로 축 캐시를 다시 뜬다
  let rig = buildRig(template, def.handBone);
  if (def.restPose) {
    applyRestPose(template, rig, def.restPose);
    rig = buildRig(template, def.handBone);
  }

  const box3 = new THREE.Box3().setFromObject(template);
  cache.set(key, {
    template, material, skinned: true, rig,
    scale: s, hand: null, tip: null,
    size: box3.getSize(new THREE.Vector3()),
    box: box3,
  });
}

async function loadOne(key, def, onProgress) {
  const gltf = await loader.loadAsync(def.url, onProgress);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  if (def.skinned) return loadSkinned(key, def, scene);

  let geometry = null, material = null;
  scene.traverse(o => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    if (geometry) return;                       // 4개 모델 모두 메시가 하나뿐
    geometry = o.isSkinnedMesh ? bakeSkin(o) : bakePlain(o);
    geometry.applyMatrix4(o.matrixWorld);       // 노드 트랜스폼까지 구움
    material = Array.isArray(o.material) ? o.material[0] : o.material;
  });
  if (!geometry) throw new Error(`${key}: GLB 안에 메시가 없습니다`);

  // ---- 정규화: 높이 = def.height, 바닥 = y0, 중심 = x/z 0 ----
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const s = def.height / Math.max(1e-6, size.y);
  geometry.scale(s, s, s);
  geometry.computeBoundingBox();
  const b2 = geometry.boundingBox;
  const c = b2.getCenter(new THREE.Vector3());
  geometry.translate(-c.x, -b2.min.y, -c.z);

  // ---- 무기: 원점을 손잡이로 옮기고 날이 +Y 를 보게 ----
  let tip = null;
  if (def.grip) {
    if (def.grip.flip) geometry.rotateZ(Math.PI);
    const gy = def.grip.flip ? -def.grip.y : def.grip.y;
    geometry.translate(0, -gy, 0);
    if (def.tip != null) tip = (def.grip.flip ? -def.tip : def.tip) - gy;
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  tuneMaterial(material);

  cache.set(key, {
    geometry, material, tip, skinned: false, hand: null,
    size: geometry.boundingBox.getSize(new THREE.Vector3()),
    box: geometry.boundingBox.clone(),
  });
}

/** 4개 모델을 한 번씩만 로드. onProgress(0..1) */
export async function loadModels(onProgress) {
  const keys = Object.keys(MODEL_DEFS);
  const frac = new Array(keys.length).fill(0);
  const report = () => onProgress && onProgress(frac.reduce((a, b) => a + b, 0) / keys.length);

  await Promise.all(keys.map(async (k, i) => {
    await loadOne(k, MODEL_DEFS[k], e => {
      if (e.total) frac[i] = e.loaded / e.total;
      else frac[i] = Math.min(0.9, e.loaded / 400000);
      report();
    });
    frac[i] = 1;
    report();
  }));
}

function tuneMaterial(m) {
  m.roughness = Math.min(1, (m.roughness ?? 1) * 0.9 + 0.15);
  m.envMapIntensity = 0.8;
  m.emissive = new THREE.Color(0x000000);   // 텍스처가 있어서 평소엔 발광 0
  m.emissiveIntensity = 0;
}

/**
 * 몹 하나에 쓸 오브젝트. 지오메트리·텍스처는 공유하고 재질만 복제한다
 * (피격 플래시가 몹마다 따로 놀아야 해서).
 * 리그가 있으면 SkeletonUtils 로 복제해 몹마다 자기 스켈레톤을 갖는다.
 */
export function makeModel(key) {
  const m = cache.get(key);
  if (!m) throw new Error(`모델 '${key}' 이 아직 로드되지 않았습니다`);

  if (m.skinned) {
    const obj = cloneSkinned(m.template);
    const mats = [];
    obj.traverse(o => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      o.material = o.material.clone();
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      mats.push(o.material);
    });
    obj.userData.mats = mats;
    return obj;
  }

  const mesh = new THREE.Mesh(m.geometry, m.material.clone());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.mats = [mesh.material];
  return mesh;
}

export function modelInfo(key) { return cache.get(key); }
