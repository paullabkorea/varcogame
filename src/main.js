import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { buildWorld, ARENA_RADIUS } from './world.js';
import { Player } from './player.js';
import { Enemy, Grid, WaveManager, TYPES, newTypeAt } from './enemies.js';
import { loadModels } from './models.js';
import { SpellSystem, SPELLS } from './spells.js';
import { Particles, Rings, Bolts, FloatingText, HealthBars, Shake } from './effects.js';
import { Input } from './input.js';
import { LightPool } from './lights.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { clamp, rand, damp, TAU, dist2D } from './utils.js';

/** 연속 처치가 끊기기까지 주어지는 시간(초) */
const COMBO_WINDOW = 2.8;

/** 구슬 색 — HUD 바 색과 맞춰 한눈에 종류를 읽게 한다 */
const ORB_COLOR = { xp: 0xffcc45, hp: 0x6bff9a, mp: 0x59b7ff };

/** 체력·마나 구슬이 바닥에 머무는 시간(초). 경험치 구슬은 사라지지 않는다. */
const ORB_LIFE = 20;

class Game {
  constructor() {
    this.canvas = document.getElementById('scene');
    this.ui = new UI();
    this.audio = new Audio();

    this._initRenderer();
    this._initScene();

    this.state = 'loading';
    this.enemies = [];
    this.orbs = [];
    this.grid = new Grid(6);
    this.time = 0;
    this.elapsed = 0;
    this.kills = 0;
    this.score = 0;
    this.pendingLevels = 0;
    this.zoom = 1;
    this.paused = false;

    this.combo = 0;        // 연속 처치 수
    this.comboT = 0;       // 연속이 끊길 때까지 남은 시간
    this.bestCombo = 0;
    this.hitStop = 0;      // 타격 순간의 짧은 정지 (타격감)

    Input.init(this.canvas);
    addEventListener('resize', () => this._resize());
  }

  _initRenderer() {
    // antialias 는 켜 봐야 낭비다 — EffectComposer 가 자체 렌더타겟에 그리기 때문에
    // 기본 프레임버퍼의 MSAA 는 한 번도 쓰이지 않고 메모리·대역폭만 먹는다.
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    // 블룸 비용이 해상도 제곱으로 붙어서 DPR 2 는 저사양 기기에서 프레임을 반토막 낸다.
    r.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.25;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.5, 600);
    this.camera.position.set(0, 16, 15);
    this.camera.lookAt(0, 1, 0);

    this.world = buildWorld(this.scene, this.renderer);

    // 마법·보스가 빌려 쓰는 포인트 라이트 (개수 고정 = 셰이더 재컴파일 없음)
    this.lights = new LightPool(this.scene, 6);

    // 포스트프로세싱 (마법 발광)
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.72, 0.5, 0.68);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // 이펙트
    this.fx = {
      particles: new Particles(this.scene),
      rings: new Rings(this.scene),
      bolts: new Bolts(this.scene),
      bars: new HealthBars(this.scene),
      text: new FloatingText(document.getElementById('dmgLayer'), this.camera)
    };
    this.shake = new Shake();

    // 조준 표식
    const ret = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.78, 32),
      new THREE.MeshBasicMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ret.add(ring);
    const inner = new THREE.Mesh(
      new THREE.RingGeometry(0.14, 0.2, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
    );
    inner.rotation.x = -Math.PI / 2;
    ret.add(inner);
    ret.position.y = 0.09;
    this.scene.add(ret);
    this.reticle = ret;
    this.reticleRing = ring;

    this.aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.05);
    this.raycaster = new THREE.Raycaster();
    this.aim = new THREE.Vector3(0, 1, 10);
  }

  async boot() {
    // 몹 GLB 4종을 먼저 굽는다 (지오메트리/텍스처를 몹 전체가 공유)
    await loadModels(k => this.ui.setProgress(k * 0.45, '어둠의 무리를 불러내는 중… ' + Math.round(k * 100) + '%'));

    this.player = new Player(this.scene);
    await this.player.load(k => this.ui.setProgress(0.45 + k * 0.53, '수호자를 깨우는 중… ' + Math.round(k * 100) + '%'));
    this.ui.setProgress(1, '각인 완료');

    this.spells = new SpellSystem(this._spellCtx());
    this.waves = new WaveManager(this._waveCtx());

    // 모든 몹·마법 이펙트를 로딩 화면 뒤에서 한 번씩 그려 셰이더를 미리 컴파일한다.
    // (안 하면 첫 시전 때 60~90ms 씩 프레임이 멈춘다)
    await this._warmup();

    setTimeout(() => {
      this.ui.hide('loading');
      this.ui.show('title');
      this.state = 'title';
    }, 250);

    document.getElementById('startBtn').onclick = () => this.startRun();
    document.getElementById('retryBtn').onclick = () => this.startRun();
    document.getElementById('resumeBtn').onclick = () => this.setPaused(false);
    document.getElementById('quitBtn').onclick = () => {
      this.setPaused(false);
      this.gameOver();
    };

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  /**
   * 셰이더 프리컴파일.
   *
   * three.js 는 재질을 **처음 그리는 순간** 셰이더를 컴파일한다. 그래서 몹이나
   * 마법이 처음 나올 때마다 수십~수백 ms 씩 프레임이 멈춘다. 여기서 모든 몹과
   * 마법 이펙트를 로딩 오버레이 뒤에서 한 번씩 실제로 그려 그 비용을 미리 치른다.
   *
   * 중요: 워밍업으로 만든 물체는 **dispose 하지 않고** 씬에서 빼기만 한다.
   *       재질을 dispose 하면 방금 구운 셰이더 프로그램도 같이 해제돼서 헛수고가 된다.
   *       (참조만 남겨 두면 프로그램 캐시가 유지되고, 나중에 같은 재질을 새로 만들어도
   *        캐시 키가 같아 재컴파일 없이 재사용된다.)
   */
  async _warmup() {
    this.ui.setProgress(0.99, '주문을 각인하는 중…');
    this._warm = [];

    const ectx = this._enemyCtx();
    const dummies = Object.keys(TYPES).map((type, i) => {
      const e = new Enemy(type, 1, ectx);
      e.pos.set(-12 + i * 3, 0, -9);
      return e;
    });

    const aim = new THREE.Vector3(0, 0, -10);
    this.spells.fireball(aim);
    this.spells.frostNova();
    this.spells.chainLightning();                    // 대상이 없으면 허공 방전 → 번개 튜브까지 굽는다
    this.spells.meteorStorm(aim);
    this.spells.explode(new THREE.Vector3(0, 0.6, -10), 1, 4);
    this.spells.enemyShoot(dummies.find(e => e.def.ranged), this.player);
    this.dropOrb(new THREE.Vector3(2, 0, -6), 'xp', 1);
    this.dropOrb(new THREE.Vector3(3, 0, -6), 'hp', 1);
    this.dropOrb(new THREE.Vector3(4, 0, -6), 'mp', 1);
    this.fx.rings.spawn(new THREE.Vector3(0, 0, -6), { radius: 3, life: 9 });
    this.fx.text.spawn(new THREE.Vector3(0, 2, -6), '0');

    // 체력바 셰이더도 여기서 한 번 굽는다 (인스턴스가 0이면 아예 안 그려져 컴파일도 안 된다)
    this.fx.bars.begin();
    this.fx.bars.add(0, 1.6, -6, 0.5, 1.2, 0x64e86e);
    this.fx.bars.end();

    // 메테오는 지연 후에 메시가 생기므로 몇 프레임 굴려야 다 나온다.
    for (let i = 0; i < 8; i++) {
      this.spells.update(0.12);
      for (const e of dummies) e.update(0.12, this.player, ectx);
      this.fx.particles.update(0.02);
      this.fx.rings.update(0.02);
      this.fx.bolts.update(0.02);
      this.world.update(i * 0.12);
      this.renderer.compile(this.scene, this.camera);
      this.composer.render();                        // 그림자·블룸 패스까지 함께 컴파일
      await this._yield();     // 로딩 화면이 얼어 보이지 않게 한 프레임 양보
    }

    // ---- 정리: 씬에서만 빼고 재질은 살려 둔다 ----
    for (const e of dummies) {
      this.scene.remove(e.obj);
      if (e.glowH) e.glowH.release();
      this._warm.push(e);
    }
    for (const o of [...this.spells.projectiles, ...this.spells.enemyBolts]) {
      this.scene.remove(o.mesh); o.light.release(); this._warm.push(o.mesh);
    }
    for (const m of this.spells.meteors) {
      if (m.mesh) { this.scene.remove(m.mesh); this._warm.push(m.mesh); }
      if (m.light) m.light.release();
    }
    for (const t of this.spells.temps) { this.scene.remove(t.obj); this._warm.push(t.obj); }
    for (const f of this.spells.lightFades) f.h.release();
    for (const b of this.fx.bolts.items) { this.scene.remove(b.m); this._warm.push(b.m); }
    this.fx.bolts.items.length = 0;
    for (const r of this.fx.rings.items) { this.scene.remove(r.m); this.fx.rings.pool.push(r.m); }
    this.fx.rings.items.length = 0;
    this.spells.projectiles = []; this.spells.enemyBolts = [];
    this.spells.meteors = []; this.spells.temps = []; this.spells.lightFades = [];
    for (const id in this.spells.cool) this.spells.cool[id] = 0;
    this.orbs.forEach(o => this.scene.remove(o.mesh));
    this.orbs.forEach(o => this._warm.push(o.mesh));
    this.orbs.length = 0;
    this.fx.particles.n = 0;
    this.fx.bars.begin(); this.fx.bars.end();
    this.fx.text.items.forEach(it => { this.fx.text.layer.removeChild(it.el); });
    this.fx.text.items.length = 0;
    this.player.reset();
  }

  /**
   * 한 프레임 양보. 백그라운드 탭에서는 requestAnimationFrame 이 아예 안 돌기 때문에
   * (탭을 새 탭으로 열어 두면 로딩이 영영 안 끝난다) 타이머와 경주시켜 반드시 깨어나게 한다.
   */
  _yield() {
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(resolve, 60);
      requestAnimationFrame(done);
    });
  }

  /* ---------------- 컨텍스트 ---------------- */
  _spellCtx() {
    return {
      scene: this.scene,
      fx: this.fx,
      lights: this.lights,
      audio: this.audio,
      shake: this.shake,
      grid: this.grid,
      get player() { return game.player; },
      get enemies() { return game.enemies; },
      damageEnemy: (e, amt, from, opts) => this.damageEnemy(e, amt, from, opts),
      onPlayerHurt: (dmg) => this.onPlayerHurt(dmg)
    };
  }

  _waveCtx() {
    return {
      spawn: (type, wave, elite) => this.spawnEnemy(type, wave, elite),
      onWaveStart: (w, n) => {
        const nt = newTypeAt(w);
        this.ui.banner('WAVE ' + w + ' — ' + (nt ? TYPES[nt].name : '혼성 무리'));
        this.audio.play('wave');
      },
      onWaveClear: (w) => {
        // 웨이브를 넘길 때마다 숨을 돌린다 — 체력·마나를 조금 채우고 보너스 점수
        const bonus = 30 * w;
        this.score += bonus;
        this.player.heal(this.player.maxHp * 0.12);
        this.player.restoreMana(this.player.maxMp * 0.35);
        this.ui.banner('제 ' + w + ' 파 격퇴\n+' + bonus);
      }
    };
  }

  _enemyCtx() {
    return {
      scene: this.scene,
      fx: this.fx,
      lights: this.lights,
      grid: this.grid,
      get time() { return game.time; },
      meleeHit: (e, dmg) => {
        if (this.player.damage(dmg)) {
          this.onPlayerHurt(dmg);
          this.fx.particles.emit(16, {
            origin: this.player.pos.clone().setY(1.1), color: 0xff4d5e, color2: 0xffaaaa,
            speed: [2, 6], size: [0.22, 0], life: [0.2, 0.45], drag: 3
          });
        }
      },
      enemyShoot: (e, p) => this.spells.enemyShoot(e, p),
      bossSummon: (e) => this.bossSummon(e),

      // 강타 예고 — 바닥에 붉은 고리를 띄워 "여기 맞는다"를 알린다
      telegraph: (e, reach) => {
        this.fx.rings.spawn(e.pos, { color: 0xff3a2a, radius: reach, life: e.def.windup, y: 0.05, warn: true });
        this.audio.play('windup');
      },
      onWhiff: (e) => {
        // 헛스윙 — 흙먼지만 튄다 (피했다는 걸 눈으로 확인시켜 준다)
        this.fx.particles.emit(18, {
          origin: e.pos.clone().setY(0.2), color: 0x6b5a45, color2: 0xa89070,
          speed: [2, 7], size: [0.34, 0], life: [0.3, 0.6], gravity: 7, drag: 2.5, spread: 0.5
        });
        this.shake.add(0.14);
      }
    };
  }

  /* ---------------- 런 시작/종료 ---------------- */
  startRun() {
    this.audio.start();
    this.ui.hide('title');
    this.ui.hide('gameover');
    this.ui.show('hud');

    this.enemies.forEach(e => e.dispose(this.scene));
    this.enemies.length = 0;
    this.orbs.forEach(o => {
      this.scene.remove(o.mesh);
      o.mesh.geometry.dispose();
      o.mesh.material.dispose();
    });
    this.orbs.length = 0;
    this.spells.clear();
    this.lights.releaseAll();

    this.player.reset();
    this.kills = 0; this.score = 0; this.elapsed = 0;
    this.combo = 0; this.comboT = 0; this.bestCombo = 0;
    this.hitStop = 0;
    this.pendingLevels = 0;
    this.paused = false;
    this.ui.hide('pause');
    this.ui.resetRunes();
    this.waves.reset();
    this.ui.flashHurt(0);
    this.state = 'play';
    this.ui.banner('제단 수호 개시');
  }

  setPaused(v) {
    this.paused = v;
    if (v) this.ui.show('pause'); else this.ui.hide('pause');
  }

  /** 아주 짧게 시간을 멈춘다 — 큰 타격이 "맞았다"고 느껴지게 하는 장치 */
  addHitStop(s) {
    this.hitStop = Math.min(0.11, Math.max(this.hitStop, s));
  }

  /** 연속 처치 배율 (점수에만 적용, 최대 3배) */
  comboMul() {
    return 1 + Math.min(this.combo, 40) * 0.05;
  }

  gameOver() {
    this.state = 'over';
    this.ui.hide('combo');
    this.audio.play('death');
    this.shake.add(0.9);
    this.fx.particles.emit(120, {
      origin: this.player.pos.clone().setY(1), color: 0x9a6bff, color2: 0xffffff,
      speed: [3, 12], size: [0.4, 0], life: [0.6, 1.4], drag: 1.6, gravity: 2
    });
    this.ui.showGameOver(this);
  }

  /* ---------------- 몹 ---------------- */
  spawnEnemy(type, wave, elite = false) {
    const e = new Enemy(type, wave, this._enemyCtx(), { elite });
    e.pos.copy(this._spawnPoint(type === 'boss' ? 20 : rand(17, 23)));
    this.enemies.push(e);

    // 소환 연출
    const color = type === 'boss' ? 0xff2d55 : e.elite ? 0xffb43c : 0x9a6bff;
    this.fx.rings.spawn(e.pos, { color, radius: e.radius * 3.2, life: 0.7 });
    this.fx.particles.emit(type === 'boss' ? 90 : e.elite ? 55 : 26, {
      origin: e.pos.clone().setY(0.4), color, color2: 0xffffff,
      speed: [1, 6], size: [0.3, 0], life: [0.35, 0.8], gravity: -3, drag: 2, spread: 0.6
    });
    if (type === 'boss') {
      this.ui.banner('심연의 군주, 강림');
      this.shake.add(0.7);
    }
    return e;
  }

  /**
   * 몹이 나타날 자리.
   *
   * 아레나 가장자리에 고정해서 뿌리면, 반대편 끝에 서 있을 때 몹이 화면 밖 저 멀리
   * 스폰돼 한참 걸어오고(지루) 가장자리에 붙어 있으면 코앞에서 튀어나온다(억울).
   * 그래서 **플레이어 기준 고리**에 뿌리되 아레나 안쪽으로만 밀어 넣는다.
   */
  _spawnPoint(dist) {
    const p = this.player.pos;
    const lim = ARENA_RADIUS - 2.5;
    for (let i = 0; i < 12; i++) {
      const a = rand(0, TAU);
      const x = p.x + Math.cos(a) * dist, z = p.z + Math.sin(a) * dist;
      if (Math.hypot(x, z) <= lim) return new THREE.Vector3(x, 0, z);
    }
    // 12번 굴려도 못 찾았으면(가장자리에 몰려 있을 때) 아레나 안쪽 방향으로 잡는다
    const a = Math.atan2(-p.z, -p.x) + rand(-1, 1);
    const v = new THREE.Vector3(p.x + Math.cos(a) * dist, 0, p.z + Math.sin(a) * dist);
    const r = Math.hypot(v.x, v.z);
    if (r > lim) v.multiplyScalar(lim / r);
    return v;
  }

  bossSummon(boss) {
    this.ui.banner('군주가 하수인을 불러낸다');
    for (let i = 0; i < 4; i++) {
      const e = new Enemy('imp', this.waves.wave, this._enemyCtx());
      const a = rand(0, TAU);
      e.pos.set(boss.pos.x + Math.cos(a) * 4, 0, boss.pos.z + Math.sin(a) * 4);
      this.enemies.push(e);
      this.fx.rings.spawn(e.pos, { color: 0xff5a3c, radius: 2.4, life: 0.6 });
    }
  }

  damageEnemy(e, amount, fromPos, opts = {}) {
    if (!e.alive) return;
    const crit = this.spells.isCrit();
    const dmg = Math.round(amount * (crit ? 2 : 1));
    e.hit(dmg, fromPos, opts);

    this.fx.text.spawn(e.center(), String(dmg), crit ? 'crit' : '');
    this.audio.play('hit');
    if (crit) {
      this.addHitStop(0.045);
      this.fx.particles.emit(10, {
        origin: e.center(), color: 0xffd257, color2: 0xffffff,
        speed: [3, 9], size: [0.22, 0], life: [0.15, 0.35], drag: 4
      });
    }

    const ls = this.player.stats.lifesteal;
    if (ls > 0 && this.player.hp < this.player.maxHp) this.player.heal(dmg * ls);

    if (e.hp <= 0) this.killEnemy(e);
  }

  killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    this.kills++;

    // 연속 처치: 창이 살아 있는 동안 계속 쌓이고, 점수 배율이 올라간다
    this.combo++;
    this.comboT = COMBO_WINDOW;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    this.score += Math.round(e.score * this.comboMul());
    if (this.combo > 1 && this.combo % 10 === 0) this.audio.play('combo');

    this.player.restoreMana(this.player.stats.manaOnKill);

    const c = e.center();
    const col = e.elite ? 0xffb43c : e.def.color;
    this.fx.particles.emit(e.def.boss ? 160 : e.elite ? 70 : 34, {
      origin: c, color: col, color2: 0xffffff,
      speed: [2, e.def.boss ? 16 : 9], size: [0.34, 0], life: [0.35, 0.9], gravity: 5, drag: 2.4
    });
    this.fx.rings.spawn(e.pos, { color: col, radius: e.radius * 3, life: 0.4 });
    this.audio.play('death');
    this.addHitStop(e.def.boss ? 0.11 : e.elite ? 0.06 : 0.03);
    if (e.def.boss) {
      this.shake.add(0.8);
      this.ui.banner('심연의 군주 격파');
      for (let i = 0; i < 6; i++) this.dropOrb(e.pos, 'hp', 25);
      for (let i = 0; i < 6; i++) this.dropOrb(e.pos, 'mp', 25);
    } else if (e.elite) {
      this.shake.add(0.24);
      this.dropOrb(e.pos, 'hp', 22);
      this.dropOrb(e.pos, 'mp', 22);
    }

    // 경험치 구슬
    const n = e.def.boss ? 10 : e.xp > 8 ? 3 : 1;
    for (let i = 0; i < n; i++) this.dropOrb(e.pos, 'xp', Math.ceil(e.xp / n));
    if (Math.random() < 0.09) this.dropOrb(e.pos, 'hp', 18);
    if (Math.random() < 0.16) this.dropOrb(e.pos, 'mp', 16);

    e.dispose(this.scene);
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
  }

  /* ---------------- 구슬 ---------------- */
  dropOrb(pos, kind, value) {
    if (value <= 0) return;
    // 색으로 종류를 읽는다 — 금빛 경험치 / 초록 체력 / 파랑 마나 (HUD 바 색과 같다)
    const color = ORB_COLOR[kind];
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(kind === 'xp' ? 0.17 : 0.24, 0),
      new THREE.MeshBasicMaterial({ color })
    );
    mesh.position.copy(pos).setY(0.9);
    this.scene.add(mesh);
    this.orbs.push({
      mesh, kind, value, t: 0,
      vel: new THREE.Vector3(rand(-3, 3), rand(3, 6), rand(-3, 3))
    });
  }

  /**
   * 구슬 갱신.
   *
   * 경험치는 **반드시** 손에 들어와야 한다. 예전엔 흡입 반경(14) 밖에 떨어진
   * 구슬이 영영 그 자리에 남아, 구석에 흘린 경험치를 주우러 되돌아가야 했고
   * 안 주우면 씬에 메시가 무한히 쌓였다. 이제는 잠깐 뒤부터 느리게 따라와서
   * 결국 다 회수된다. 반대로 체력·마나 구슬은 **지금 갈지 말지 고르는 자원**이라
   * 수명이 있고, 꺼지기 전에 반짝여서 사라질 걸 알려 준다.
   */
  _updateOrbs(dt) {
    const p = this.player.pos;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.t += dt;
      const m = o.mesh;
      m.rotation.y += dt * 3;

      // 체력·마나 구슬의 수명
      if (o.kind !== 'xp') {
        const left = ORB_LIFE - o.t;
        if (left <= 0) {
          this.scene.remove(m); m.geometry.dispose(); m.material.dispose();
          this.orbs.splice(i, 1);
          continue;
        }
        if (left < 3) m.visible = Math.sin(left * (12 - left * 2)) > -0.3;   // 마지막 3초 깜빡임
      }

      if (o.t < 0.45) {
        o.vel.y -= 16 * dt;
        m.position.addScaledVector(o.vel, dt);
        if (m.position.y < 0.4) { m.position.y = 0.4; o.vel.y *= -0.3; }
      } else {
        const d = dist2D(m.position, p);
        const pull = o.kind === 'xp' ? 14 : 5.5;
        if (d < pull) {
          const dir = new THREE.Vector3(p.x - m.position.x, 1.0 - m.position.y, p.z - m.position.z).normalize();
          m.position.addScaledVector(dir, (10 + (pull - d) * 2.2) * dt);
        } else if (o.kind === 'xp' && o.t > 1.5) {
          // 멀리 떨어진 경험치도 느릿느릿 쫓아온다 (흘린 경험치는 없다)
          const dir = new THREE.Vector3(p.x - m.position.x, 0.9 - m.position.y, p.z - m.position.z).normalize();
          m.position.addScaledVector(dir, 3.4 * dt);
        } else {
          m.position.y = 0.5 + Math.sin(this.time * 3 + i) * 0.12;
        }
        if (d < 1.0) {
          if (o.kind === 'xp') {
            const lv = this.player.addXp(o.value);
            if (lv > 0) this.pendingLevels += lv;
          } else if (o.kind === 'mp') {
            this.player.restoreMana(o.value);
            this.fx.text.spawn(p.clone().setY(2), '+' + o.value, 'mana');
          } else {
            this.player.heal(o.value);
            this.fx.text.spawn(p.clone().setY(2), '+' + o.value, 'heal');
          }
          this.audio.play('pickup');
          this.fx.particles.emit(8, {
            origin: m.position, color: ORB_COLOR[o.kind],
            speed: [1, 3], size: [0.16, 0], life: [0.2, 0.4], drag: 4
          });
          this.scene.remove(m); m.geometry.dispose(); m.material.dispose();
          this.orbs.splice(i, 1);
          continue;
        }
      }
    }
  }

  onPlayerHurt(dmg) {
    this.audio.play('hurt');
    this.shake.add(0.28);
    this.fx.text.spawn(this.player.pos.clone().setY(2.2), '-' + Math.round(dmg), 'player');
    if (!this.player.alive) this.gameOver();
  }

  /* ---------------- 입력 ---------------- */
  _readInput(dt) {
    const p = this.player;

    // 조준점: 화면 커서를 지면에 투사
    // (렌더 전이라 카메라 행렬이 한 프레임 뒤처질 수 있으므로 먼저 갱신)
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera({ x: Input.mouse.nx, y: Input.mouse.ny }, this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.aimPlane, hit)) this.aim.copy(hit);

    // 이동 (카메라 기준 = 월드 축 고정)
    const dir = new THREE.Vector3();
    if (Input.key('KeyW') || Input.key('ArrowUp')) dir.z -= 1;
    if (Input.key('KeyS') || Input.key('ArrowDown')) dir.z += 1;
    if (Input.key('KeyA') || Input.key('ArrowLeft')) dir.x -= 1;
    if (Input.key('KeyD') || Input.key('ArrowRight')) dir.x += 1;
    if (dir.lengthSq() > 0) dir.normalize();

    if (this.state === 'play') {
      if (Input.btn(0) || Input.key('Digit1')) this.spells.tryCast('fire', this.aim);
      if (Input.justBtn(2) || Input.justKey('Digit2')) this.spells.tryCast('frost', this.aim);
      if (Input.justKey('KeyE') || Input.justKey('Digit3')) this.spells.tryCast('chain', this.aim);
      if (Input.justKey('KeyR') || Input.justKey('Digit4')) this.spells.tryCast('meteor', this.aim);
      if (Input.justKey('Space')) this.spells.tryCast('blink', this.aim);
    }
    if (Input.justKey('KeyM')) {
      const m = this.audio.toggleMute();
      this.ui.banner(m ? '음향 차단' : '음향 복구');
    }
    if (Input.justKey('KeyP') || Input.justKey('Escape')) {
      // 룬 선택 중에는 못 멈춘다 (카드가 가려져 게임이 굳어 보인다)
      if (this.state === 'play' && this.pendingLevels <= 0) this.setPaused(!this.paused);
    }
    if (Input.wheel) this.zoom = clamp(this.zoom + Input.wheel * 0.12, 0.62, 1.6);

    return dir;
  }

  /* ---------------- 카메라 ---------------- */
  _updateCamera(dt) {
    const p = this.player.pos;
    const lead = this.state === 'play' ? 0.14 : 0;
    const tx = p.x + (this.aim.x - p.x) * lead;
    const tz = p.z + (this.aim.z - p.z) * lead;

    const z = this.zoom;
    const want = new THREE.Vector3(tx, 15.5 * z, tz + 14.5 * z);
    this.camera.position.lerp(want, 1 - Math.exp(-6 * dt));

    const look = new THREE.Vector3(tx, 1.2, tz - 1.5);
    if (!this._look) this._look = look.clone();
    this._look.lerp(look, 1 - Math.exp(-8 * dt));
    this.camera.lookAt(this._look);

    const s = this.shake.update(dt);
    this.camera.position.x += s.x; this.camera.position.y += s.y; this.camera.position.z += s.z;
  }

  /* ---------------- 프레임 ---------------- */
  _frame() {
    const raw = Math.min(0.05, this.clock.getDelta());

    // 히트스톱: 실제 흐른 시간만큼 타이머를 깎되, 게임 시간은 확 줄여 흘린다.
    // 아주 짧아서 "멈췄다"기보다 "묵직하게 걸린다"로 읽힌다.
    let dt = raw;
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - raw);
      dt = raw * 0.12;
    }
    this.time += dt;

    const moveDir = this._readInput(dt);
    const playing = this.state === 'play' && !this.paused && this.pendingLevels <= 0;

    if (playing) {
      this.elapsed += dt;

      if (this.combo > 0) {
        this.comboT -= dt;
        if (this.comboT <= 0) this.combo = 0;
      }

      this.player.update(dt, moveDir, this.aim, {
        time: this.time,
        aiming: Input.btn(0) || Input.key('Digit1')   // 조준 중이면 커서를 바라본다
      });
      this.grid.rebuild(this.enemies);

      const ectx = this._enemyCtx();
      for (const e of this.enemies.slice()) if (e.alive) e.update(dt, this.player, ectx);
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (e.hp <= 0 && !e.dead) this.killEnemy(e);
      }

      this.spells.update(dt);
      this.waves.update(dt, this.enemies);
      this._updateOrbs(dt);

      // 조준 표식
      this.reticle.position.set(this.aim.x, 0.09, this.aim.z);
      this.reticle.rotation.y += dt * 0.8;
      this.reticleRing.material.opacity = 0.55 + Math.sin(this.time * 5) * 0.15;

      // 피격 비네트 + 저체력 경고
      const lowHp = clamp(1 - this.player.hp / (this.player.maxHp * 0.35), 0, 1);
      const hurt = this.player.hurtFlash / 0.35;
      this.ui.flashHurt(Math.max(hurt * 0.85, lowHp * (0.35 + Math.sin(this.time * 6) * 0.12)));

      this.ui.update(this);
    } else if (this.state === 'title' || this.state === 'over') {
      // 타이틀/결과 화면에서도 캐릭터는 숨쉬기 애니메이션
      this.player && this.player.update(dt, new THREE.Vector3(), null, { time: this.time });
      this.reticle.visible = false;
    }

    if (this.state === 'play') this.reticle.visible = true;

    // 레벨업 카드 (일시정지 상태에서도 계속 열림)
    if (this.state === 'play' && this.pendingLevels > 0) this._openLevelUp();

    this.fx.particles.update(dt);
    this.fx.rings.update(dt);
    this.fx.bolts.update(dt);
    this.fx.text.update();
    this._updateBars();
    this.world.update(this.time);
    this._updateCamera(dt);

    this.composer.render();
    Input.endFrame();
  }

  /**
   * 몹 머리 위 체력바.
   * 멀쩡한 잡몹까지 다 띄우면 화면이 바 천지가 된다 — 맞은 적, 정예만 보여 준다.
   * (보스는 상단 전용 바가 따로 있다)
   */
  _updateBars() {
    const bars = this.fx.bars;
    bars.begin();
    if (this.state === 'play') {
      for (const e of this.enemies) {
        if (!e.alive || e.def.boss || e.spawnT > 0) continue;
        const hurt = e.hp < e.maxHp;
        if (!hurt && !e.elite) continue;
        const s = e.obj.scale.x;
        bars.add(
          // def.height 는 대략치다 — 실제 메시가 조금 더 높아서 1.15배로 띄운다
          e.pos.x, e.pos.y + e.def.height * s * 1.15 + 0.45, e.pos.z,
          e.hp / e.maxHp,
          clamp(e.radius * 1.7, 0.85, 2.4),
          e.elite ? 0xffb43c : 0x64e86e
        );
      }
    }
    bars.end();
  }

  _openLevelUp() {
    if (this._levelUpOpen) return;
    this._levelUpOpen = true;
    this.audio.play('levelup');
    this.fx.particles.emit(80, {
      origin: this.player.pos.clone().setY(1), color: 0xffd166, color2: 0xffffff,
      speed: [2, 8], size: [0.3, 0], life: [0.5, 1.1], gravity: -4, drag: 2
    });
    this.fx.rings.spawn(this.player.pos, { color: 0xffd166, radius: 4, life: 0.7 });
    this.ui.showLevelUp(u => {
      u.apply(this.player);
      this.ui.addRune(u);
      this.pendingLevels = Math.max(0, this.pendingLevels - 1);
      this._levelUpOpen = false;
      this.ui.banner(u.name);
    });
  }

  _resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
    this.bloom.setSize(innerWidth, innerHeight);
    this.fx.particles.resize();
  }
}

const game = new Game();
window.game = game;
window.Input = Input;   // 디버깅용
game.boot().catch(err => {
  console.error(err);
  document.getElementById('loadText').textContent = '불러오기에 실패했습니다 — ' + err.message;
});
