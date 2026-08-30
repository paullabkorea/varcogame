import * as THREE from 'three';
import { TAU, rand } from './utils.js';

export const ARENA_RADIUS = 40;

/** 룬 문양이 새겨진 바닥 텍스처를 캔버스로 생성 */
function makeFloorTexture() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');

  // 바탕 돌 + 노이즈
  const g = x.createRadialGradient(S / 2, S / 2, 40, S / 2, S / 2, S / 2);
  g.addColorStop(0, '#3b3556');
  g.addColorStop(0.55, '#241f38');
  g.addColorStop(1, '#141024');
  x.fillStyle = g; x.fillRect(0, 0, S, S);

  const img = x.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  x.putImageData(img, 0, 0);

  // 방사형 타일 선
  x.strokeStyle = 'rgba(150,130,220,0.16)';
  x.lineWidth = 2;
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * TAU;
    x.beginPath();
    x.moveTo(S / 2 + Math.cos(a) * 60, S / 2 + Math.sin(a) * 60);
    x.lineTo(S / 2 + Math.cos(a) * S / 2, S / 2 + Math.sin(a) * S / 2);
    x.stroke();
  }
  for (let r = 90; r < S / 2; r += 62) {
    x.beginPath(); x.arc(S / 2, S / 2, r, 0, TAU); x.stroke();
  }

  // 중앙 마법진
  x.strokeStyle = 'rgba(150,110,255,0.65)';
  x.lineWidth = 5;
  x.beginPath(); x.arc(S / 2, S / 2, 210, 0, TAU); x.stroke();
  x.lineWidth = 2.5;
  x.beginPath(); x.arc(S / 2, S / 2, 178, 0, TAU); x.stroke();
  x.beginPath(); x.arc(S / 2, S / 2, 96, 0, TAU); x.stroke();

  // 오각별
  x.strokeStyle = 'rgba(120,220,255,0.5)';
  x.lineWidth = 3;
  x.beginPath();
  for (let i = 0; i <= 5; i++) {
    const a = -Math.PI / 2 + (i * 2 / 5) * TAU;
    const px = S / 2 + Math.cos(a) * 178, py = S / 2 + Math.sin(a) * 178;
    i === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
  }
  x.stroke();

  // 룬 글리프
  x.fillStyle = 'rgba(190,160,255,0.55)';
  x.font = 'bold 34px serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const runes = 'ᚠᚢᚦᚱᚷᚾᛁᛇᛒᛟᛠᛦ';
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    x.save();
    x.translate(S / 2 + Math.cos(a) * 194, S / 2 + Math.sin(a) * 194);
    x.rotate(a + Math.PI / 2);
    x.fillText(runes[i % runes.length], 0, 0);
    x.restore();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function buildWorld(scene, renderer) {
  const out = { crystals: [], torches: [] };

  scene.background = new THREE.Color(0x05040d);
  scene.fog = new THREE.FogExp2(0x0a0718, 0.012);

  // ---- 바닥 ----
  const floorTex = makeFloorTexture();
  floorTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA_RADIUS + 4, 96),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.92, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // 바닥 테두리 발광 링
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(ARENA_RADIUS + 2.2, ARENA_RADIUS + 4, 128),
    new THREE.MeshBasicMaterial({
      color: 0x7a5cff, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false
    })
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.02;
  scene.add(rim);
  out.rim = rim;

  // ---- 아래로 이어지는 암반 (부유섬 느낌) ----
  const rock = new THREE.Mesh(
    new THREE.CylinderGeometry(ARENA_RADIUS + 4, ARENA_RADIUS * 0.35, 26, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x1b1730, roughness: 1, side: THREE.DoubleSide, flatShading: true })
  );
  rock.position.y = -13;
  const rp = rock.geometry.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    rp.setX(i, rp.getX(i) + rand(-1.2, 1.2));
    rp.setZ(i, rp.getZ(i) + rand(-1.2, 1.2));
  }
  rock.geometry.computeVertexNormals();
  scene.add(rock);

  // ---- 기둥 + 크리스탈 ----
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x2a2444, roughness: 0.85, flatShading: true });
  const crystalGeo = new THREE.OctahedronGeometry(0.9, 0);
  const COUNT = 8;
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * TAU + 0.2;
    const px = Math.cos(a) * (ARENA_RADIUS - 1.5);
    const pz = Math.sin(a) * (ARENA_RADIUS - 1.5);

    const h = rand(5.5, 7.5);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.25, h, 7), pillarMat);
    pillar.position.set(px, h / 2, pz);
    pillar.rotation.y = rand(0, TAU);
    pillar.castShadow = true; pillar.receiveShadow = true;
    scene.add(pillar);

    const hue = i % 2 ? 0x66ccff : 0xaa66ff;
    const crystal = new THREE.Mesh(
      crystalGeo,
      new THREE.MeshStandardMaterial({ color: hue, emissive: hue, emissiveIntensity: 2.4, roughness: 0.3 })
    );
    crystal.position.set(px, h + 1.1, pz);
    scene.add(crystal);
    out.crystals.push(crystal);

    const light = new THREE.PointLight(hue, 22, 26, 2);
    light.position.set(px, h + 1.4, pz);
    scene.add(light);
    out.torches.push({ light, base: 22, phase: rand(0, TAU) });
  }

  // ---- 별 ----
  const starGeo = new THREE.BufferGeometry();
  const N = 1400;
  const sp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = rand(120, 320);
    const th = Math.random() * TAU;
    const ph = Math.acos(rand(-0.15, 1));
    sp[i * 3] = Math.sin(ph) * Math.cos(th) * r;
    sp[i * 3 + 1] = Math.cos(ph) * r;
    sp[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xbfd0ff, size: 1.4, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false
  }));
  scene.add(stars);
  out.stars = stars;

  // ---- 조명 ----
  scene.add(new THREE.HemisphereLight(0x8a7bff, 0x1a1230, 1.6));
  scene.add(new THREE.AmbientLight(0x6a5aa0, 0.9));

  const moon = new THREE.DirectionalLight(0xcfd6ff, 2.4);
  moon.position.set(-24, 42, 20);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);   // 2048 은 저사양 GPU 에서 그림자 패스만 2~3ms 를 먹는다
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 140;
  const s = 52;
  moon.shadow.camera.left = -s; moon.shadow.camera.right = s;
  moon.shadow.camera.top = s; moon.shadow.camera.bottom = -s;
  moon.shadow.bias = -0.0009;
  moon.shadow.normalBias = 0.03;
  scene.add(moon);
  out.moon = moon;

  // 중앙 제단 발광
  const altar = new THREE.PointLight(0x8a6bff, 30, 40, 2);
  altar.position.set(0, 3, 0);
  scene.add(altar);
  out.altar = altar;

  out.update = (t) => {
    out.crystals.forEach((c, i) => {
      c.rotation.y += 0.012;
      c.position.y += Math.sin(t * 1.4 + i) * 0.0035;
    });
    out.torches.forEach(tt => {
      tt.light.intensity = tt.base * (0.78 + Math.sin(t * 6 + tt.phase) * 0.12 + Math.random() * 0.1);
    });
    stars.rotation.y = t * 0.006;
    rim.material.opacity = 0.42 + Math.sin(t * 1.6) * 0.12;
  };

  return out;
}
