import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clamp, damp, lerp, TAU } from './utils.js';
import { ARENA_RADIUS } from './world.js';

const MODEL_URL = './assets/models/Cartoon%20Wizard%20Boy.opt.glb';
const TARGET_HEIGHT = 1.95;

/**
 * 이 GLB에는 애니메이션 클립이 없고 스켈레톤만 있다.
 * 그래서 본을 직접 회전시켜 idle / run / cast 동작을 절차적으로 만든다.
 * 본마다 "모델 공간 축"을 본 로컬 축으로 미리 변환해 두면
 * 리그의 본 방향(roll)에 상관없이 항상 같은 방향으로 굽힐 수 있다.
 */
export class Player {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);

    this.pos = this.root.position;
    this.vel = new THREE.Vector3();
    this.facing = 0;          // 목표 각도(라디안)
    this.yaw = 0;             // 실제 각도(스프링 보간)
    this.yawVel = 0;          // 회전 각속도 — 기울기(뱅크)에 씀
    this.aimLock = 0;         // >0 이면 이동 방향 대신 조준점을 바라본다
    this.speed = 8.6;

    // 가속도 기반 기울기 (관성 표현)
    this._pv = new THREE.Vector3();
    this.leanF = 0;           // 앞뒤 (가속/감속)
    this.leanS = 0;           // 좌우 (스트레이프)

    this.maxHp = 100; this.hp = 100;
    this.maxMp = 100; this.mp = 100; this.mpRegen = 11;
    this.level = 1; this.xp = 0; this.xpNext = 12;
    this.alive = true;

    this.moveAmt = 0;         // 이동 애니메이션 가중치
    this.runPhase = 0;
    this.castTimer = 0;       // 시전 모션 잔여 시간
    this.castKind = 'fire';
    this.hurtFlash = 0;
    this.invuln = 0;
    this.bones = {};
    this.bonesLower = {};
    this.rest = new Map();
    this._boneCache = new Map();

    // 성장 스탯
    this.stats = {
      dmg: 1, cdr: 1, moveSpd: 1, lifesteal: 0,
      fireExtra: 0, novaRadius: 1, chainExtra: 0, blinkCdr: 1, pierce: 0,
      crit: 0.16, manaOnKill: 0
    };

    this._axisCache = new Map();
    this._q = new THREE.Quaternion();
    this._qAcc = new THREE.Quaternion();
    this._qInv = new THREE.Quaternion();
    this._axV = new THREE.Vector3();
  }

  async load(onProgress) {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(MODEL_URL, e => {
      if (onProgress && e.total) onProgress(e.loaded / e.total);
      else if (onProgress) onProgress(Math.min(0.95, e.loaded / 43000000));
    });

    const model = gltf.scene;
    model.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        if (o.material) {
          o.material.roughness = Math.min(1, (o.material.roughness ?? 1) * 0.9 + 0.15);
          o.material.envMapIntensity = 0.8;
        }
      }
      if (o.isBone) {
        this.bones[o.name] = o;
        this.bonesLower[o.name.replace(/\./g, '').toLowerCase()] = o;
      }
    });

    // ---- 크기 / 위치 정규화 ----
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3(); box.getSize(size);
    const s = TARGET_HEIGHT / Math.max(0.0001, size.y);
    model.scale.multiplyScalar(s);
    this._s0 = model.scale.x;      // 스쿼시&스트레치 기준 스케일
    model.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(model);
    const c = new THREE.Vector3(); box2.getCenter(c);
    model.position.x -= c.x;
    model.position.z -= c.z;
    model.position.y -= box2.min.y;

    this.model = model;
    this.root.add(model);
    this.height = TARGET_HEIGHT;

    // ---- 본 축 캐시 ----
    model.updateMatrixWorld(true);
    const invRoot = new THREE.Quaternion();
    this.root.getWorldQuaternion(invRoot);
    invRoot.invert();
    for (const name in this.bones) {
      const b = this.bones[name];
      this.rest.set(b, b.quaternion.clone());
      const wq = new THREE.Quaternion();
      b.getWorldQuaternion(wq);
      wq.premultiply(invRoot);       // 모델(캐릭터) 공간 기준 회전
      const inv = wq.clone().invert();
      this._axisCache.set(b, {
        x: new THREE.Vector3(1, 0, 0).applyQuaternion(inv),
        y: new THREE.Vector3(0, 1, 0).applyQuaternion(inv),
        z: new THREE.Vector3(0, 0, 1).applyQuaternion(inv)
      });
    }

    this._findStaffTip();
    this._shapeHands();
    return this;
  }

  /**
   * 손가락 본이 없어서(리그가 hand.L/R 에서 끝난다) 빈 손이 T포즈 그대로
   * 손가락을 쫙 편 채 굳어 있다 — 갈퀴처럼 보이는 원인.
   * 본으로는 손가락을 못 굽히니, 로드 시점에 **바인드 포즈 지오메트리 자체**를
   * 손 본 로컬 공간에서 한 번 구부려 반쯤 쥔 손을 만들어 굽는다.
   * 스킨 웨이트는 건드리지 않으므로 이후 모든 포즈/애니메이션에 그대로 따라온다.
   * 지팡이를 든 손은 이미 주먹을 쥐고 있으므로 제외한다.
   */
  _shapeHands() {
    const sk = this.skinned;
    if (!sk) return;
    const g = sk.geometry;

    // 최적화본은 위치/노멀이 quantize 되어 있다(정규화 정수). 변형하려면 float 로 푼다.
    const toFloat = key => {
      const a = g.attributes[key];
      if (a.array instanceof Float32Array && !a.normalized) return a;
      const out = new Float32Array(a.count * 3);
      for (let i = 0; i < a.count; i++) { out[i * 3] = a.getX(i); out[i * 3 + 1] = a.getY(i); out[i * 3 + 2] = a.getZ(i); }
      const f = new THREE.Float32BufferAttribute(out, 3);
      g.setAttribute(key, f);
      return f;
    };
    const pos = toFloat('position'), nrm = toFloat('normal');
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const bones = sk.skeleton.bones, inverses = sk.skeleton.boneInverses;

    for (let bi = 0; bi < bones.length; bi++) {
      const b = bones[bi];
      if (!/^hand/i.test(b.name.replace(/[._]/g, ''))) continue;
      if (b === this.staffHand) continue;                 // 지팡이 쥔 손은 이미 모양이 나온다
      this._curlFingers(pos, nrm, si, sw, inverses[bi], bi);
    }
    g.computeBoundingSphere();
  }

  /**
   * 손 본에 붙은 정점들을 손 본 로컬 공간에서 벤드(bend) 디포머로 말아 준다.
   *   f = 손목→손끝 축, b = 손가락이 늘어선 축, n = f × b (손바닥 쪽)
   * 손가락 밑동(u=0)부터 끝까지 각도가 비례해 커지게 회전시키면 곡선으로 말린다.
   * 동시에 b 축으로 모아서 벌어진 손가락을 붙이고, 손가락마다 조금씩 다르게 말아
   * 전부 똑같이 굽은 인형 손이 되는 걸 피한다.
   */
  _curlFingers(pos, nrm, si, sw, boneInv, boneIdx) {
    const P = [], ids = [], wts = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < si.count; i++) {
      let hw = 0;
      if (si.getX(i) === boneIdx) hw += sw.getX(i);
      if (si.getY(i) === boneIdx) hw += sw.getY(i);
      if (si.getZ(i) === boneIdx) hw += sw.getZ(i);
      if (si.getW(i) === boneIdx) hw += sw.getW(i);
      // 손이 주도하는 정점만 — 임계값을 낮추면 손목 위 팔뚝/소매까지 딸려 들어와
      // 손가락 축(f) 계산이 팔 쪽으로 끌려간다.
      if (hw < 0.35) continue;
      v.fromBufferAttribute(pos, i).applyMatrix4(boneInv);
      P.push(v.clone()); ids.push(i); wts.push(Math.min(1, hw));
    }
    if (P.length < 60) return;

    // --- 손 로컬 프레임 ---
    // f: 손목(본 원점)에서 가장 멀리 뻗은 25% 정점의 평균 방향 = 손가락이 향하는 축
    const byLen = P.map(p => p.length()).sort((a, c) => a - c);
    const farCut = byLen[Math.floor(byLen.length * 0.75)];
    const f = new THREE.Vector3();
    let nf = 0;
    for (const p of P) if (p.length() >= farCut) { f.add(p); nf++; }
    if (!nf) return;
    f.divideScalar(nf).normalize();

    const U = P.map(p => p.dot(f));
    const uMax = Math.max(...U);
    if (uMax < 1e-4) return;

    // b: 손끝 쪽 정점을 f 에 수직인 평면에 투영했을 때 가장 넓게 퍼진 방향
    //    (= 검지~새끼가 늘어선 방향). 2x2 공분산의 주축.
    const t1 = new THREE.Vector3(1, 0, 0);
    if (Math.abs(f.x) > 0.9) t1.set(0, 1, 0);
    t1.crossVectors(f, t1).normalize();
    const t2 = new THREE.Vector3().crossVectors(f, t1);
    let sxx = 0, sxy = 0, syy = 0, cx = 0, cy = 0, m = 0;
    const tips = [];
    for (let i = 0; i < P.length; i++) {
      if (U[i] < uMax * 0.72) continue;
      const x = P[i].dot(t1), y = P[i].dot(t2);
      tips.push([x, y]); cx += x; cy += y; m++;
    }
    if (m < 8) return;
    cx /= m; cy /= m;
    for (const [x, y] of tips) { const dx = x - cx, dy = y - cy; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    const tr = sxx + syy, det = sxx * syy - sxy * sxy;
    const l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det));
    let ex, ey;
    if (Math.abs(sxy) > 1e-12) { ex = l1 - syy; ey = sxy; }
    else if (sxx >= syy) { ex = 1; ey = 0; } else { ex = 0; ey = 1; }
    const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
    const b = new THREE.Vector3().addScaledVector(t1, ex).addScaledVector(t2, ey).normalize();
    // 부호를 고정해야 매번 같은 결과가 나온다 (공분산 주축은 부호가 임의)
    if (b.x < 0 || (Math.abs(b.x) < 1e-6 && b.z < 0)) b.negate();
    const n = new THREE.Vector3().crossVectors(f, b).normalize();
    // 이 리그에서는 +n 이 손바닥 쪽이라 그대로 감으면 안쪽으로 말린다.
    // (프레임 부호를 위에서 고정했으므로 이 상수도 고정이다)
    const PALM = 1;
    n.multiplyScalar(PALM);

    // --- 벤드 파라미터 ---
    const u0 = uMax * 0.47;              // 손가락 밑동(너클) 위치
    const span = uMax - u0;
    const CURL = 1.35;                   // 손끝까지 누적 회전량(라디안) — 반쯤 쥔 손
    const VARY = 0.18;                   // 손가락별 편차 (전부 똑같이 굽지 않게)
    const TUCK = 0.42;                   // 벌어진 손가락을 모으는 비율
    const k = CURL / span, R = 1 / k;

    // 손끝 무리의 b 축 중심 — 손가락을 여기로 모은다
    let sMid = 0, sn = 0, sMin = Infinity, sMax = -Infinity;
    for (let i = 0; i < P.length; i++) {
      if (U[i] < uMax * 0.72) continue;
      const s = P[i].dot(b); sMid += s; sn++;
      if (s < sMin) sMin = s; if (s > sMax) sMax = s;
    }
    sMid /= sn;
    const sHalf = Math.max(1e-5, (sMax - sMin) * 0.5);

    const bind = new THREE.Matrix4().copy(boneInv).invert();
    const rotB = new THREE.Matrix3().setFromMatrix4(bind);
    const rotI = new THREE.Matrix3().setFromMatrix4(boneInv);
    const axis = new THREE.Vector3().crossVectors(f, n).normalize();
    const q = new THREE.Quaternion(), out = new THREE.Vector3(), vn = new THREE.Vector3();
    const pa = pos.array, na = nrm.array;

    for (let i = 0; i < P.length; i++) {
      const u = U[i] - u0;
      if (u <= 0) continue;
      const idx = ids[i];
      const s = P[i].dot(b), w = P[i].dot(n);
      // 손가락 위치에 따라 말리는 양을 조금씩 다르게 (새끼 쪽이 더 말린다)
      const lat = (s - sMid) / sHalf;
      const amt = wts[i] * (1 + VARY * lat);
      const th = k * u * amt;
      const rr = R - w;
      const sTuck = sMid + (s - sMid) * (1 - TUCK * Math.min(1, u / span));

      out.copy(b).multiplyScalar(sTuck)
        .addScaledVector(f, u0 + rr * Math.sin(th))
        .addScaledVector(n, R - rr * Math.cos(th))
        .applyMatrix4(bind);
      pa[idx * 3] = out.x; pa[idx * 3 + 1] = out.y; pa[idx * 3 + 2] = out.z;

      q.setFromAxisAngle(axis, -th);
      vn.set(na[idx * 3], na[idx * 3 + 1], na[idx * 3 + 2])
        .applyMatrix3(rotI).applyQuaternion(q).applyMatrix3(rotB).normalize();
      na[idx * 3] = vn.x; na[idx * 3 + 1] = vn.y; na[idx * 3 + 2] = vn.z;
    }
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
  }

  /**
   * 이 모델은 이미 지팡이를 들고 있다(메시가 손 본에 스킨됨).
   * 어느 손인지, 지팡이 끝(수정)이 어디인지 스킨 웨이트로 자동 탐색해서
   * 마법이 튀어나올 지점(tipWorld)을 잡는다.
   */
  _findStaffTip() {
    let sk = null;
    this.model.traverse(o => { if (o.isSkinnedMesh && !sk) sk = o; });
    this.skinned = sk;
    this.tipWorld = new THREE.Vector3();
    if (!sk) return;

    const g = sk.geometry;
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, pos = g.attributes.position;
    const bones = sk.skeleton.bones, inverses = sk.skeleton.boneInverses;

    // 손 본 후보
    const cand = new Map();
    bones.forEach((b, i) => {
      if (/^hand/i.test(b.name.replace(/[._]/g, ''))) {
        cand.set(i, { bone: b, far: -1, topY: -Infinity, tip: new THREE.Vector3() });
      }
    });
    if (!cand.size) return;

    const v = new THREE.Vector3(), lv = new THREE.Vector3();
    const wi = [0, 0, 0, 0], bi = [0, 0, 0, 0];
    for (let i = 0; i < pos.count; i++) {
      wi[0] = sw.getX(i); wi[1] = sw.getY(i); wi[2] = sw.getZ(i); wi[3] = sw.getW(i);
      bi[0] = si.getX(i); bi[1] = si.getY(i); bi[2] = si.getZ(i); bi[3] = si.getW(i);
      let bestW = 0, best = bi[0];
      for (let k = 0; k < 4; k++) if (wi[k] > bestW) { bestW = wi[k]; best = bi[k]; }
      const c = cand.get(best);
      if (!c) continue;
      v.fromBufferAttribute(pos, i);
      lv.copy(v).applyMatrix4(inverses[best]);      // 본 로컬 좌표
      const d = lv.length();
      if (d > c.far) c.far = d;                     // 손에서 가장 멀리 뻗은 거리 = 지팡이 판별용
      if (v.y > c.topY) { c.topY = v.y; c.tip.copy(lv); }   // 바인드 포즈 기준 가장 높은 점 = 지팡이 수정
    }

    // 손 본에서 가장 멀리 뻗은 지오메트리 = 지팡이
    let staff = null;
    for (const c of cand.values()) if (!staff || c.far > staff.far) staff = c;
    if (!staff || staff.far < 0.15) return;

    this.staffHand = staff.bone;
    this.tipAnchor = new THREE.Object3D();
    this.tipAnchor.position.copy(staff.tip);
    staff.bone.add(this.tipAnchor);
    this.castArm = /L$/i.test(staff.bone.name.replace(/[._]/g, '')) ? 'L' : 'R';

    // 시전할 때 지팡이 수정이 빛나도록 (씬 좌표계에 두고 매 프레임 따라감)
    this.castGlow = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.13, 2),
      new THREE.MeshBasicMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.scene.add(this.castGlow);
    this.castLight = new THREE.PointLight(0x7fc4ff, 5, 11, 2);
    this.scene.add(this.castLight);
  }

  /**
   * 본 이름 해석.
   * GLTFLoader 는 노드 이름을 sanitize 하면서 '.' 을 지운다.
   * (GLB 안의 'thigh.L' → three.js 씬에서는 'thighL')
   * 그래서 원본 이름 / 점 제거 이름 / 소문자 순으로 찾아본다.
   */
  bone(name) {
    let b = this._boneCache.get(name);
    if (b !== undefined) return b;
    b = this.bones[name]
      || this.bones[name.replace(/\./g, '')]
      || this.bones[name.replace(/\./g, '_')]
      || this.bonesLower[name.replace(/\./g, '').toLowerCase()]
      || null;
    this._boneCache.set(name, b);
    return b;
  }

  /** 본을 모델 공간의 axis 축 기준으로 angle 만큼 추가 회전 */
  _rot(name, axis, angle) {
    if (!angle) return;
    this._rotM(name, [[axis, angle]]);
  }

  /**
   * 여러 축 회전을 한 번에 적용한다.
   * 쿼터니언을 순서대로 곱하면 뒤 회전의 축이 앞 회전만큼 딸려 돌아가므로
   * (예: 팔을 z로 내린 뒤 x로 스윙하면 스윙이 비틀림으로 새어나간다)
   * 매 단계에서 축을 누적 회전의 역으로 보정해 항상 '모델 공간 축'을 유지한다.
   */
  _rotM(name, ops) {
    const b = this.bone(name);
    if (!b) return;
    const ax = this._axisCache.get(b);
    const acc = this._qAcc.identity();
    let used = false;
    for (let i = 0; i < ops.length; i++) {
      const angle = ops[i][1];
      if (!angle) continue;
      this._axV.copy(ax[ops[i][0]]).applyQuaternion(this._qInv.copy(acc).invert());
      acc.multiply(this._q.setFromAxisAngle(this._axV, angle));
      used = true;
    }
    if (used) b.quaternion.multiply(acc);
  }

  _resetPose() {
    for (const [b, q] of this.rest) b.quaternion.copy(q);
  }

  update(dt, moveDir, aimPoint, opts = {}) {
    if (!this.model) return;

    // ---- 이동 ----
    const acc = 62, fric = 11;
    const boost = this.speed * this.stats.moveSpd;
    if (moveDir.lengthSq() > 0.0001) {
      this.vel.x += moveDir.x * acc * dt;
      this.vel.z += moveDir.z * acc * dt;
    }
    this.vel.x -= this.vel.x * fric * dt;
    this.vel.z -= this.vel.z * fric * dt;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > boost) { this.vel.x *= boost / sp; this.vel.z *= boost / sp; }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // 아레나 밖으로 못 나가게
    const r = Math.hypot(this.pos.x, this.pos.z);
    const lim = ARENA_RADIUS - 1.6;
    if (r > lim) {
      this.pos.x *= lim / r; this.pos.z *= lim / r;
      this.vel.multiplyScalar(0.5);
    }

    // ---- 가속도(관성) 측정: 기울기에 쓴다 ----
    const invDt = 1 / Math.max(dt, 1e-4);
    const ax = (this.vel.x - this._pv.x) * invDt;
    const az = (this.vel.z - this._pv.z) * invDt;
    this._pv.set(this.vel.x, 0, this.vel.z);
    const cs = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    // 캐릭터 로컬축: forward = (sin yaw, cos yaw), right = (cos yaw, -sin yaw)
    const accF = (ax * sn + az * cs) / acc;
    const accS = (ax * cs - az * sn) / acc;
    this.leanF = damp(this.leanF, clamp(accF, -1, 1), 9, dt);
    this.leanS = damp(this.leanS, clamp(accS, -1, 1), 9, dt);

    // ---- 방향 ----
    // 시전 중에는 조준점을, 그 외 이동 중에는 진행 방향을 바라본다.
    // 탑다운 시점이라 진행 방향을 봐야 앞으로 갈 때 뒷모습 / 내려올 때 앞모습이 나온다.
    this.aimLock = Math.max(0, this.aimLock - dt);
    if (opts.aiming) this.aimLock = Math.max(this.aimLock, 0.12);
    const moving = sp > boost * 0.14;
    if (aimPoint && (this.aimLock > 0 || !moving)) {
      this.facing = Math.atan2(aimPoint.x - this.pos.x, aimPoint.z - this.pos.z);
    } else if (moving) {
      this.facing = Math.atan2(this.vel.x, this.vel.z);
    }

    // 스프링 회전: 살짝 오버슛하며 돌아서 방향 전환이 눈에 띈다
    let d = this.facing - this.yaw;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    this.yawVel += d * 210 * dt;
    this.yawVel -= this.yawVel * Math.min(1, 20 * dt);
    this.yawVel = clamp(this.yawVel, -22, 22);
    this.yaw += this.yawVel * dt;
    this.root.rotation.y = this.yaw;

    // ---- 상태 ----
    const targetMove = clamp(sp / boost, 0, 1);
    this.moveAmt = damp(this.moveAmt, targetMove, 12, dt);
    this.runPhase += dt * (7.5 + this.moveAmt * 4) * this.moveAmt;
    this.castTimer = Math.max(0, this.castTimer - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.mp = Math.min(this.maxMp, this.mp + this.mpRegen * dt);

    this._animate(opts.time || 0, dt);
  }

  _animate(t, dt) {
    this._resetPose();

    const m = this.moveAmt;
    const p = this.runPhase;
    const s = Math.sin(p), s2 = Math.sin(p * 2);
    const cast = this.castTimer > 0 ? Math.sin(clamp(this.castTimer / 0.42, 0, 1) * Math.PI) : 0;
    const A = this.castArm === 'R' ? 'R' : 'L';       // 지팡이 든 팔
    const B = A === 'R' ? 'L' : 'R';                  // 빈 팔
    const sgnA = A === 'L' ? -1 : 1;                  // z축 부호: 왼팔은 음수가 '내리기'
    const sgnB = -sgnA;

    // --- 다리: 앞뒤 스윙 + 무릎 굽힘 (x축이 스윙축임을 검증) ---
    const swing = 1.30 * m;
    this._rot('thigh.L', 'x', -s * swing);
    this._rot('thigh.R', 'x', s * swing);
    this._rot('shin.L', 'x', Math.max(0, -s) * 1.65 * m);
    this._rot('shin.R', 'x', Math.max(0, s) * 1.65 * m);
    this._rot('foot.L', 'x', -Math.max(0, -s) * 0.5 * m);
    this._rot('foot.R', 'x', -Math.max(0, s) * 0.5 * m);
    this._rot('pelvis.L', 'y', -s * 0.2 * m);
    this._rot('pelvis.R', 'y', -s * 0.2 * m);

    // --- 몸통: 달릴 때 앞으로 기울고 좌우로 비틀림 ---
    // 골반과 어깨를 반대 위상으로 비틀면 달리기가 훨씬 살아난다.
    const breath = Math.sin(t * 1.9) * 0.05;
    this._rot('spine', 'x', 0.30 * m);
    this._rot('spine', 'y', -s * 0.22 * m);
    this._rot('spine.001', 'x', 0.10 * m + breath * (1 - m * 0.5));
    this._rot('spine.002', 'y', s * 0.26 * m);
    this._rot('spine.003', 'x', -0.12 * m - cast * 0.12);
    this._rot('spine.003', 'y', s * 0.14 * m + Math.sin(t * 1.3) * 0.025);
    this._rot('spine.004', 'x', -0.08 * m + Math.sin(t * 1.5 + 1) * 0.03);  // 목
    // 머리: 시선은 진행 방향에 고정하려 하므로 회전에 살짝 뒤처진다 (부차 모션)
    this._rotM('spine.005', [
      ['x', -0.14 * m],
      ['y', clamp(-this.yawVel * 0.05, -0.5, 0.5)]
    ]);

    // --- 팔: 원본이 T포즈라 먼저 z축으로 내려 A포즈를 만든 뒤 앞뒤로 스윙 ---
    // 빈 손 쪽 팔 (다리와 반대 위상으로 흔든다)
    this._rotM('upper_arm.' + B, [
      ['z', sgnB * (1.05 - 0.20 * m)],
      ['x', s * 1.55 * m - 0.12]
    ]);
    this._rotM('forearm.' + B, [
      ['z', sgnB * 0.15],
      ['x', -0.45 - Math.max(0, s) * 1.0 * m - cast * 0.3]
    ]);
    this._rot('hand.' + B, 'x', -0.2);
    this._rot('shoulder.' + B, 'x', -s * 0.14 * m);

    // 지팡이 든 팔: 앞으로 들고, 시전할 때 앞으로 내지른다
    const azA = sgnA * (0.88 - cast * 0.40);
    const axA = -0.40 - cast * 0.95 - s * 0.45 * m;
    const fzA = sgnA * 0.20;
    const fxA = -0.70 + cast * 0.30;
    this._rotM('upper_arm.' + A, [['z', azA], ['x', axA]]);
    this._rotM('forearm.' + A, [['z', fzA], ['x', fxA]]);

    // 손목: 팔 회전을 그대로 상쇄해 지팡이가 늘 세워져 있게 한다.
    // (_rotM 은 뒤 항목이 앞에 곱해지므로, 역순 + 부호 반전이 정확한 역회전이 된다)
    this._rotM('hand.' + A, [
      ['x', -axA], ['z', -azA], ['x', -fxA], ['z', -fzA],
      ['x', -0.12 - cast * 0.55],                 // 살짝 앞으로 기울이고, 시전 때 더 내지름
      ['z', sgnA * (0.10 + cast * 0.15)]
    ]);
    this._rot('shoulder.' + A, 'x', -cast * 0.22);

    // --- 상하 바운스 + 착지 스쿼시 ---
    const bounce = Math.abs(s2) * 0.16 * m + Math.sin(t * 1.9) * 0.012;
    this.model.position.y = this._baseY(bounce);

    // 발이 닿는 순간(바운스 최저점)에 눌렸다가 튀어오른다
    const land = (1 - Math.abs(s2)) * m;
    const sq = 1 - land * 0.075;
    const sw = 1 + land * 0.05;
    this.model.scale.set(this._s0 * sw, this._s0 * sq, this._s0 * sw);

    // --- 관성 기울기: 도는 쪽으로 눕고, 가속/감속에 따라 앞뒤로 기운다 ---
    // (모델 원점이 발밑이라 발을 축으로 기울어진다)
    const bank = clamp(this.yawVel * 0.045, -0.30, 0.30) + this.leanS * 0.22;
    this.model.rotation.z = -clamp(bank, -0.42, 0.42);
    this.model.rotation.x = clamp(this.leanF * 0.20, -0.22, 0.22);

    // --- 지팡이 끝(수정) 위치 갱신 + 시전 발광 ---
    if (this.tipAnchor) {
      this.tipAnchor.updateWorldMatrix(true, false);
      this.tipAnchor.getWorldPosition(this.tipWorld);
      if (this.castGlow) {
        this.castGlow.position.copy(this.tipWorld);
        this.castGlow.scale.setScalar(0.65 + cast * 1.5);
        this.castGlow.material.opacity = 0.35 + cast * 0.6;
        this.castLight.position.copy(this.tipWorld);
        this.castLight.intensity = 4 + cast * 30;
      }
    }
  }

  _baseY(bounce) {
    if (this._y0 === undefined) this._y0 = this.model.position.y;
    return this._y0 + bounce;
  }

  /** 마법 시전 모션 트리거 */
  cast(kind) {
    this.castTimer = 0.42;
    this.aimLock = 0.55;      // 시전 중에는 조준점을 바라보게 고정
    this.castKind = kind;
    const col = kind === 'frost' ? 0x7fe6ff : kind === 'chain' ? 0xbba6ff : kind === 'meteor' ? 0xff8a4a : 0xffa24a;
    if (this.castLight) this.castLight.color.set(col);
    if (this.castGlow) this.castGlow.material.color.set(col);
  }

  spendMana(v) {
    if (this.mp < v) return false;
    this.mp -= v;
    return true;
  }

  damage(v) {
    if (this.invuln > 0 || !this.alive) return false;
    this.hp -= v;
    this.hurtFlash = 0.35;
    this.invuln = 0.35;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; }
    return true;
  }

  heal(v) { this.hp = Math.min(this.maxHp, this.hp + v); }

  restoreMana(v) { this.mp = Math.min(this.maxMp, this.mp + v); }

  addXp(v) {
    this.xp += v;
    let leveled = 0;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = Math.round(this.xpNext * 1.32 + 6);
      leveled++;
    }
    return leveled;
  }

  reset() {
    this.pos.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this._pv.set(0, 0, 0);
    this.yawVel = 0; this.aimLock = 0;
    this.leanF = 0; this.leanS = 0;
    this.hp = this.maxHp = 100;
    this.mp = this.maxMp = 100;
    this.mpRegen = 11;
    this.level = 1; this.xp = 0; this.xpNext = 12;
    this.alive = true;
    this.invuln = 0;
    this.stats = {
      dmg: 1, cdr: 1, moveSpd: 1, lifesteal: 0,
      fireExtra: 0, novaRadius: 1, chainExtra: 0, blinkCdr: 1, pierce: 0,
      crit: 0.16, manaOnKill: 0
    };
  }
}
