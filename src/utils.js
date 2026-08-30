import * as THREE from 'three';

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const TAU = Math.PI * 2;

/** 프레임 독립적인 감쇠 보간 (dt 기반) */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/** XZ 평면 거리 */
export function dist2D(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

/** 재사용 임시 벡터 (GC 최소화) */
export const tmpV1 = new THREE.Vector3();
export const tmpV2 = new THREE.Vector3();
export const tmpV3 = new THREE.Vector3();

/** 원판 위 랜덤 위치 */
export function randomOnCircle(radius, y = 0) {
  const a = Math.random() * TAU;
  return new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius);
}

/** 간단한 오브젝트 풀 */
export class Pool {
  constructor(factory, reset) {
    this.factory = factory; this.reset = reset;
    this.free = []; this.active = [];
  }
  get() {
    const o = this.free.pop() || this.factory();
    this.active.push(o);
    return o;
  }
  release(o) {
    const i = this.active.indexOf(o);
    if (i >= 0) this.active.splice(i, 1);
    this.reset && this.reset(o);
    this.free.push(o);
  }
}
