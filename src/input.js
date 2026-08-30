/** 키보드 / 마우스 입력 */
export const Input = {
  keys: new Set(),
  pressed: new Set(),      // 이번 프레임에 새로 눌린 키
  mouse: { x: 0, y: 0, nx: 0, ny: 0 },
  down: new Set(),         // 눌려있는 마우스 버튼
  clicked: new Set(),      // 이번 프레임에 새로 눌린 버튼
  wheel: 0,

  init(canvas) {
    addEventListener('keydown', e => {
      const k = e.code;
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if (['Space', 'Tab', 'KeyE', 'KeyR', 'Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.down.clear(); });

    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', e => {
      if (!this.down.has(e.button)) this.clicked.add(e.button);
      this.down.add(e.button);
      this.setMouse(e);
    });
    addEventListener('pointerup', e => this.down.delete(e.button));
    addEventListener('pointermove', e => this.setMouse(e));
    canvas.addEventListener('wheel', e => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  },

  setMouse(e) {
    this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    this.mouse.nx = (e.clientX / innerWidth) * 2 - 1;
    this.mouse.ny = -(e.clientY / innerHeight) * 2 + 1;
  },

  key(k) { return this.keys.has(k); },
  justKey(k) { return this.pressed.has(k); },
  btn(b) { return this.down.has(b); },
  justBtn(b) { return this.clicked.has(b); },

  endFrame() { this.pressed.clear(); this.clicked.clear(); this.wheel = 0; }
};
