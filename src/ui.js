import { SPELLS } from './spells.js';
import { pick } from './utils.js';

/** 레벨업 시 3장 중 1장을 고르는 성장 룬 */
export const UPGRADES = [
  { ic: '🔥', name: '작열하는 손', desc: '모든 마법 피해 +18%', apply: p => p.stats.dmg *= 1.18 },
  { ic: '⏱️', name: '시간 가속', desc: '모든 재사용 대기시간 -18%', apply: p => p.stats.cdr *= 0.82 },
  { ic: '💠', name: '마나의 샘', desc: '최대 마나 +30, 재생 +4/초', apply: p => { p.maxMp += 30; p.mp += 30; p.mpRegen += 4; } },
  { ic: '❤️', name: '강인한 육신', desc: '최대 체력 +30, 즉시 회복', apply: p => { p.maxHp += 30; p.hp = p.maxHp; } },
  { ic: '👟', name: '질풍의 신발', desc: '이동 속도 +16%', apply: p => p.stats.moveSpd *= 1.16 },
  { ic: '🔱', name: '삼중 화염구', desc: '화염구 투사체 +1', apply: p => p.stats.fireExtra += 1 },
  { ic: '❄️', name: '혹한의 파동', desc: '서리 폭발 반경 +35%', apply: p => p.stats.novaRadius *= 1.35 },
  { ic: '⚡', name: '폭풍의 사슬', desc: '연쇄 번개 대상 +2', apply: p => p.stats.chainExtra += 2 },
  { ic: '🩸', name: '피의 계약', desc: '가한 피해의 4%를 체력으로 흡수', apply: p => p.stats.lifesteal += 0.04 },
  { ic: '💥', name: '관통 탄', desc: '화염구가 적 1명을 더 관통', apply: p => p.stats.pierce += 1 },
  { ic: '🌀', name: '공간 도약', desc: '점멸 대기시간 -30%', apply: p => p.stats.blinkCdr *= 0.7 },
  { ic: '🎯', name: '급소 간파', desc: '치명타 확률 +9% (치명타는 2배 피해)', apply: p => p.stats.crit = Math.min(0.85, p.stats.crit + 0.09) },
  { ic: '🔮', name: '마력 흡수', desc: '적 처치마다 마나 +5 회복', apply: p => p.stats.manaOnKill += 5 }
];

export class UI {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      hpFill: document.getElementById('hpFill'),
      hpText: document.getElementById('hpText'),
      mpFill: document.getElementById('mpFill'),
      mpText: document.getElementById('mpText'),
      xpFill: document.getElementById('xpFill'),
      lvNum: document.getElementById('lvNum'),
      waveLabel: document.getElementById('waveLabel'),
      waveSub: document.getElementById('waveSub'),
      bossBar: document.getElementById('bossBar'),
      bossName: document.getElementById('bossName'),
      bossFill: document.getElementById('bossFill'),
      killNum: document.getElementById('killNum'),
      scoreNum: document.getElementById('scoreNum'),
      timeNum: document.getElementById('timeNum'),
      spellBar: document.getElementById('spellBar'),
      banner: document.getElementById('banner'),
      vignette: document.getElementById('hurtVignette'),
      levelup: document.getElementById('levelup'),
      cards: document.getElementById('cards'),
      title: document.getElementById('title'),
      gameover: document.getElementById('gameover'),
      goStats: document.getElementById('goStats'),
      pause: document.getElementById('pause'),
      combo: document.getElementById('combo'),
      comboNum: document.getElementById('comboNum'),
      comboMul: document.getElementById('comboMul'),
      runes: document.getElementById('runes'),
      loading: document.getElementById('loading'),
      loadFill: document.getElementById('loadFill'),
      loadText: document.getElementById('loadText')
    };
    this._buildSpellBar();
    this.runes = new Map();
  }

  /* ---------------- 획득 룬 목록 ---------------- */
  resetRunes() {
    this.runes.clear();
    this.el.runes.innerHTML = '';
  }

  addRune(u) {
    const n = (this.runes.get(u.name) ?? 0) + 1;
    this.runes.set(u.name, n);
    this.el.runes.innerHTML = '';
    for (const [name, count] of this.runes) {
      const u2 = UPGRADES.find(x => x.name === name);
      const d = document.createElement('div');
      d.className = 'rune';
      d.title = name + ' ×' + count + ' — ' + (u2 ? u2.desc : '');
      d.innerHTML = (u2 ? u2.ic : '◈') + (count > 1 ? '<b>' + count + '</b>' : '');
      this.el.runes.appendChild(d);
    }
  }

  _buildSpellBar() {
    this.spellEls = {};
    SPELLS.forEach(s => {
      const d = document.createElement('div');
      d.className = 'spell';
      d.innerHTML =
        '<span class="key">' + s.key + '</span>' +
        '<span class="glyph" style="color:' + s.color + '">' + s.glyph + '</span>' +
        '<span class="cost">' + s.mana + '</span>' +
        '<i class="cd"></i>';
      d.title = s.name;
      this.el.spellBar.appendChild(d);
      this.spellEls[s.id] = { root: d, cd: d.querySelector('.cd') };
    });
  }

  setProgress(k, text) {
    this.el.loadFill.style.width = Math.round(k * 100) + '%';
    if (text) this.el.loadText.textContent = text;
  }

  hide(name) { this.el[name].classList.add('hidden'); }
  show(name) { this.el[name].classList.remove('hidden'); }

  banner(text) {
    const b = this.el.banner;
    b.classList.remove('show');
    void b.offsetWidth;   // 애니메이션 재시작
    b.textContent = text;
    b.classList.add('show');
  }

  flashHurt(k) {
    this.el.vignette.style.opacity = k;
  }

  update(game) {
    const p = game.player;
    this.el.hpFill.style.transform = 'scaleX(' + (p.hp / p.maxHp) + ')';
    this.el.hpText.textContent = Math.ceil(p.hp) + ' / ' + p.maxHp;
    this.el.mpFill.style.transform = 'scaleX(' + (p.mp / p.maxMp) + ')';
    this.el.mpText.textContent = Math.floor(p.mp) + ' / ' + p.maxMp;
    this.el.xpFill.style.transform = 'scaleX(' + (p.xp / p.xpNext) + ')';
    this.el.lvNum.textContent = p.level;

    this.el.killNum.textContent = game.kills;
    this.el.scoreNum.textContent = game.score;
    const t = Math.floor(game.elapsed);
    this.el.timeNum.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');

    const wm = game.waves;
    this.el.waveLabel.textContent = 'WAVE ' + Math.max(1, wm.wave);
    if (wm.state === 'break') {
      this.el.waveSub.textContent = '다음 웨이브까지 ' + Math.ceil(wm.breakTimer) + '초';
    } else {
      this.el.waveSub.textContent = '남은 적 ' + (game.enemies.length + wm.queue.length);
    }

    // 연속 처치
    if (game.combo >= 2) {
      this.el.combo.classList.remove('hidden');
      this.el.comboNum.textContent = game.combo;
      this.el.comboMul.textContent = '×' + game.comboMul().toFixed(2);
      // 남은 시간이 줄면 흐려진다 — 끊기기 직전인 걸 눈으로 안다
      this.el.combo.style.opacity = (0.35 + Math.min(1, game.comboT / 1.2) * 0.65).toFixed(2);
    } else {
      this.el.combo.classList.add('hidden');
    }

    // 보스 체력 바
    const boss = game.enemies.find(e => e.def.boss && e.alive);
    if (boss) {
      this.el.bossBar.classList.remove('hidden');
      this.el.bossName.textContent = boss.name;
      this.el.bossFill.style.transform = 'scaleX(' + Math.max(0, boss.hp / boss.maxHp) + ')';
    } else {
      this.el.bossBar.classList.add('hidden');
    }

    SPELLS.forEach(s => {
      const e = this.spellEls[s.id];
      const r = game.spells.cdRatio(s.id);
      e.cd.style.height = (r * 100) + '%';
      e.cd.style.top = 'auto';
      e.cd.style.bottom = '0';
      e.root.classList.toggle('ready', r === 0);
      e.root.classList.toggle('nomana', p.mp < s.mana);
    });
  }

  showLevelUp(onPick) {
    const chosen = [];
    const pool = UPGRADES.slice();
    for (let i = 0; i < 3 && pool.length; i++) {
      const u = pick(pool);
      pool.splice(pool.indexOf(u), 1);
      chosen.push(u);
    }
    this.el.cards.innerHTML = '';
    let taken = false;      // 한 번 열릴 때 한 장만 — 더블클릭으로 두 번 먹지 않게
    chosen.forEach(u => {
      const c = document.createElement('div');
      c.className = 'card';
      c.innerHTML = '<div class="ic">' + u.ic + '</div><h3>' + u.name + '</h3><p>' + u.desc + '</p>';
      c.onclick = () => {
        if (taken) return;
        taken = true;
        this.hide('levelup');
        onPick(u);
      };
      this.el.cards.appendChild(c);
    });
    this.show('levelup');
  }

  showGameOver(game) {
    const t = Math.floor(game.elapsed);
    // 최고 점수는 브라우저에만 남는다 (사생활 모드 등에서 던질 수 있어 감싼다)
    let best = 0;
    try { best = Number(localStorage.getItem('runeguard.best') || 0); } catch (e) { /* 무시 */ }
    const rec = game.score > best;
    if (rec) { try { localStorage.setItem('runeguard.best', String(game.score)); } catch (e) { /* 무시 */ } }

    this.el.goStats.innerHTML =
      '도달 웨이브 <b>' + Math.max(1, game.waves.wave) + '</b> · 최종 레벨 <b>' + game.player.level + '</b><br>' +
      '처치 <b>' + game.kills + '</b> · 최고 연속 <b>' + game.bestCombo + '</b> · 생존 <b>' +
      Math.floor(t / 60) + '분 ' + (t % 60) + '초</b><br>' +
      '최종 점수 <b>' + game.score + '</b>' +
      (rec ? ' <em class="rec">신기록!</em>' : ' <span class="dimmed">(최고 ' + best + ')</span>');
    this.show('gameover');
  }
}
