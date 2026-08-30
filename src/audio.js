/**
 * 외부 오디오 파일 없이 WebAudio로 합성하는 효과음 / 배경 패드.
 */
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.noiseBuf = null;
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

  play(name) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'fire':    this._tone(620, 180, 0.22, { type: 'sawtooth', gain: 0.10 });
                      this._noise(0.22, { gain: 0.14, f0: 2600, f1: 400 }); break;
      case 'boom':    this._noise(0.5, { gain: 0.34, f0: 1400, f1: 60 });
                      this._tone(140, 40, 0.42, { type: 'sine', gain: 0.32 }); break;
      case 'frost':   this._tone(1500, 420, 0.5, { type: 'triangle', gain: 0.16 });
                      this._noise(0.55, { gain: 0.16, type: 'highpass', f0: 900, f1: 4200 }); break;
      case 'zap':     this._noise(0.16, { gain: 0.26, type: 'bandpass', f0: 4200, f1: 1400, q: 2.5 });
                      this._tone(2200, 300, 0.16, { type: 'square', gain: 0.07 }); break;
      case 'meteor':  this._tone(90, 30, 1.1, { type: 'sawtooth', gain: 0.20 });
                      this._noise(1.1, { gain: 0.2, f0: 500, f1: 90 }); break;
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
