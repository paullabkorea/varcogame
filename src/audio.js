/**
 * 효과음 / 배경 패드.
 *
 * 기본은 WebAudio 합성(파일 0바이트)이고, assets/sound 에 녹음된 샘플이 있는
 * 화염구·서리 폭발만 그 샘플을 쓴다. 샘플 로드가 실패해도 합성음으로 그대로
 * 굴러가도록 모든 경로에 폴백을 둔다 (file:// 로 열었을 때가 대표적).
 */

// 샘플이 있는 효과음. rate 는 재생마다 흔들 피치 범위 — 연사할 때
// 똑같은 파형이 반복되면 기계적으로 들려서, 화염구는 폭을 넓게 준다.
// gain 은 기존 합성음과 체감 음량을 맞춘 값이다. 샘플은 합성음과 달리 소리가
// 꽉 차 있어서 피크를 맞추면 훨씬 크게 들린다 — 마스터 뒤에서 잰 RMS 기준으로
// 합성 폭발음(boom)과 비슷해지는 지점으로 내렸다.
const SFX = {
  fire:  { file: 'fireball.wav', gain: 0.26, rate: [0.93, 1.09] },
  frost: { file: 'frost.wav',    gain: 0.40, rate: [0.97, 1.04] }
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.noiseBuf = null;
    this.buffers = {};        // 이름 → AudioBuffer (디코드 끝난 것만 들어온다)
    this._fetched = null;
    this.preload();
  }

  /**
   * AudioContext 는 사용자 조작 전에 만들 수 없지만 다운로드는 미리 할 수 있다.
   * 로딩 화면 동안 받아 두고, 디코드만 start() 로 미룬다.
   */
  preload() {
    if (this._fetched) return this._fetched;
    this._fetched = Promise.all(Object.entries(SFX).map(([name, def]) =>
      fetch(new URL(`../assets/sound/${def.file}`, import.meta.url))
        .then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status)))
        .then(data => ({ name, data }))
        .catch(err => { console.warn(`[audio] ${def.file} 로드 실패 — 합성음으로 대체합니다.`, err); return null; })
    ));
    return this._fetched;
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // 화이트 노이즈 버퍼 (2초)
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.startPad();
    this._decode();
  }

  /** 받아 둔 wav 를 AudioBuffer 로 굽는다. 실패한 건 그냥 합성음으로 남는다. */
  _decode() {
    this._fetched.then(list => {
      for (const item of list) {
        if (!item || !this.ctx) continue;
        this.ctx.decodeAudioData(item.data)
          .then(buf => { this.buffers[item.name] = buf; })
          .catch(err => console.warn(`[audio] ${item.name} 디코드 실패 — 합성음으로 대체합니다.`, err));
      }
    });
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  get t() { return this.ctx.currentTime; }

  _noise(dur, { gain = 0.3, type = 'lowpass', f0 = 2000, f1 = 200, q = 1 } = {}) {
    const c = this.ctx, t = this.t;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const filt = c.createBiquadFilter(); filt.type = type; filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  _tone(f0, f1, dur, { type = 'sine', gain = 0.25, delay = 0 } = {}) {
    const c = this.ctx, t = this.t + delay;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /**
   * 녹음 샘플 재생. 아직 디코드가 안 끝났거나 로드에 실패했으면 false 를 돌려주고,
   * 호출한 쪽이 합성음으로 넘어간다.
   */
  _sample(name, { gain = 0.5, rate = null, delay = 0 } = {}) {
    const buf = this.buffers[name];
    if (!buf) return false;
    const c = this.ctx, t = this.t + delay;
    const src = c.createBufferSource();
    src.buffer = buf;
    const [lo, hi] = rate ?? SFX[name]?.rate ?? [1, 1];
    src.playbackRate.value = lo + Math.random() * (hi - lo);
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start(t);
    return true;
  }

  play(name) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'fire':    if (this._sample('fire', { gain: SFX.fire.gain })) break;
                      this._tone(620, 180, 0.22, { type: 'sawtooth', gain: 0.10 });
                      this._noise(0.22, { gain: 0.14, f0: 2600, f1: 400 }); break;
      case 'boom':    this._noise(0.5, { gain: 0.34, f0: 1400, f1: 60 });
                      this._tone(140, 40, 0.42, { type: 'sine', gain: 0.32 }); break;
      case 'frost':   if (this._sample('frost', { gain: SFX.frost.gain })) break;
                      this._tone(1500, 420, 0.5, { type: 'triangle', gain: 0.16 });
                      this._noise(0.55, { gain: 0.16, type: 'highpass', f0: 900, f1: 4200 }); break;
      case 'zap':     this._noise(0.16, { gain: 0.26, type: 'bandpass', f0: 4200, f1: 1400, q: 2.5 });
                      this._tone(2200, 300, 0.16, { type: 'square', gain: 0.07 }); break;
      case 'meteor':  this._tone(90, 30, 1.1, { type: 'sawtooth', gain: 0.20 });
                      this._noise(1.1, { gain: 0.2, f0: 500, f1: 90 });
                      // 화염구 샘플을 절반 속도로 겹쳐 덩치를 키운다 (같은 불 계열이라 톤이 붙는다)
                      this._sample('fire', { gain: 0.22, rate: [0.5, 0.58], delay: 0.06 }); break;
      case 'blink':   this._tone(300, 1600, 0.16, { type: 'sine', gain: 0.14 });
                      this._noise(0.18, { gain: 0.08, type: 'highpass', f0: 1200, f1: 5000 }); break;
      case 'hit':     this._noise(0.08, { gain: 0.13, f0: 2400, f1: 700 }); break;
      case 'death':   this._tone(360, 70, 0.35, { type: 'square', gain: 0.10 });
                      this._noise(0.3, { gain: 0.12, f0: 1200, f1: 200 }); break;
      case 'hurt':    this._tone(220, 80, 0.3, { type: 'sawtooth', gain: 0.22 }); break;
      case 'levelup': [523, 659, 784, 1046].forEach((f, i) =>
                        this._tone(f, f, 0.5, { type: 'triangle', gain: 0.16, delay: i * 0.09 })); break;
      case 'wave':    [196, 262, 330].forEach((f, i) =>
                        this._tone(f, f, 0.9, { type: 'sawtooth', gain: 0.09, delay: i * 0.05 })); break;
      case 'nomana':  this._tone(200, 150, 0.12, { type: 'square', gain: 0.06 }); break;
      case 'pickup':  this._tone(880, 1320, 0.18, { type: 'triangle', gain: 0.12 }); break;
    }
  }

  /** 저음 드론 + 느린 아르페지오 배경 */
  startPad() {
    const c = this.ctx;
    const pad = c.createGain(); pad.gain.value = 0.055; pad.connect(this.master);
    [55, 82.5, 110].forEach((f, i) => {
      const o = c.createOscillator(); o.type = i === 2 ? 'triangle' : 'sawtooth';
      o.frequency.value = f;
      const lfo = c.createOscillator(); lfo.frequency.value = 0.05 + i * 0.03;
      const lg = c.createGain(); lg.gain.value = 0.6;
      lfo.connect(lg).connect(o.detune);
      const filt = c.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 380;
      o.connect(filt).connect(pad);
      o.start(); lfo.start();
    });

    const notes = [220, 261.6, 329.6, 392, 329.6, 261.6];
    let i = 0;
    this._arp = setInterval(() => {
      if (!this.ctx || this.muted) return;
      this._tone(notes[i % notes.length], notes[i % notes.length], 1.4, { type: 'sine', gain: 0.035 });
      i++;
    }, 1500);
  }
}
