import * as THREE from 'three';
import { rand, clamp, TAU, tmpV1 } from './utils.js';

const MAX_PARTICLES = 7000;

/** GPU 포인트 기반 파티클 (CPU 업데이트, 가산 합성) */
export class Particles {
  constructor(scene) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX_PARTICLES * 3);
    this.col = new Float32Array(MAX_PARTICLES * 3);
    this.att = new Float32Array(MAX_PARTICLES * 2); // size, alpha
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aAttr', new THREE.BufferAttribute(this.att, 2));
    g.setDrawRange(0, 0);

    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uPix: { value: innerHeight * 0.5 } },
      vertexShader: [
        'attribute vec3 aColor; attribute vec2 aAttr;',
        'varying vec3 vColor; varying float vAlpha;',
        'uniform float uPix;',
        'void main(){',
        '  vColor = aColor; vAlpha = aAttr.y;',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  gl_PointSize = aAttr.x * uPix / max(0.001, -mv.z);',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'varying vec3 vColor; varying float vAlpha;',
        'void main(){',
        '  float d = length(gl_PointCoord - 0.5);',
        '  float a = smoothstep(0.5, 0.06, d);',
        '  gl_FragColor = vec4(vColor, a * vAlpha);',
        '}'
      ].join('\n')
    });

    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.geo = g; this.mat = mat;

    // CPU 상태
    this.n = 0;
    this.vel = new Float32Array(MAX_PARTICLES * 3);
    this.life = new Float32Array(MAX_PARTICLES);
    this.maxLife = new Float32Array(MAX_PARTICLES);
    this.size0 = new Float32Array(MAX_PARTICLES);
    this.size1 = new Float32Array(MAX_PARTICLES);
    this.grav = new Float32Array(MAX_PARTICLES);
    this.drag = new Float32Array(MAX_PARTICLES);
    this._c = new THREE.Color();
    this._t1 = new THREE.Vector3();
    this._t2 = new THREE.Vector3();
    this._up = new THREE.Vector3();
  }

  resize() { this.mat.uniforms.uPix.value = innerHeight * 0.5; }

  emit(count, o) {
    const {
      origin, color = 0xffffff, color2 = null,
      speed = [2, 6], size = [0.3, 0], life = [0.4, 0.9],
      spread = 0.15, dir = null, gravity = 0, drag = 2, cone = Math.PI
    } = o;

    for (let k = 0; k < count; k++) {
      if (this.n >= MAX_PARTICLES) break;
      const i = this.n++;
      const i3 = i * 3;

      this.pos[i3] = origin.x + rand(-spread, spread);
      this.pos[i3 + 1] = origin.y + rand(-spread, spread);
      this.pos[i3 + 2] = origin.z + rand(-spread, spread);

      const sp = rand(speed[0], speed[1]);
      let vx, vy, vz;
      if (dir) {
        // dir 축을 중심으로 한 원뿔 분포
        const a = Math.random() * TAU;
        const r = Math.tan(Math.min(1.5, cone * 0.5)) * Math.random();
        tmpV1.copy(dir).normalize();
        this._up.set(0, 1, 0);
        if (Math.abs(tmpV1.y) > 0.9) this._up.set(1, 0, 0);
        this._t1.crossVectors(tmpV1, this._up).normalize();
        this._t2.crossVectors(tmpV1, this._t1);
        const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
        vx = (tmpV1.x + this._t1.x * ca + this._t2.x * sa) * sp;
        vy = (tmpV1.y + this._t1.y * ca + this._t2.y * sa) * sp;
        vz = (tmpV1.z + this._t1.z * ca + this._t2.z * sa) * sp;
      } else {
        const th = Math.random() * TAU, ph = Math.acos(rand(-1, 1));
        vx = Math.sin(ph) * Math.cos(th) * sp;
        vy = Math.cos(ph) * sp;
        vz = Math.sin(ph) * Math.sin(th) * sp;
      }
      this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;

      const c = this._c.set(color2 !== null && Math.random() < 0.5 ? color2 : color);
      this.col[i3] = c.r; this.col[i3 + 1] = c.g; this.col[i3 + 2] = c.b;

      const lf = rand(life[0], life[1]);
      this.life[i] = lf; this.maxLife[i] = lf;
      this.size0[i] = size[0]; this.size1[i] = size[1];
      this.grav[i] = gravity; this.drag[i] = drag;
      this.att[i * 2] = size[0]; this.att[i * 2 + 1] = 1;
    }
  }

  update(dt) {
    for (let i = this.n - 1; i >= 0; i--) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this._swapRemove(i); continue; }
      const i3 = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= d;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d - this.grav[i] * dt;
      this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;

      const t = 1 - this.life[i] / this.maxLife[i];
      this.att[i * 2] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      this.att[i * 2 + 1] = clamp(1 - t * t, 0, 1);
    }
    this.geo.setDrawRange(0, this.n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aAttr.needsUpdate = true;
  }

  _swapRemove(i) {
    const last = --this.n;
    if (i !== last) {
      const a = i * 3, b = last * 3;
      for (let k = 0; k < 3; k++) {
        this.pos[a + k] = this.pos[b + k];
        this.col[a + k] = this.col[b + k];
        this.vel[a + k] = this.vel[b + k];
      }
      this.att[i * 2] = this.att[last * 2];
      this.att[i * 2 + 1] = this.att[last * 2 + 1];
      this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last];
      this.size0[i] = this.size0[last]; this.size1[i] = this.size1[last];
      this.grav[i] = this.grav[last]; this.drag[i] = this.drag[last];
    }
  }
}

/** 바닥에 퍼지는 충격파 링 */
export class Rings {
  constructor(scene) {
    this.scene = scene;
    this.geo = new THREE.RingGeometry(0.86, 1, 48);
    this.items = [];
    this.pool = [];
  }
  spawn(pos, { color = 0xff8844, radius = 4, life = 0.5, y = 0.06, tilt = -Math.PI / 2 } = {}) {
    let m = this.pool.pop();
    if (!m) {
      m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      }));
      m.renderOrder = 4;
    }
    m.material.color.set(color);
    m.material.opacity = 1;
    m.position.set(pos.x, pos.y + y, pos.z);
    m.rotation.set(tilt, 0, 0);
    m.scale.setScalar(0.3);
    m.visible = true;
    this.scene.add(m);
    this.items.push({ m, t: 0, life, radius });
    return m;
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = it.t / it.life;
      if (k >= 1) {
        this.scene.remove(it.m);
        this.pool.push(it.m);
        this.items.splice(i, 1);
        continue;
      }
      const e = 1 - Math.pow(1 - k, 3);
      it.m.scale.setScalar(0.3 + it.radius * e);
      it.m.material.opacity = (1 - k) * 0.7;
    }
  }
}

/** 번개 다발 (지글거리는 튜브, 짧게 명멸) */
export class Bolts {
  constructor(scene) { this.scene = scene; this.items = []; }
  spawn(a, b, { color = 0x8fd8ff, width = 0.13, life = 0.22, jitter = 0.9 } = {}) {
    const pts = [];
    const seg = 9;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const p = new THREE.Vector3().lerpVectors(a, b, t);
      if (i > 0 && i < seg) {
        p.x += rand(-jitter, jitter);
        p.y += rand(-jitter * 0.6, jitter * 0.6);
        p.z += rand(-jitter, jitter);
      }
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, 26, width, 5, false);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 6;
    this.scene.add(m);
    this.items.push({ m, t: 0, life });
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = it.t / it.life;
      if (k >= 1) {
        this.scene.remove(it.m);
        it.m.geometry.dispose(); it.m.material.dispose();
        this.items.splice(i, 1);
        continue;
      }
      it.m.material.opacity = (1 - k) * (0.6 + Math.random() * 0.4);
    }
  }
}

/** 월드 좌표에 떠오르는 데미지 숫자 (DOM) */
export class FloatingText {
  constructor(layer, camera) {
    this.layer = layer; this.camera = camera;
    this.items = []; this.pool = [];
  }
  spawn(worldPos, text, cls = '') {
    const el = this.pool.pop() || document.createElement('div');
    el.className = 'dmg ' + cls;
    el.textContent = text;
    this.layer.appendChild(el);
    this.items.push({
      el, t: 0, life: 0.95,
      p: worldPos.clone().add(new THREE.Vector3(rand(-0.3, 0.3), rand(0, 0.4), rand(-0.3, 0.3))),
      vy: 2.4, vx: rand(-0.8, 0.8)
    });
  }
  update() {
    const dt = 1 / 60;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      if (it.t >= it.life) {
        this.layer.removeChild(it.el); this.pool.push(it.el);
        this.items.splice(i, 1); continue;
      }
      it.p.y += it.vy * dt; it.vy -= 3.2 * dt;
      it.p.x += it.vx * dt;
      tmpV1.copy(it.p).project(this.camera);
      const x = (tmpV1.x * 0.5 + 0.5) * innerWidth;
      const y = (-tmpV1.y * 0.5 + 0.5) * innerHeight;
      const k = it.t / it.life;
      it.el.style.transform = 'translate(-50%,-50%) translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + (1 + (1 - k) * 0.25).toFixed(2) + ')';
      it.el.style.opacity = tmpV1.z > 1 ? 0 : (1 - k * k);
    }
  }
}

/** 카메라 흔들림 */
export class Shake {
  constructor() { this.amount = 0; }
  add(a) { this.amount = Math.min(1.4, this.amount + a); }
  update(dt) {
    this.amount = Math.max(0, this.amount - dt * 2.2);
    const a = this.amount * this.amount;
    return { x: rand(-a, a) * 0.6, y: rand(-a, a) * 0.6, z: rand(-a, a) * 0.6 };
  }
}
