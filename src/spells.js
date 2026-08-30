import * as THREE from 'three';
import { rand, clamp, TAU, dist2D } from './utils.js';
import { ARENA_RADIUS } from './world.js';

/** HUD와 입력에 쓰이는 마법 정의 */
export const SPELLS = [
  { id: 'fire',   name: '화염구',     key: 'LMB', glyph: '🔥', mana: 8,  cd: 0.40, color: '#ff9a4a' },
  { id: 'frost',  name: '서리 폭발',  key: 'RMB', glyph: '❄️', mana: 26, cd: 5.5,  color: '#7fe6ff' },
  { id: 'chain',  name: '연쇄 번개',  key: 'E',   glyph: '⚡', mana: 30, cd: 4.0,  color: '#c9b3ff' },
  { id: 'meteor', name: '메테오',     key: 'R',   glyph: '☄️', mana: 60, cd: 14.0, color: '#ff6a3c' },
  { id: 'blink',  name: '점멸',       key: 'SPC', glyph: '💨', mana: 12, cd: 3.0,  color: '#a0ffe0' }
];

const CRIT_CHANCE = 0.16;

export class SpellSystem {
  constructor(ctx) {
    this.ctx = ctx;                 // { scene, fx, lights, player, enemies, damageEnemy, audio, shake }
    this.scene = ctx.scene;
    this.lights = ctx.lights;
    this.cool = {};
    SPELLS.forEach(s => this.cool[s.id] = 0);

    this.projectiles = [];
    this.meteors = [];
    this.enemyBolts = [];
    this.temps = [];
    this.lightFades = [];           // 제자리에서 잦아드는 풀 라이트

    // 공유 지오메트리
    this.gFire = new THREE.SphereGeometry(0.3, 12, 10);
    this.gBolt = new THREE.SphereGeometry(0.22, 10, 8);
    this.gSpike = new THREE.ConeGeometry(0.28, 1.5, 5);
    this.gMeteor = new THREE.IcosahedronGeometry(0.85, 1);
  }

  cdFor(id) {
    const s = SPELLS.find(x => x.id === id);
    return s.cd * this.ctx.player.stats.cdr * (id === 'blink' ? 1 : 1);
  }

  ready(id) { return this.cool[id] <= 0; }
  cdRatio(id) { return clamp(this.cool[id] / this.cdFor(id), 0, 1); }

  tryCast(id, aim) {
    const p = this.ctx.player;
    const def = SPELLS.find(s => s.id === id);
    if (this.cool[id] > 0) return false;
    if (p.mp < def.mana) {
      if (!this._noManaAt || performance.now() - this._noManaAt > 450) {
        this._noManaAt = performance.now();
        this.ctx.audio.play('nomana');
      }
      return false;
    }
    p.spendMana(def.mana);
    this.cool[id] = this.cdFor(id);
    switch (id) {
      case 'fire': this.fireball(aim); break;
      case 'frost': this.frostNova(); break;
      case 'chain': this.chainLightning(); break;
      case 'meteor': this.meteorStorm(aim); break;
      case 'blink': this.blink(aim); break;
    }
    p.cast(id);
    return true;
  }

  /* ---------------- 화염구 ---------------- */
  fireball(aim) {
    const p = this.ctx.player;
    const from = p.tipWorld ? p.tipWorld.clone() : p.pos.clone().setY(1.4);
    const dir = new THREE.Vector3(aim.x - from.x, 0.85 - from.y, aim.z - from.z).normalize();
    const extra = p.stats.fireExtra;
    const spread = extra > 0 ? 0.14 : 0;

    for (let i = 0; i <= extra; i++) {
      const d = dir.clone();
      if (extra > 0) d.applyAxisAngle(new THREE.Vector3(0, 1, 0), (i - extra / 2) * spread * 2);
      const mesh = new THREE.Mesh(this.gFire, new THREE.MeshBasicMaterial({ color: 0xffb057 }));
      mesh.position.copy(from);
      mesh.scale.setScalar(1.15);
      this.scene.add(mesh);
      this.projectiles.push({
        mesh, light: this.lights.acquire(0xff7a2a, 14, 12, 1), dir: d, speed: 30, life: 2.2,
        dmg: 26 * p.stats.dmg, radius: 3.2, hit: new Set(), pierce: p.stats.pierce
      });
    }
    this.ctx.audio.play('fire');
    this.ctx.fx.particles.emit(14, {
      origin: from, color: 0xff8a3c, color2: 0xffd166, dir, cone: 1.1,
      speed: [2, 7], size: [0.24, 0], life: [0.2, 0.4], drag: 4
    });
  }

  /* ---------------- 서리 폭발 ---------------- */
  frostNova() {
    const p = this.ctx.player;
    const R = 9 * p.stats.novaRadius;
    const origin = p.pos.clone();

    this.ctx.fx.rings.spawn(origin, { color: 0x7fe6ff, radius: R, life: 0.55, y: 0.08 });
    this.ctx.fx.rings.spawn(origin, { color: 0xbdf0ff, radius: R * 0.62, life: 0.32, y: 0.1 });
    this.ctx.fx.particles.emit(120, {
      origin: origin.clone().setY(0.7), color: 0x9beeff, color2: 0xffffff,
      speed: [6, 16], size: [0.3, 0], life: [0.4, 0.8], gravity: 3, drag: 2.4, spread: 0.5
    });
    this.ctx.audio.play('frost');
    this.ctx.shake.add(0.22);

    // 얼음 가시
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + rand(-0.1, 0.1);
      const r = rand(R * 0.25, R * 0.92);
      const m = new THREE.Mesh(this.gSpike, new THREE.MeshStandardMaterial({
        color: 0xa8e9ff, emissive: 0x2f9fd0, emissiveIntensity: 1.6,
        transparent: true, opacity: 0.85, roughness: 0.2, flatShading: true
      }));
      m.position.set(origin.x + Math.cos(a) * r, -1.2, origin.z + Math.sin(a) * r);
      m.rotation.set(rand(-0.2, 0.2), rand(0, TAU), rand(-0.2, 0.2));
      m.scale.setScalar(rand(0.7, 1.4));
      this.scene.add(m);
      this.addTemp(m, 1.5, (mesh, t, k) => {
        mesh.position.y = -1.2 + Math.min(1, t / 0.14) * 1.4;
        mesh.material.opacity = 0.85 * (1 - Math.pow(k, 3));
      });
    }

    this.fadeLight(this.lights.acquire(0x8fe8ff, 60, 26, 3), origin.clone().setY(1.5), 60, 0.5);

    for (const e of this.ctx.enemies.slice()) {
      if (!e.alive) continue;
      const d = dist2D(e.pos, origin);
      if (d <= R + e.radius) {
        this.ctx.damageEnemy(e, 24 * p.stats.dmg, origin, {
          slow: { time: 3.2, mul: 0.42 }, knock: 0.8, element: 'frost'
        });
      }
    }
  }

  /* ---------------- 연쇄 번개 ---------------- */
  chainLightning() {
    const p = this.ctx.player;
    const maxTargets = 4 + p.stats.chainExtra;
    const from = p.tipWorld ? p.tipWorld.clone() : p.pos.clone().setY(1.5);

    let src = from;
    const hit = new Set();
    let dmg = 48 * p.stats.dmg;
    let found = 0;

    for (let i = 0; i < maxTargets; i++) {
      let best = null, bestD = i === 0 ? 24 : 12;
      for (const e of this.ctx.enemies.slice()) {
        if (!e.alive || hit.has(e.id)) continue;
        const d = src.distanceTo(e.center());
        if (d < bestD) { bestD = d; best = e; }
      }
      if (!best) break;
      hit.add(best.id);
      found++;
      const to = best.center();
      this.ctx.fx.bolts.spawn(src, to, { color: i === 0 ? 0xdff0ff : 0xb9a6ff, width: 0.055 - i * 0.006, jitter: 0.55 });
      this.ctx.fx.particles.emit(18, {
        origin: to, color: 0xc9b3ff, color2: 0xffffff,
        speed: [2, 7], size: [0.18, 0], life: [0.2, 0.45], drag: 3
      });
      this.ctx.damageEnemy(best, dmg, src, { slow: { time: 0.8, mul: 0.6 }, knock: 0.4, element: 'chain' });
      dmg *= 0.82;
      src = to;

      this.fadeLight(this.lights.acquire(0xb9a6ff, 26, 14, 1), to, 26, 0.25, true);
    }

    this.ctx.audio.play('zap');
    if (found === 0) {
      // 빗나감: 앞쪽 허공으로 방전
      const dir = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      this.ctx.fx.bolts.spawn(from, from.clone().addScaledVector(dir, 10).setY(0.9), { color: 0xb9a6ff, width: 0.05, jitter: 0.5 });
    }
  }

  /* ---------------- 메테오 ---------------- */
  meteorStorm(aim) {
    const p = this.ctx.player;
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), r = i === 0 ? 0 : rand(1.5, 7);
      const target = new THREE.Vector3(aim.x + Math.cos(a) * r, 0, aim.z + Math.sin(a) * r);
      const rr = Math.hypot(target.x, target.z);
      if (rr > ARENA_RADIUS - 1) target.multiplyScalar((ARENA_RADIUS - 1) / rr);
      this.meteors.push({ target, delay: 0.25 + i * 0.32, warn: null, mesh: null, t: 0, dmg: 78 * p.stats.dmg });
    }
    this.ctx.audio.play('meteor');
  }

  /* ---------------- 점멸 ---------------- */
  blink(aim) {
    const p = this.ctx.player;
    const dir = new THREE.Vector3(aim.x - p.pos.x, 0, aim.z - p.pos.z);
    if (dir.lengthSq() < 0.01) dir.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    dir.normalize();
    const from = p.pos.clone();
    const dest = from.clone().addScaledVector(dir, 8);
    const r = Math.hypot(dest.x, dest.z);
    if (r > ARENA_RADIUS - 1.6) dest.multiplyScalar((ARENA_RADIUS - 1.6) / r);

    for (const pt of [from, dest]) {
      this.ctx.fx.particles.emit(40, {
        origin: pt.clone().setY(1), color: 0x9effe0, color2: 0xffffff,
        speed: [1, 7], size: [0.25, 0], life: [0.25, 0.6], drag: 3, spread: 0.5
      });
      this.ctx.fx.rings.spawn(pt, { color: 0x9effe0, radius: 2.2, life: 0.4 });
    }
    p.pos.copy(dest);
    p.invuln = Math.max(p.invuln, 0.35);
    this.ctx.audio.play('blink');
  }

  /* ---------------- 적 투사체 ---------------- */
  enemyShoot(enemy, player) {
    const from = enemy.muzzle();      // 지팡이 수정이 있으면 거기서 나간다
    const to = player.pos.clone().setY(1.1);
    const dir = to.sub(from).normalize();
    const isBoss = !!enemy.def.boss;
    const color = isBoss ? 0xff2d55 : 0xb28cff;
    const mesh = new THREE.Mesh(this.gBolt, new THREE.MeshBasicMaterial({ color }));
    mesh.position.copy(from);
    mesh.scale.setScalar(isBoss ? 1.7 : 1);
    this.scene.add(mesh);
    this.enemyBolts.push({
      mesh, light: this.lights.acquire(color, 8, 8, 0), dir, speed: enemy.def.boltSpeed, life: 3.5,
      dmg: enemy.dmg * (isBoss ? 0.8 : 1), color
    });
    this.ctx.audio.play('zap');
  }

  addTemp(obj, life, fn) { this.temps.push({ obj, life, t: 0, fn }); }

  /** 한 자리에 고정해 두고 잦아드는 라이트. flicker=true 면 지글거린다. */
  fadeLight(h, pos, peak, life, flicker = false) {
    h.at(pos);
    this.lightFades.push({ h, peak, life, t: 0, flicker });
  }

  /* ---------------- 갱신 ---------------- */
  update(dt) {
    for (const id in this.cool) this.cool[id] = Math.max(0, this.cool[id] - dt);

    this._updateProjectiles(dt);
    this._updateMeteors(dt);
    this._updateEnemyBolts(dt);

    for (let i = this.lightFades.length - 1; i >= 0; i--) {
      const f = this.lightFades[i];
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) { f.h.release(); this.lightFades.splice(i, 1); continue; }
      f.h.set(f.peak * (1 - k) * (f.flicker ? Math.random() * 0.5 + 0.5 : 1));
    }

    for (let i = this.temps.length - 1; i >= 0; i--) {
      const t = this.temps[i];
      t.t += dt;
      const k = t.t / t.life;
      if (k >= 1) {
        this.scene.remove(t.obj);
        if (t.obj.isMesh) t.obj.material.dispose();
        this.temps.splice(i, 1);
        continue;
      }
      t.fn(t.obj, t.t, k);
    }
  }

  _updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.dir, p.speed * dt);
      p.mesh.rotation.x += dt * 6; p.mesh.rotation.y += dt * 4;
      p.light.at(p.mesh.position).set(12 + Math.sin(performance.now() * 0.02) * 3);

      this.ctx.fx.particles.emit(2, {
        origin: p.mesh.position, color: 0xff7a2a, color2: 0xffd166,
        speed: [0.4, 1.6], size: [0.26, 0], life: [0.18, 0.36], drag: 4, spread: 0.12
      });

      let boom = false;
      const near = this.ctx.grid.near(p.mesh.position, 4);
      for (const e of near) {
        if (!e.alive || p.hit.has(e.id)) continue;
        if (p.mesh.position.distanceTo(e.center()) < e.radius + 0.55) {
          p.hit.add(e.id);
          boom = true;
          break;
        }
      }
      const r = Math.hypot(p.mesh.position.x, p.mesh.position.z);
      if (r > ARENA_RADIUS + 1 || p.mesh.position.y < 0.1) boom = true;
      if (p.life <= 0) boom = true;

      if (boom) {
        this.explode(p.mesh.position.clone(), p.dmg, p.radius);
        if (p.pierce > 0 && p.life > 0) {
          p.pierce--;
          continue;      // 관통: 계속 날아감
        }
        this.scene.remove(p.mesh);
        p.mesh.material.dispose();
        p.light.release();
        this.projectiles.splice(i, 1);
      }
    }
  }

  explode(pos, dmg, radius, opts = {}) {
    const color = opts.color ?? 0xff7a2a;
    this.ctx.fx.rings.spawn(pos.clone().setY(0), { color, radius, life: 0.45 });
    this.ctx.fx.particles.emit(50, {
      origin: pos, color, color2: 0xffe08a,
      speed: [4, 14], size: [0.42, 0], life: [0.3, 0.7], gravity: 4, drag: 3, spread: 0.3
    });
    this.fadeLight(this.lights.acquire(color, 90, 22, 3), pos, 90, 0.3);

    this.ctx.audio.play('boom');
    this.ctx.shake.add(opts.shake ?? 0.16);

    for (const e of this.ctx.enemies.slice()) {
      if (!e.alive) continue;
      const d = dist2D(e.pos, pos);
      if (d <= radius + e.radius) {
        const falloff = clamp(1 - (d / (radius + e.radius)) * 0.45, 0.5, 1);
        this.ctx.damageEnemy(e, dmg * falloff, pos, {
          knock: 1, burn: { time: 2.5, dps: dmg * 0.12 }, element: 'fire'
        });
      }
    }
  }

  _updateMeteors(dt) {
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.delay -= dt;
      if (m.delay > 0) continue;

      if (!m.mesh) {
        // 낙하 경고 표식
        const warn = new THREE.Mesh(
          new THREE.RingGeometry(4.2, 4.8, 40),
          new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
        );
        warn.rotation.x = -Math.PI / 2;
        warn.position.copy(m.target).setY(0.07);
        this.scene.add(warn);
        m.warn = warn;
        this.addTemp(warn, 0.75, (o, t, k) => { o.material.opacity = 0.35 + Math.abs(Math.sin(t * 18)) * 0.55; });

        const mesh = new THREE.Mesh(this.gMeteor, new THREE.MeshStandardMaterial({
          color: 0x4a1c0c, emissive: 0xff5a1e, emissiveIntensity: 2.6, roughness: 0.9, flatShading: true
        }));
        mesh.position.copy(m.target).setY(34);
        this.scene.add(mesh);
        m.mesh = mesh;
        m.light = this.lights.acquire(0xff6a2a, 40, 24, 2);
        m.t = 0;
      }

      m.t += dt;
      const k = clamp(m.t / 0.62, 0, 1);
      m.mesh.position.y = 34 * (1 - k * k) + 1.2;
      m.mesh.rotation.x += dt * 5; m.mesh.rotation.z += dt * 3;
      m.light.at(m.mesh.position);
      this.ctx.fx.particles.emit(6, {
        origin: m.mesh.position, color: 0xff8a3c, color2: 0xffd166,
        speed: [1, 4], size: [0.7, 0], life: [0.3, 0.6], drag: 2, spread: 0.6
      });

      if (k >= 1) {
        this.explode(m.target.clone().setY(0.6), m.dmg, 6.2, { shake: 0.5 });
        this.ctx.fx.particles.emit(60, {
          origin: m.target.clone().setY(0.6), color: 0x552211, color2: 0xff9a4a,
          speed: [3, 12], size: [0.5, 0], life: [0.5, 1.1], gravity: 9, drag: 1.5
        });
        this.scene.remove(m.mesh);
        m.mesh.material.dispose();
        m.light.release();
        this.meteors.splice(i, 1);
      }
    }
  }

  _updateEnemyBolts(dt) {
    const p = this.ctx.player;
    for (let i = this.enemyBolts.length - 1; i >= 0; i--) {
      const b = this.enemyBolts[i];
      b.life -= dt;
      b.mesh.position.addScaledVector(b.dir, b.speed * dt);
      b.light.at(b.mesh.position);
      this.ctx.fx.particles.emit(1, {
        origin: b.mesh.position, color: b.color,
        speed: [0.2, 1], size: [0.2, 0], life: [0.15, 0.3], drag: 3, spread: 0.08
      });

      let done = b.life <= 0;
      const dp = b.mesh.position.distanceTo(p.pos.clone().setY(1.05));
      if (dp < 1.0) {
        if (p.damage(b.dmg)) this.ctx.onPlayerHurt(b.dmg);
        this.ctx.fx.particles.emit(24, {
          origin: b.mesh.position, color: b.color, color2: 0xffffff,
          speed: [2, 7], size: [0.24, 0], life: [0.2, 0.5], drag: 3
        });
        done = true;
      }
      if (Math.hypot(b.mesh.position.x, b.mesh.position.z) > ARENA_RADIUS + 3) done = true;

      if (done) {
        this.scene.remove(b.mesh);
        b.mesh.material.dispose();
        b.light.release();
        this.enemyBolts.splice(i, 1);
      }
    }
  }

  clear() {
    [...this.projectiles, ...this.enemyBolts].forEach(o => {
      this.scene.remove(o.mesh); o.mesh.material.dispose(); o.light.release();
    });
    this.meteors.forEach(m => {
      if (m.mesh) { this.scene.remove(m.mesh); m.mesh.material.dispose(); }
      if (m.light) m.light.release();
    });
    this.temps.forEach(t => this.scene.remove(t.obj));
    this.lightFades.forEach(f => f.h.release());
    this.projectiles = []; this.enemyBolts = []; this.meteors = []; this.temps = []; this.lightFades = [];
    for (const id in this.cool) this.cool[id] = 0;
  }

  isCrit() { return Math.random() < CRIT_CHANCE; }
}
