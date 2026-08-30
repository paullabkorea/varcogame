import * as THREE from 'three';
import { rand, randInt, clamp, TAU, dist2D, damp } from './utils.js';
import { ARENA_RADIUS } from './world.js';
import { makeModel, modelInfo } from './models.js';

/* ------------------------------------------------------------------ */
/*  몹 종류 정의                                                        */
/* ------------------------------------------------------------------ */
export const TYPES = {
  // ---- GLB 모델 몹 (assets/models) ----
  slime: {
    name: '늪 슬라임', hp: 46, speed: 3.3, dmg: 9, radius: 0.80, xp: 3, score: 10,
    color: 0x5ce07a, emissive: 0x1d5a2b, height: 1.15, knock: 1,
    glb: 'slime'
  },
  skeleton: {
    name: '해골 전사', hp: 60, speed: 3.9, dmg: 11, radius: 0.55, xp: 5, score: 16,
    color: 0xe4dcc4, emissive: 0x5a5140, height: 1.80, knock: 1.1,
    glb: 'skeleton'
  },
  skelSword: {
    name: '해골 검사', hp: 96, speed: 4.2, dmg: 19, radius: 0.6, xp: 8, score: 30,
    color: 0xc9a76a, emissive: 0x6b4a20, height: 1.80, knock: 0.9,
    glb: 'skeleton', weapon: 'sword', reach: 1.9
  },
  skelStaff: {
    name: '해골 술사', hp: 76, speed: 3.0, dmg: 14, radius: 0.58, xp: 9, score: 36,
    color: 0xb28cff, emissive: 0x4a1f8f, height: 1.80, knock: 0.85,
    glb: 'skeleton', weapon: 'staff',
    ranged: true, range: 13, fireRate: 2.2, boltSpeed: 13
  },

  // ---- 프리미티브 몹 ----
  imp: {
    name: '화염 임프', hp: 30, speed: 6.0, dmg: 7, radius: 0.6, xp: 4, score: 14,
    color: 0xff5a3c, emissive: 0x902000, height: 1.2, knock: 1.3
  },
  golem: {
    name: '석상 골렘', hp: 210, speed: 2.0, dmg: 26, radius: 1.5, xp: 14, score: 45,
    color: 0x8e8aa8, emissive: 0x2b2740, height: 2.6, knock: 0.25
  },
  wraith: {
    name: '저주받은 망령', hp: 66, speed: 3.1, dmg: 13, radius: 0.8, xp: 8, score: 30,
    color: 0xb28cff, emissive: 0x4a1f8f, height: 1.9, knock: 0.8, ranged: true,
    range: 13, fireRate: 2.3, boltSpeed: 13
  },
  boss: {
    name: '심연의 군주', hp: 820, speed: 2.5, dmg: 34, radius: 2.4, xp: 90, score: 500,
    color: 0x1f1030, emissive: 0xff2d55, height: 4.6, knock: 0, boss: true,
    ranged: true, range: 16, fireRate: 1.5, boltSpeed: 15
  }
};

/* ------------------------------------------------------------------ */
/*  메시 빌더 (외부 에셋 없이 프리미티브로 조립)                          */
/* ------------------------------------------------------------------ */
function bodyMat(def, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color: def.color, emissive: def.emissive, emissiveIntensity: 0.6,
    roughness: 0.7, flatShading: true, ...extra
  });
}
function eyeMat(color = 0xffe66b) {
  return new THREE.MeshBasicMaterial({ color });
}

function buildImp(def) {
  const g = new THREE.Group();
  const mat = bodyMat(def, { emissiveIntensity: 1.2 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.4, 4, 10), mat);
  body.position.y = 0.62;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), mat);
  head.position.y = 1.15;
  g.add(head);
  const hornGeo = new THREE.ConeGeometry(0.07, 0.28, 5);
  [-0.16, 0.16].forEach(x => {
    const h = new THREE.Mesh(hornGeo, mat);
    h.position.set(x, 1.4, 0);
    h.rotation.z = x > 0 ? -0.4 : 0.4;
    g.add(h);
  });
  const eyeGeo = new THREE.SphereGeometry(0.06, 6, 5);
  const eyes = [];
  [-0.11, 0.11].forEach(x => {
    const e = new THREE.Mesh(eyeGeo, eyeMat(0xffd23c));
    e.position.set(x, 1.18, 0.24);
    g.add(e); eyes.push(e);
  });
  const wingGeo = new THREE.ConeGeometry(0.3, 0.5, 3);
  const wings = [];
  [-1, 1].forEach(s => {
    const w = new THREE.Mesh(wingGeo, mat);
    w.position.set(s * 0.32, 0.85, -0.12);
    w.rotation.set(Math.PI / 2, 0, s * 0.6);
    g.add(w); wings.push(w);
  });
  return { group: g, mats: [mat], body, wings, kind: 'imp' };
}

function buildGolem(def) {
  const g = new THREE.Group();
  const mat = bodyMat(def, { roughness: 1 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.1), mat);
  torso.position.y = 1.65;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.65, 0.7), mat);
  head.position.y = 2.7;
  g.add(head);
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.28),
    new THREE.MeshStandardMaterial({ color: 0xff9a3c, emissive: 0xff6a00, emissiveIntensity: 3 })
  );
  core.position.set(0, 1.75, 0.58);
  g.add(core);
  const arms = [];
  [-1, 1].forEach(s => {
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.3, 0.45), mat);
    a.position.set(s * 1.05, 1.6, 0);
    g.add(a); arms.push(a);
  });
  const legs = [];
  [-1, 1].forEach(s => {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.5), mat);
    l.position.set(s * 0.38, 0.5, 0);
    g.add(l); legs.push(l);
  });
  return { group: g, mats: [mat], body: torso, arms, legs, core, kind: 'golem' };
}

function buildWraith(def) {
  const g = new THREE.Group();
  const mat = bodyMat(def, { transparent: true, opacity: 0.8, emissiveIntensity: 1.4 });
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.7, 10, 1, true), mat);
  robe.position.y = 0.95;
  g.add(robe);
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 10), mat);
  hood.position.y = 1.85;
  g.add(hood);
  const face = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x0a0418 })
  );
  face.position.set(0, 1.8, 0.2);
  g.add(face);
  [-0.1, 0.1].forEach(x => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), eyeMat(0x9cf0ff));
    e.position.set(x, 1.83, 0.34);
    g.add(e);
  });
  const arms = [];
  [-1, 1].forEach(s => {
    const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.5, 3, 6), mat);
    a.position.set(s * 0.5, 1.3, 0.15);
    a.rotation.z = s * 0.9;
    g.add(a); arms.push(a);
  });
  return { group: g, mats: [mat], body: robe, arms, kind: 'wraith' };
}

function buildBoss(def) {
  const g = new THREE.Group();
  const mat = bodyMat(def, { emissiveIntensity: 0.9, roughness: 0.55, metalness: 0.3 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(1.0, 1.5, 6, 14), mat);
  torso.position.y = 2.5;
  g.add(torso);
  const cape = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3.0, 10, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x2a0d1f, emissive: 0x5c0020, emissiveIntensity: 0.7, side: THREE.DoubleSide, flatShading: true }));
  cape.position.y = 2.3;
  cape.position.z = -0.35;
  g.add(cape);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 0), mat);
  head.position.y = 4.0;
  g.add(head);
  const hornGeo = new THREE.ConeGeometry(0.16, 1.1, 6);
  [-1, 1].forEach(s => {
    const h = new THREE.Mesh(hornGeo, new THREE.MeshStandardMaterial({ color: 0x0e0616, roughness: 0.5, flatShading: true }));
    h.position.set(s * 0.4, 4.6, -0.1);
    h.rotation.set(-0.3, 0, s * 0.55);
    g.add(h);
  });
  const eyes = [];
  [-0.2, 0.2].forEach(x => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), eyeMat(0xff2d55));
    e.position.set(x, 4.05, 0.5);
    g.add(e); eyes.push(e);
  });
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.42, 1),
    new THREE.MeshStandardMaterial({ color: 0xff2d55, emissive: 0xff2d55, emissiveIntensity: 3.4 })
  );
  core.position.set(0, 2.9, 0.75);
  g.add(core);
  const arms = [];
  [-1, 1].forEach(s => {
    const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 1.5, 4, 8), mat);
    a.position.set(s * 1.25, 2.6, 0);
    a.rotation.z = s * 0.35;
    g.add(a); arms.push(a);
  });
  // 발광은 풀 라이트를 빌려 쓴다 (씬에 라이트를 넣었다 빼면 셰이더가 전부 재컴파일된다)
  const glowAnchor = new THREE.Object3D();
  glowAnchor.position.set(0, 3, 0);
  g.add(glowAnchor);
  return { group: g, mats: [mat], body: torso, arms, core, eyes, glowAnchor, kind: 'boss' };
}

/**
 * GLB 몹. 지오메트리·텍스처는 models.js 가 캐시한 걸 공유하고 재질만 복제한다
 * (피격 플래시가 몹마다 따로 놀아야 해서).
 *
 *   group      ← Enemy 가 위치/방향을 굴림
 *   └ tilt     ← 몸 전체 기울기·스쿼시
 *     ├ body   ← 해골은 리그가 살아 있는 스킨 메시, 슬라임은 구운 정적 메시
 *     └ (무기는 손 본에 직접 매단다 — 팔을 휘두르면 같이 따라온다)
 */
function buildGLB(def) {
  const g = new THREE.Group();
  const tilt = new THREE.Group();
  g.add(tilt);

  const body = makeModel(def.glb);
  tilt.add(body);
  const mats = [...body.userData.mats];

  const info = modelInfo(def.glb);
  const rig = info.rig ?? null;
  let bones = null;
  if (rig) {
    bones = {};
    body.traverse(o => { if (o.isBone) bones[o.name] = o; });
  }

  let weapon = null, weaponTip = null;
  if (def.weapon) {
    weapon = makeModel(def.weapon);
    mats.push(...weapon.userData.mats);

    const tip = modelInfo(def.weapon).tip;      // 지팡이 수정 = 마법탄 발사 지점
    if (tip != null) {
      weaponTip = new THREE.Object3D();
      weaponTip.position.y = tip;
      weapon.add(weaponTip);
    }

    const handBone = bones && bones[rig.handBone];
    if (handBone) {
      // 손 본에 매단다. 본은 모델 스케일을 물려받으므로 무기 크기를 되돌려 준다.
      weapon.scale.setScalar(1 / rig.handScale);
      // 손 본의 로컬 축이 제각각이라, 원하는 "모델 공간 각도"를 본 로컬로 변환해서 넣는다.
      const restQ = new THREE.Quaternion();
      handBone.getWorldQuaternion(restQ);
      const rootQ = new THREE.Quaternion();
      g.getWorldQuaternion(rootQ);
      restQ.premultiply(rootQ.invert()).invert();
      weapon.quaternion.copy(restQ).multiply(
        new THREE.Quaternion().setFromEuler(WEAPON_REST[def.weapon] ?? new THREE.Euler())
      );
      handBone.add(weapon);
    } else {
      tilt.add(weapon);                          // 리그가 없으면 그냥 몸에 붙인다
    }
  }

  return {
    group: g, tilt, body, bones, rig, weapon, weaponTip, mats,
    kind: def.glb === 'slime' ? 'glbSlime' : 'glbHumanoid', glb: true
  };
}

/** 손에 쥐었을 때의 각도 — 모델 공간 기준. 날이 위, 몸 바깥(-x)으로 살짝 눕는다 */
const WEAPON_REST = {
  sword: new THREE.Euler(-0.14, 0, 0.34),
  staff: new THREE.Euler(-0.04, 0, 0.12),
};

/* ------------------------------------------------------------------ */
/*  본 포즈 헬퍼                                                        */
/* ------------------------------------------------------------------ */
const _q = new THREE.Quaternion();
const _qAcc = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const _axV = new THREE.Vector3();

/**
 * 본을 rest 포즈 기준으로 "모델 공간 축" 만큼 돌린다.
 * models.js 가 미리 구워 둔 축 변환 덕에 본의 roll 과 무관하게 방향이 일정하다.
 *
 * ops 는 [축, 각도] 목록. 쿼터니언을 그냥 순서대로 곱하면 뒤 회전의 축이 앞 회전만큼
 * 딸려 돌아가서 (T포즈 팔을 z로 내린 뒤 x로 스윙하면 비틀림으로 새어나간다)
 * 매 단계에서 축을 누적 회전의 역으로 보정한다. player.js `_rotM()` 과 같은 방식.
 */
function poseBone(parts, name, ops) {
  const b = parts.bones && parts.bones[name];
  if (!b) return;
  const r = parts.rig.rest.get(name);
  if (!r) return;
  b.quaternion.copy(r.q);
  const acc = _qAcc.identity();
  let used = false;
  for (let i = 0; i < ops.length; i++) {
    const angle = ops[i][1];
    if (!angle) continue;
    _axV.copy(r[ops[i][0]]).applyQuaternion(_qInv.copy(acc).invert());
    acc.multiply(_q.setFromAxisAngle(_axV, angle));
    used = true;
  }
  if (used) b.quaternion.multiply(acc);
}

const BUILDERS = {
  slime: buildGLB, skeleton: buildGLB, skelSword: buildGLB, skelStaff: buildGLB,
  imp: buildImp, golem: buildGolem, wraith: buildWraith, boss: buildBoss
};

/* ------------------------------------------------------------------ */
/*  몹 인스턴스                                                         */
/* ------------------------------------------------------------------ */
const _WHITE = new THREE.Color(0xffffff);

/* 해골 걷기 상수 (모델 공간 라디안). 팔을 내린 기본 자세는 models.js 의 restPose 담당 */
const LEG_SWING = 0.42;   // 허벅지 앞뒤 스윙
const KNEE_BEND = 0.62;   // 무릎 접힘 (뒤로 간 다리만)
const ARM_SWING = 0.50;   // 팔 앞뒤 스윙
const _TMP = new THREE.Vector3();

let UID = 0;
export class Enemy {
  constructor(type, level, ctx) {
    this.id = ++UID;
    this.type = type;
    this.def = TYPES[type];
    this.ctx = ctx;

    const built = BUILDERS[type](this.def);
    this.parts = built;
    this.obj = built.group;
    this.obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    const scale = 1 + (level - 1) * 0.012;
    this.maxHp = Math.round(this.def.hp * (1 + (level - 1) * 0.17));
    this.hp = this.maxHp;
    this.dmg = this.def.dmg * (1 + (level - 1) * 0.06);
    this.speed = this.def.speed * (1 + Math.min(0.35, (level - 1) * 0.012));
    this.radius = this.def.radius * scale;
    this.obj.scale.setScalar(scale);

    this.pos = this.obj.position;
    this.vel = new THREE.Vector3();
    this.knock = new THREE.Vector3();
    this.slowT = 0; this.slowMul = 1;
    this.burnT = 0; this.burnDps = 0; this.burnTick = 0;
    this.flash = 0;
    this.atkCd = rand(0.3, 1.2);
    this.fireCd = rand(0.6, 2.0);
    this.phase = rand(0, TAU);
    this.spawnT = 0.7;          // 소환 연출 시간
    this.swing = 0;             // 무기 휘두르기 진행도 (1 → 0)
    this.stride = rand(0, TAU); // 걸음 위상
    this.dead = false;
    this.yBase = 0;
    this.hopT = rand(0, 1);

    // 보스 발광 라이트 (풀에서 하나 빌려 매 프레임 따라다닌다)
    this.glowH = built.glowAnchor && ctx.lights
      ? ctx.lights.acquire(this.def.emissive, 26, 20, 3)
      : null;

    ctx.scene.add(this.obj);
  }

  get alive() { return !this.dead && this.hp > 0; }

  hit(dmg, from, opts = {}) {
    if (this.dead) return 0;
    this.hp -= dmg;
    this.flash = 0.14;
    if (from && this.def.knock > 0) {
      const k = (opts.knock ?? 1) * this.def.knock * 5.5;
      this.knock.x += (this.pos.x - from.x);
      this.knock.z += (this.pos.z - from.z);
      const l = Math.hypot(this.knock.x, this.knock.z) || 1;
      this.knock.x = this.knock.x / l * k;
      this.knock.z = this.knock.z / l * k;
    }
    if (opts.slow) { this.slowT = Math.max(this.slowT, opts.slow.time); this.slowMul = opts.slow.mul; }
    if (opts.burn) { this.burnT = Math.max(this.burnT, opts.burn.time); this.burnDps = Math.max(this.burnDps, opts.burn.dps); }
    return dmg;
  }

  update(dt, player, ctx) {
    const t = ctx.time;

    if (this.spawnT > 0) {
      this.spawnT -= dt;
      const k = clamp(1 - this.spawnT / 0.7, 0, 1);
      this.obj.position.y = this.yBase - (1 - k) * 3.0;
      this.obj.rotation.y += dt * 3;
      this.obj.visible = true;
      if (this.spawnT > 0) return;
    }

    // 상태 이상
    if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) this.slowMul = 1; }
    if (this.burnT > 0) {
      this.burnT -= dt;
      this.burnTick -= dt;
      if (this.burnTick <= 0) {
        this.burnTick = 0.5;
        this.hp -= this.burnDps * 0.5;
        ctx.fx.particles.emit(4, {
          origin: this.center(), color: 0xff8a3c, color2: 0xffd166,
          speed: [0.6, 2], size: [0.2, 0], life: [0.25, 0.5], gravity: -2, spread: 0.3
        });
        ctx.onBurnTick && ctx.onBurnTick(this, this.burnDps * 0.5);
      }
    }
    this.flash = Math.max(0, this.flash - dt);

    // ---- 이동 AI ----
    const d = dist2D(this.pos, player.pos);
    const dirX = (player.pos.x - this.pos.x) / (d || 1);
    const dirZ = (player.pos.z - this.pos.z) / (d || 1);
    const spd = this.speed * this.slowMul;

    let mx = 0, mz = 0;
    if (this.def.ranged) {
      const want = this.def.range;
      if (d > want + 1.5) { mx = dirX; mz = dirZ; }
      else if (d < want - 3) { mx = -dirX; mz = -dirZ; }
      else { mx = -dirZ * 0.7; mz = dirX * 0.7; }   // 옆으로 선회
    } else {
      mx = dirX; mz = dirZ;
    }

    // 몹끼리 밀어내기
    const near = ctx.grid.near(this.pos, this.radius + 2.2);
    for (const o of near) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      const dd = Math.hypot(dx, dz);
      const min = this.radius + o.radius;
      if (dd < min && dd > 0.0001) {
        const push = (min - dd) / min;
        mx += (dx / dd) * push * 1.6;
        mz += (dz / dd) * push * 1.6;
      }
    }

    const ml = Math.hypot(mx, mz) || 1;
    this.vel.x = damp(this.vel.x, (mx / ml) * spd, 8, dt);
    this.vel.z = damp(this.vel.z, (mz / ml) * spd, 8, dt);

    this.knock.multiplyScalar(Math.max(0, 1 - dt * 6));
    this.pos.x += (this.vel.x + this.knock.x) * dt;
    this.pos.z += (this.vel.z + this.knock.z) * dt;

    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > ARENA_RADIUS - 1) { this.pos.x *= (ARENA_RADIUS - 1) / r; this.pos.z *= (ARENA_RADIUS - 1) / r; }

    // 플레이어 바라보기
    const face = Math.atan2(dirX, dirZ);
    let df = face - this.obj.rotation.y;
    while (df > Math.PI) df -= TAU;
    while (df < -Math.PI) df += TAU;
    this.obj.rotation.y += df * Math.min(1, dt * 8);

    // ---- 공격 ----
    this.atkCd -= dt;
    if (!this.def.ranged || this.def.boss) {
      const reach = this.radius + (this.def.reach ?? 1.3);
      if (d < reach && this.atkCd <= 0) {
        this.atkCd = this.def.boss ? 1.6 : 1.1;
        this.swing = 1;
        ctx.meleeHit(this, this.dmg);
        this.knock.x -= dirX * 3; this.knock.z -= dirZ * 3;
      }
    }
    if (this.def.ranged) {
      this.fireCd -= dt;
      if (this.fireCd <= 0 && d < this.def.range + 8) {
        this.fireCd = this.def.fireRate * rand(0.8, 1.25);
        this.swing = 1;
        ctx.enemyShoot(this, player);
      }
    }
    if (this.def.boss) {
      this.summonCd = (this.summonCd ?? 8) - dt;
      if (this.summonCd <= 0) { this.summonCd = rand(9, 13); ctx.bossSummon(this); }
    }

    this._animate(dt, t);
  }

  _animate(dt, t) {
    const p = this.parts;
    const moving = Math.hypot(this.vel.x, this.vel.z);
    const s = Math.sin(t * 6 + this.phase);
    this.swing = Math.max(0, this.swing - dt * 3.4);

    switch (p.kind) {
      // ---- GLB 슬라임: 통통 튀고, 뜰 때 늘어나고 닿을 때 눌린다 ----
      case 'glbSlime': {
        this.hopT += dt * (2.0 + moving * 0.32);
        const hop = Math.abs(Math.sin(this.hopT * Math.PI));
        this.obj.position.y = this.yBase + hop * 0.34;
        const stretch = 1 + hop * 0.20 - (1 - hop) * 0.10;   // 공중 길쭉 / 착지 납작
        const w = 1 / Math.sqrt(stretch);                    // 부피 유지
        p.tilt.scale.set(w, stretch, w);
        p.tilt.rotation.z = Math.sin(t * 2.4 + this.phase) * 0.05;
        break;
      }

      // ---- GLB 해골: 23본 리그를 직접 굴려 걷기/공격을 만든다 ----
      // rest 가 이미 A포즈(팔 내림)라, 여기서는 전부 모델 공간 x/y/z 로 다루면 된다.
      // 모델 공간에서 +x 회전 = 팔다리가 뒤로, -x = 앞으로.
      case 'glbHumanoid': {
        const run = clamp(moving / Math.max(0.001, this.def.speed), 0, 1);
        this.stride += dt * (3.4 + run * 5.6);
        const sw = Math.sin(this.stride);        // 걸음 위상 (+면 왼다리가 앞)
        const sw2 = Math.sin(this.stride * 2);   // 상하 반동 (한 걸음에 두 번)
        const breathe = Math.sin(t * 1.9 + this.phase) * 0.03;

        // 다리: 좌우 반대 위상. 무릎은 뒤로 간 다리만 접는다
        const legA = LEG_SWING * run;
        poseBone(p, 'LeftUpLeg', [['x', -sw * legA]]);
        poseBone(p, 'RightUpLeg', [['x', sw * legA]]);
        poseBone(p, 'LeftLeg', [['x', Math.max(0, -sw) * KNEE_BEND * run]]);
        poseBone(p, 'RightLeg', [['x', Math.max(0, sw) * KNEE_BEND * run]]);
        poseBone(p, 'LeftFoot', [['x', -Math.max(0, -sw) * 0.3 * run]]);
        poseBone(p, 'RightFoot', [['x', -Math.max(0, sw) * 0.3 * run]]);

        // 상체: 달릴수록 앞으로 숙이고, 골반과 반대로 비튼다
        poseBone(p, 'Spine', [['x', -0.16 * run + breathe], ['y', sw * 0.10 * run]]);
        poseBone(p, 'Spine2', [['x', -0.08 * run], ['y', -sw * 0.06 * run]]);
        poseBone(p, 'Head', [['x', 0.14 * run - breathe]]);

        // 팔: 같은 쪽 다리와 반대 위상
        const armA = ARM_SWING * run;
        poseBone(p, 'LeftArm', [['x', sw * armA + breathe]]);
        poseBone(p, 'LeftForeArm', [['x', -Math.max(0, sw) * 0.45 * run]]);

        const u = 1 - this.swing;                // 스윙 진행도 0 → 1 (쉴 때 1)
        if (this.swing <= 0) {
          poseBone(p, 'RightArm', [['x', -sw * armA - breathe]]);
          poseBone(p, 'RightForeArm', [['x', -Math.max(0, -sw) * 0.45 * run]]);
          p.tilt.rotation.y = 0;
        } else if (this.def.ranged) {
          // 시전: 지팡이를 앞으로 겨눴다 되돌린다
          const a = Math.sin(u * Math.PI);
          poseBone(p, 'RightArm', [['x', -a * 1.15]]);
          poseBone(p, 'RightForeArm', [['x', -a * 0.75]]);
          p.tilt.rotation.y = 0;
        } else {
          // 내려치기. +x 가 뒤라서 머리 위로 젖혔다가(+) 앞으로 내리친다(-)
          const a = u < 0.30 ? (u / 0.30) * 2.1                  // 0 → 뒤로 크게 젖힘
            : u < 0.55 ? 2.1 - (u - 0.30) / 0.25 * 2.7           // 젖힘 → 앞으로 내려침
              : -0.6 * (1 - (u - 0.55) / 0.45);                  // 복귀
          poseBone(p, 'RightArm', [['x', a]]);
          poseBone(p, 'RightForeArm', [['x', -Math.max(0, a) * 0.55]]);   // 젖힐 때만 접힘
          p.tilt.rotation.y = a * 0.13;          // 몸통도 같이 돌아간다
        }

        // 몸 전체 반동
        this.obj.position.y = this.yBase + Math.abs(sw2) * 0.045 * run;
        p.tilt.rotation.z = sw * 0.035 * run;
        break;
      }

      case 'imp': {
        this.obj.position.y = this.yBase + Math.abs(Math.sin(t * 9 + this.phase)) * 0.16;
        p.wings.forEach((w, i) => { w.rotation.z = (i ? 1 : -1) * (0.6 + Math.sin(t * 26 + this.phase) * 0.6); });
        break;
      }
      case 'golem': {
        const w = Math.sin(t * 3.2 + this.phase) * Math.min(1, moving * 0.5);
        p.legs[0].rotation.x = w * 0.5;
        p.legs[1].rotation.x = -w * 0.5;
        p.arms[0].rotation.x = -w * 0.4;
        p.arms[1].rotation.x = w * 0.4;
        this.obj.position.y = this.yBase + Math.abs(w) * 0.08;
        p.core.rotation.y += dt * 1.5;
        break;
      }
      case 'wraith': {
        this.obj.position.y = this.yBase + 0.55 + Math.sin(t * 1.8 + this.phase) * 0.22;
        p.arms.forEach((a, i) => { a.rotation.x = Math.sin(t * 2 + i) * 0.25; });
        p.body.rotation.y = Math.sin(t * 0.9 + this.phase) * 0.15;
        break;
      }
      case 'boss': {
        this.obj.position.y = this.yBase + Math.sin(t * 1.4) * 0.18;
        p.arms.forEach((a, i) => { a.rotation.x = Math.sin(t * 2.2 + i * 1.6) * 0.35; });
        p.core.rotation.y += dt * 2;
        p.core.rotation.x += dt * 1.1;
        if (this.glowH) {
          p.glowAnchor.getWorldPosition(_TMP);
          this.glowH.at(_TMP).set(22 + Math.sin(t * 5) * 8);
        }
        break;
      }
    }

    // 피격 플래시 / 빙결 틴트
    // GLB 몹은 텍스처가 있어서 평소 emissive 를 0 으로 둬야 색이 안 뜬다.
    const flashK = this.flash / 0.14;
    const glb = !!p.glb;
    for (const m of p.mats) {
      if (this.slowT > 0) {
        m.emissive.setHex(0x2f7fd0);
        m.emissiveIntensity = (glb ? 0.5 : 1.4) + flashK * 3;
      } else {
        m.emissive.setHex(glb ? 0x000000 : this.def.emissive);
        m.emissiveIntensity = (glb ? 0 : this.def.boss ? 0.9 : 0.6) + flashK * (glb ? 2.6 : 4);
      }
      if (flashK > 0) m.emissive.lerp(_WHITE, flashK * 0.8);
    }
  }

  center() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.def.height * 0.55, this.pos.z);
  }

  /** 원거리 탄이 나가는 지점. 지팡이가 있으면 수정 구슬에서 쏜다. */
  muzzle() {
    const tip = this.parts.weaponTip;
    if (!tip) return this.center();
    this.obj.updateMatrixWorld(true);
    return tip.getWorldPosition(new THREE.Vector3());
  }

  dispose(scene) {
    scene.remove(this.obj);
    if (this.glowH) { this.glowH.release(); this.glowH = null; }
    // GLB 몹은 지오메트리·텍스처를 캐시에서 공유하므로 재질 복제본만 버린다.
    // 다만 스킨 메시는 몹마다 자기 Skeleton(= 본 텍스처)을 갖고 있어서 따로 버려야 샌다.
    const shared = !!this.parts.glb;
    this.obj.traverse(o => {
      if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose();
      if (!o.isMesh) return;
      if (!shared) o.geometry.dispose();
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
      else o.material.dispose();
    });
  }
}

/* ------------------------------------------------------------------ */
/*  공간 해시 (근접 검색)                                               */
/* ------------------------------------------------------------------ */
export class Grid {
  constructor(cell = 5) { this.cell = cell; this.map = new Map(); }
  _key(x, z) { return ((x / this.cell) | 0) + ':' + ((z / this.cell) | 0); }
  rebuild(list) {
    this.map.clear();
    for (const e of list) {
      if (!e.alive) continue;
      const k = this._key(e.pos.x, e.pos.z);
      let a = this.map.get(k);
      if (!a) this.map.set(k, a = []);
      a.push(e);
    }
  }
  near(pos, radius) {
    const out = [];
    const c = this.cell;
    const r = Math.ceil(radius / c);
    const cx = (pos.x / c) | 0, cz = (pos.z / c) | 0;
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const a = this.map.get((cx + i) + ':' + (cz + j));
      if (a) out.push(...a);
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/*  웨이브 관리                                                         */
/* ------------------------------------------------------------------ */
/**
 * 웨이브별 등장 순서 — 1:슬라임 2:해골 3:칼 해골 4:지팡이 해골 5+:혼합.
 * 프리미티브 몹 golem / wraith 는 지금 정규 웨이브에서 빠져 있다.
 * 다시 섞고 싶으면 이 배열과 아래 COST 에 추가하면 된다 (imp 는 보스 소환으로 계속 나온다).
 */
export const INTRO = ['slime', 'skeleton', 'skelSword', 'skelStaff'];

/** 웨이브 예산에서 몹 한 마리가 먹는 비용 (셀수록 비싸다) */
const COST = { slime: 1, skeleton: 1.3, skelSword: 1.9, skelStaff: 1.8 };

export class WaveManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.reset();
  }

  reset() {
    this.wave = 0;
    this.queue = [];
    this.spawnTimer = 0;
    this.breakTimer = 2.0;
    this.state = 'break';
    this.spawnedThisWave = 0;
    this.totalThisWave = 0;
  }

  /**
   * 웨이브 1~4 는 몹을 한 종류씩 소개하고, 5부터 넷을 섞는다.
   * 5의 배수 웨이브에는 보스가 얹힌다 (즉 5웨이브 = 첫 혼합 + 첫 보스).
   */
  compose(w) {
    const list = [];
    let left = 5 + w * 2.6;

    if (w % 5 === 0) list.push('boss');

    const pool = w <= INTRO.length ? [INTRO[w - 1]] : INTRO;
    let guard = 0;
    while (left > 0.8 && guard++ < 200) {
      const t = pool[randInt(0, pool.length - 1)];
      if (COST[t] > left + 0.4) continue;
      list.push(t);
      left -= COST[t];
    }
    return list;
  }

  start(w) {
    this.wave = w;
    this.queue = this.compose(w);
    this.totalThisWave = this.queue.length;
    this.spawnedThisWave = 0;
    this.spawnTimer = 0;
    this.state = 'spawning';
    this.ctx.onWaveStart(w, this.queue.length);
  }

  update(dt, enemies) {
    if (this.state === 'break') {
      this.breakTimer -= dt;
      if (this.breakTimer <= 0) this.start(this.wave + 1);
      return;
    }

    if (this.queue.length) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        const t = this.queue.shift();
        this.spawnTimer = t === 'boss' ? 1.2 : rand(0.18, 0.45);
        this.ctx.spawn(t, this.wave);
        this.spawnedThisWave++;
      }
    } else if (enemies.length === 0) {
      this.state = 'break';
      this.breakTimer = 4.0;
      this.ctx.onWaveClear(this.wave);
    }
  }
}
