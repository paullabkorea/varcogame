import * as THREE from 'three';

/**
 * 포인트 라이트 풀.
 *
 * three.js 는 씬에 있는 포인트 라이트의 **개수를 셰이더 소스에 상수로 박아 넣는다.**
 * 그래서 마법마다 라이트를 씬에 넣었다 뺐다 하면, 개수가 바뀌는 순간
 * 씬의 모든 MeshStandardMaterial 이 한꺼번에 재컴파일되면서 프레임이 통째로 멈춘다.
 * (측정값: 첫 화염구 66ms · 첫 서리 폭발 92ms, 매번 셰이더 7개씩 새로 컴파일)
 *
 * 그래서 부팅 때 라이트를 정해진 개수만큼 만들어 씬에 **영구히** 붙여 두고,
 * 마법은 색·위치·세기만 빌려 쓴다. 개수가 절대 안 변하니 재컴파일이 없다.
 *
 * 주의: `visible = false` 로 끄면 개수 집계에서 빠져 버려서 원점으로 돌아간다.
 *       쉬는 라이트는 항상 visible 을 유지하고 intensity 만 0 으로 둔다.
 */

/** 빌린 라이트를 다루는 손잡이. 뺏겼으면 모든 조작이 조용히 무시된다. */
class LightHandle {
  constructor(slot, ticket) { this.slot = slot; this.ticket = ticket; }

  /** 아직 내 것인가 (다른 마법에 뺏기지 않았는가) */
  get alive() { return this.slot.ticket === this.ticket; }

  at(v) { if (this.alive) this.slot.light.position.copy(v); return this; }
  set(intensity) { if (this.alive) this.slot.light.intensity = intensity; return this; }
  color(c) { if (this.alive) this.slot.light.color.set(c); return this; }

  release() {
    if (!this.alive) return;
    this.slot.light.intensity = 0;
    this.slot.priority = -1;
    this.slot.ticket++;              // 남아 있는 손잡이를 모두 무효화
  }
}

/** 풀이 꽉 찼을 때 돌려주는 더미. 모든 호출이 no-op 이라 호출부에 null 검사가 필요 없다. */
const DEAD_SLOT = { light: new THREE.PointLight(0xffffff, 0, 1, 2), ticket: 1, priority: 0, since: 0 };
export const NO_LIGHT = new LightHandle(DEAD_SLOT, 0);

export class LightPool {
  /**
   * @param scene  라이트를 붙일 씬
   * @param size   동시에 켤 수 있는 마법 라이트 수. 이 개수만큼 상시 비용이 든다.
   */
  constructor(scene, size = 6) {
    this.slots = [];
    this._seq = 0;
    for (let i = 0; i < size; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 10, 2);
      light.castShadow = false;
      scene.add(light);
      this.slots.push({ light, ticket: 1, priority: -1, since: 0 });
    }
  }

  /**
   * 라이트 하나를 빌린다.
   * 남는 게 없으면 **우선순위가 같거나 낮은 것 중 가장 오래된 것을 뺏는다.**
   * 그것도 없으면 NO_LIGHT (아무것도 안 하는 손잡이) 를 준다 —
   * 빛만 안 날 뿐 마법 자체는 정상 동작한다.
   *
   * priority: 0 적 탄환 · 1 투사체 · 2 메테오 · 3 폭발/광역
   */
  acquire(color, intensity, distance, priority = 1) {
    let slot = null;
    for (const s of this.slots) if (s.priority < 0) { slot = s; break; }

    if (!slot) {
      for (const s of this.slots)
        if (s.priority <= priority && (!slot || s.since < slot.since)) slot = s;
      if (!slot) return NO_LIGHT;
      slot.ticket++;                 // 이전 주인의 손잡이를 무효화
    }

    slot.priority = priority;
    slot.since = ++this._seq;
    slot.light.color.set(color);
    slot.light.intensity = intensity;
    slot.light.distance = distance;
    return new LightHandle(slot, slot.ticket);
  }

  /** 판을 새로 시작할 때 전부 반납 */
  releaseAll() {
    for (const s of this.slots) {
      s.light.intensity = 0;
      s.priority = -1;
      s.ticket++;
    }
  }
}
