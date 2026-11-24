// Monster Dice - Scratch 2.0 to HTML5 Canvas Engine & Game Logic
(function () {
  const X_MODIFIED = [-231, -206, -182, -157, -133, -108, -84, -59, -35, -11, 14, 38, 63, 87, 112, 136, 161, 185, 210];
  const Y_MODIFIED = [157, 132, 108, 83, 59, 34, 10, -15, -40, -64, -89, -113, -138];

  const SPECIES_NAMES = ['', '龍族 (Dragon)', '魔法師族 (Magician)', '戰士族 (Warrior)', '獸族 (Beast)', '不死族 (Ghost)'];
  const SPECIES_MAX = [0, 1, 2, 2, 3, 2];

  const canvas = document.getElementById('stage-canvas');
  const ctx = canvas.getContext('2d');

  // Assets Loading
  const assetMeta = window.GAME_ASSETS.meta;
  const assetData = window.GAME_ASSETS.data;
  const images = {};
  const sounds = {};
  let soundEnabled = true;
  let aiEnabled = true;
  let aiRunning = false;

  const STAGE_W = 480;
  const STAGE_H = 440;
  const CENTER_X = STAGE_W / 2;
  const CENTER_Y = STAGE_H / 2;

  // Offscreen canvas for pixel-perfect hit detection
  const hitCanvas = document.createElement('canvas');
  hitCanvas.width = STAGE_W;
  hitCanvas.height = STAGE_H;
  const hitCtx = hitCanvas.getContext('2d', { willReadFrequently: true });

  function loadAllAssets() {
    const promises = [];
    for (const [path, dataUrl] of Object.entries(assetData)) {
      if (path.endsWith('.svg') || path.endsWith('.png')) {
        promises.push(new Promise((resolve) => {
          const img = new Image();
          img.onload = () => { images[path] = img; resolve(); };
          img.onerror = () => { console.warn('Failed to load image:', path); resolve(); };
          img.src = dataUrl;
        }));
      } else if (path.endsWith('.wav')) {
        const audio = new Audio(dataUrl);
        sounds[path] = audio;
      }
    }
    return Promise.all(promises);
  }

  function playSound(name) {
    if (!soundEnabled) return;
    const path = assetMeta.sounds[name];
    if (path && sounds[path]) {
      try {
        const clone = sounds[path].cloneNode();
        clone.volume = 0.75;
        clone.play().catch(() => {});
      } catch (e) {}
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  // Sprite Class
  let zCounter = 1;
  class Sprite {
    constructor(objName, isClone = false) {
      this.objName = objName;
      this.isClone = isClone;
      this.costumes = assetMeta.costumes[objName] || [];
      this.costumeIndex = 1; // 1-based like Scratch
      this.x = 0;
      this.y = 0;
      this.size = 100;
      this.visible = false;
      this.ghost = 0;
      this.colorEffect = 0;
      this.heading = 90;
      this.rotationStyle = 'normal';
      this.layerGroup = this.getDefaultLayerGroup(objName);
      this.zOrder = zCounter++;
      this.sayText = '';
      this.vars = {};
      this.onClick = null;
    }

    getDefaultLayerGroup(objName) {
      if (objName === 'field') return 0;
      if (objName === 'stone_road' || objName === 'player1_occupied' || objName === 'player2_occupied') return 10;
      if (objName === 'grid_frame') return 15;
      if (objName === 'player1_monster' || objName === 'player2_monster') return 20;
      if (objName === 'sword' || objName === 'shield') return 25;
      if (objName === 'token_player1' || objName === 'token_player2' || objName === 'Sprite1' || objName === 'player1_font' || objName === 'player2_font') return 30;
      if (objName === 'panel' || objName === 'mon_number' || objName === 'go_to_field') return 40;
      if (objName === 'dice_1' || objName === 'dice_2' || objName === 'dice_3') return 45;
      if (objName === 'p1_life' || objName === 'p2_life' || objName === 'duel' || objName === 'p1_enter' || objName === 'p2_enter') return 50;
      if (objName === 'message') return 60;
      return 20;
    }

    lookLike(nameOrIndex) {
      if (typeof nameOrIndex === 'number') {
        const idx = Math.max(1, Math.min(this.costumes.length, Math.round(nameOrIndex)));
        this.costumeIndex = idx;
      } else {
        const num = Number(nameOrIndex);
        if (!isNaN(num) && String(num) === String(nameOrIndex).trim()) {
          const idx = this.costumes.findIndex((c) => c.name === String(nameOrIndex));
          if (idx !== -1) this.costumeIndex = idx + 1;
          else this.costumeIndex = Math.max(1, Math.min(this.costumes.length, num));
        } else {
          const idx = this.costumes.findIndex((c) => c.name === String(nameOrIndex));
          if (idx !== -1) this.costumeIndex = idx + 1;
        }
      }
    }

    nextCostume() {
      this.costumeIndex = (this.costumeIndex % this.costumes.length) + 1;
    }

    comeToFront() {
      this.zOrder = zCounter++;
    }

    sendToBack() {
      this.zOrder = 0;
    }

    async glideTo(secs, targetX, targetY) {
      const startX = this.x;
      const startY = this.y;
      const steps = Math.max(1, Math.round((secs * 1000) / 16));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        this.x = startX + (targetX - startX) * t;
        this.y = startY + (targetY - startY) * t;
        await sleep(16);
      }
      this.x = targetX;
      this.y = targetY;
    }

    draw(targetCtx) {
      if (!this.visible) return;
      const cos = this.costumes[this.costumeIndex - 1];
      if (!cos) return;
      const img = images[cos.file];
      if (!img) return;

      const scale = (this.size / 100) / (cos.res || 1);
      const sx = CENTER_X + this.x;
      const sy = CENTER_Y - this.y;

      targetCtx.save();
      targetCtx.globalAlpha = Math.max(0, Math.min(1, 1 - this.ghost / 100));
      if (this.colorEffect !== 0) {
        targetCtx.filter = `hue-rotate(${this.colorEffect * 1.8}deg) brightness(1.12)`;
      }
      targetCtx.translate(sx, sy);
      if (this.rotationStyle === 'left-right' && this.heading === -90) {
        targetCtx.scale(-1, 1);
      }
      targetCtx.scale(scale, scale);
      targetCtx.drawImage(img, -cos.cx, -cos.cy, cos.w, cos.h);
      targetCtx.restore();
    }

    drawSpeechBubble(targetCtx, placedBoxes = []) {
      if (!this.visible || !this.sayText) return;
      const sx = CENTER_X + this.x;
      const sy = CENTER_Y - this.y;

      targetCtx.save();
      targetCtx.font = 'bold 12px "Microsoft JhengHei", sans-serif';
      const metrics = targetCtx.measureText(this.sayText);
      const padX = 7;
      const bw = metrics.width + padX * 2;
      const bh = 22;

      // Candidate positions around the monster:
      // P1 (Red) prefers Top-Left / Left / Bottom-Left; P2 (Blue) prefers Top-Right / Right / Bottom-Right
      const isP1Mon = this.objName === 'player1_monster';
      const candidates = isP1Mon
        ? [
            { x: sx - bw - 12, y: sy - 30 }, // Top-Left
            { x: sx - bw - 12, y: sy + 6 },  // Bottom-Left
            { x: sx + 12, y: sy - 30 },      // Top-Right
            { x: sx + 12, y: sy + 6 },       // Bottom-Right
            { x: sx - bw / 2, y: sy - 42 },  // Far Top
            { x: sx - bw / 2, y: sy + 18 },  // Far Bottom
          ]
        : [
            { x: sx + 12, y: sy + 6 },       // Bottom-Right
            { x: sx + 12, y: sy - 30 },      // Top-Right
            { x: sx - bw - 12, y: sy + 6 },  // Bottom-Left
            { x: sx - bw - 12, y: sy - 30 }, // Top-Left
            { x: sx - bw / 2, y: sy + 18 },  // Far Bottom
            { x: sx - bw / 2, y: sy - 42 },  // Far Top
          ];

      const clampBox = (c) => ({
        x: Math.max(4, Math.min(STAGE_W - bw - 4, c.x)),
        y: Math.max(42, Math.min(STAGE_H - bh - 42, c.y)),
      });

      const overlaps = (a, b) =>
        !(a.x + bw + 4 < b.x || a.x > b.x + b.w + 4 || a.y + bh + 4 < b.y || a.y > b.y + b.h + 4);

      let chosen = clampBox(candidates[0]);
      for (const cand of candidates) {
        const clamped = clampBox(cand);
        if (!placedBoxes.some((b) => overlaps(clamped, b))) {
          chosen = clamped;
          break;
        }
      }

      // Final nudge if still overlapping
      while (placedBoxes.some((b) => overlaps(chosen, b))) {
        chosen.y += bh + 4;
        if (chosen.y + bh > STAGE_H - 42) {
          chosen.y = 44;
          break;
        }
      }

      const bx = chosen.x;
      const by = chosen.y;
      placedBoxes.push({ x: bx, y: by, w: bw, h: bh });

      // Connect bubble to monster with a small indicator line
      targetCtx.strokeStyle = isP1Mon ? '#f87171' : '#60a5fa';
      targetCtx.lineWidth = 1.5;
      targetCtx.beginPath();
      targetCtx.moveTo(sx, sy - 6);
      targetCtx.lineTo(bx + bw / 2, by + bh / 2);
      targetCtx.stroke();

      targetCtx.fillStyle = isP1Mon ? 'rgba(69, 10, 10, 0.92)' : 'rgba(15, 23, 42, 0.92)';
      targetCtx.strokeStyle = isP1Mon ? '#f87171' : '#60a5fa';
      targetCtx.lineWidth = 1.5;
      targetCtx.beginPath();
      targetCtx.roundRect(bx, by, bw, bh, 6);
      targetCtx.fill();
      targetCtx.stroke();

      targetCtx.fillStyle = '#fef08a';
      targetCtx.textAlign = 'center';
      targetCtx.textBaseline = 'middle';
      targetCtx.fillText(this.sayText, bx + bw / 2, by + bh / 2);
      targetCtx.restore();
    }

    hitTest(canvasX, canvasY) {
      if (!this.visible) return false;
      const cos = this.costumes[this.costumeIndex - 1];
      if (!cos || !images[cos.file]) return false;

      if (this.objName === 'field' || this.objName === 'panel') {
        const scale = (this.size / 100) / (cos.res || 1);
        const sx = CENTER_X + this.x;
        const sy = CENTER_Y - this.y;
        const left = sx - cos.cx * scale;
        const top = sy - cos.cy * scale;
        const right = left + cos.w * scale;
        const bottom = top + cos.h * scale;
        return canvasX >= left && canvasX <= right && canvasY >= top && canvasY <= bottom;
      }

      // Some SVGs have negative or offset paths, so we use offscreen pixel alpha check
      hitCtx.clearRect(0, 0, STAGE_W, STAGE_H);
      this.draw(hitCtx);
      const px = Math.floor(canvasX);
      const py = Math.floor(canvasY);
      if (px < 0 || px >= STAGE_W || py < 0 || py >= STAGE_H) return false;
      const data = hitCtx.getImageData(Math.max(0, px - 2), Math.max(0, py - 2), 5, 5).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 15) return true;
      }
      return false;
    }
  }

  // Global Game State (matching Scratch variables & lists)
  const G = {
    stageCostume: 'waiting',
    game_start: 0,
    game_on: 0,
    field: 0,
    turn: 0,
    p1_life: 3,
    p2_life: 3,
    p1_punish: 0,
    p2_punish: 0,
    panel_lock: 0,
    dice_lock: 0,
    dice1_done: 1,
    dice2_done: 1,
    dice3_done: 1,
    curr_species: 0,
    summon: 0,
    curr_action_1: 0,
    curr_action_2: 0,
    dice_grid_num: 0,
    defense_done: 0,
    atk_success: 0,
    start: 0,
    row: 0,
    column: 0,
    summon_row: 0,
    summon_column: 0,
    move_grid: 0,
    k: 0,
    t1_lock: 0,
    t2_lock: 0,
    m1_lock: 0,
    m2_lock: 0,
    prepare1_lock: 0,
    prepare2_lock: 0,

    // Lists (1-based helper access below)
    field_occupied: new Array(13 * 19).fill(0),
    player1_token_list: [],
    player2_token_list: [],
    player1_mon_field: [0, 0, 0, 0, 0],
    player2_mon_field: [0, 0, 0, 0, 0],
    summon_token_produced: new Array(10).fill(0),
    player1_mon_atk_def: new Array(10).fill(0),
    player2_mon_atk_def: new Array(10).fill(0),
    attacked: new Array(10).fill(0),
    dice_action: [],
    grid_created: [],
    deadlock_list: [],
    monster_move: [],
    treasure_chests: [],
  };

  function getCell(row, col) {
    if (row < 1 || row > 13 || col < 1 || col > 19) return -1;
    return Number(G.field_occupied[(row - 1) + (col - 1) * 13]);
  }

  function setCell(row, col, val) {
    if (row < 1 || row > 13 || col < 1 || col > 19) return;
    G.field_occupied[(row - 1) + (col - 1) * 13] = Number(val);
  }

  // Create Base Sprites
  const sprites = {
    field: new Sprite('field'),
    p1_enter: new Sprite('p1_enter'),
    p2_enter: new Sprite('p2_enter'),
    duel: new Sprite('duel'),
    p1_life: new Sprite('p1_life'),
    p2_life: new Sprite('p2_life'),
    panel: new Sprite('panel'),
    go_to_field: new Sprite('go_to_field'),
    dice_1: new Sprite('dice_1'),
    dice_2: new Sprite('dice_2'),
    dice_3: new Sprite('dice_3'),
    next_turn_btn: new Sprite('Sprite1'),
    sword: new Sprite('sword'),
    shield: new Sprite('shield'),
    player1_font: new Sprite('player1_font'),
    player2_font: new Sprite('player2_font'),
    grid_frame: new Sprite('grid_frame'),
    message: new Sprite('message'),
  };

  // Clone containers
  let clones = {
    stone_road: [],
    p1_occupied: [],
    p2_occupied: [],
    p1_monster: [],
    p2_monster: [],
    p1_tokens: [],
    p2_tokens: [],
    mon_numbers: [],
  };

  function getAllRenderSprites() {
    return [
      sprites.field,
      ...clones.stone_road,
      ...clones.p1_occupied,
      ...clones.p2_occupied,
      ...clones.p1_monster,
      ...clones.p2_monster,
      ...clones.p1_tokens,
      ...clones.p2_tokens,
      sprites.p1_life,
      sprites.p2_life,
      sprites.panel,
      ...clones.mon_numbers,
      sprites.dice_1,
      sprites.dice_2,
      sprites.dice_3,
      sprites.go_to_field,
      sprites.next_turn_btn,
      sprites.grid_frame,
      sprites.sword,
      sprites.shield,
      sprites.player1_font,
      sprites.player2_font,
      sprites.p1_enter,
      sprites.p2_enter,
      sprites.duel,
      sprites.message,
    ];
  }

  // UI Status Updater
  function updateStatusUI(hintText) {
    const turnBadge = document.getElementById('ui-turn');
    const phaseBadge = document.getElementById('ui-phase');
    const p1HpEl = document.getElementById('ui-p1-hp');
    const p2HpEl = document.getElementById('ui-p2-hp');
    const hintEl = document.getElementById('ui-hint');

    if (p1HpEl) p1HpEl.textContent = '❤️'.repeat(Math.max(0, G.p1_life)) + '🖤'.repeat(Math.max(0, Math.max(3, G.p1_life) - G.p1_life));
    if (p2HpEl) p2HpEl.textContent = '❤️'.repeat(Math.max(0, G.p2_life)) + '🖤'.repeat(Math.max(0, Math.max(3, G.p2_life) - G.p2_life));

    if (!G.game_on) {
      if (turnBadge) {
        turnBadge.textContent = aiEnabled ? '單人挑戰 AI 模式' : '雙人對戰模式';
        turnBadge.className = 'badge badge-neutral';
      }
      if (phaseBadge) phaseBadge.textContent = '準備畫面';
      if (hintEl && !hintText) {
        hintEl.textContent = aiEnabled
          ? '🤖 目前 P2 (藍方) 為 AI 對手！請點擊畫面左側閃爍的「Player 1 (紅方)」角色圖示入場開始決鬥！（或點擊上方「⚡ 快速開始」）'
          : '👥 雙人模式：請依序點擊畫面上的「Player 1」與「Player 2」角色圖示開始決鬥！';
      }
      return;
    }

    const isP1 = G.turn % 2 === 0;
    if (turnBadge) {
      turnBadge.textContent = `回合 ${G.turn + 1}：${isP1 ? '玩家 1 (紅方)' : '玩家 2 (藍方)'}`;
      turnBadge.className = isP1 ? 'badge badge-p1' : 'badge badge-p2';
    }
    if (phaseBadge) {
      phaseBadge.textContent = G.field === 0 ? '🎲 選怪擲骰階段 (Panel)' : '⚔️ 戰場行動階段 (Field)';
    }
    if (hintEl && hintText) {
      hintEl.textContent = hintText;
    } else if (hintEl) {
      if (G.field === 0) {
        if (G.panel_lock === 0) {
          hintEl.textContent = `請${isP1 ? '玩家 1 (紅方) 在右側' : '玩家 2 (藍方) 在左側'}怪獸面板點擊一隻怪獸來擲骰子！`;
        } else {
          hintEl.textContent = `請點擊畫面上的骰子收集行動印記（最多 5 個），完成後點擊${isP1 ? '左下角' : '右上角'}的「開始戰鬥」進入棋盤！`;
        }
      } else {
        const act = isP1 ? G.curr_action_1 : G.curr_action_2;
        const handList = isP1 ? G.player1_token_list : G.player2_token_list;
        const activeCount = handList.filter((v) => Number(v) > 0).length;
        const alive = hasMonsterAlive(isP1 ? 1 : 2);
        if (act === 5) hintEl.textContent = '【召喚鋪路】請點擊與己方領地相鄰（上下左右）的棋盤格來鋪設 6 格領地並召喚怪獸！';
        else if (act === 4) hintEl.textContent = '【怪獸移動】請先點擊要移動的己方怪獸，再依序點擊相鄰的領地格移動！（💡 若不想使用，可再次點擊該枚發亮的移動徽章直接將其丟棄）';
        else if (act === 1) hintEl.textContent = '【發動攻擊】請點擊要發動攻擊的己方怪獸！（💡 若不想使用，可再次點擊該枚發亮的攻擊徽章直接將其丟棄）';
        else if (act === 2) hintEl.textContent = '【主動護盾 🛡️】請點擊場上一隻己方怪獸為其掛上護盾！（可抵擋 1 次敵方陷阱破壞，並在決鬥時自動提供基礎防禦力；再點一下徽章可丟棄）';
        else if (act === 3) hintEl.textContent = '【陷阱效果】請根據提示點擊要破壞的敵方怪獸或敵方領地格！';
        else if (!alive && activeCount > 0) {
          hintEl.textContent = `⚠️ 目前場上無己方怪獸！若要騰出空位給下回合的「召喚徽章」，請直接點擊${isP1 ? '上方紅方' : '下方藍方'}的「移動/攻擊/陷阱」徽章將其丟棄（共有 ${activeCount}/5 枚），完成後點擊「回合結束」。`;
        } else if (activeCount >= 5) {
          hintEl.textContent = `⚠️ 你目前徽章已滿（5/5 枚）！若不消耗或丟棄至少 1 枚徽章，下回合擲出召喚時將無法獲得召喚徽章！（可點擊徽章使用，或連點兩下移動/攻擊徽章將其丟棄）`;
        } else {
          hintEl.textContent = `請點擊${isP1 ? '上方紅方' : '下方藍方'}持有的行動印記（${activeCount}/5 枚）執行動作，或連點兩下多餘的移動/攻擊印記將其丟棄；完成後點擊${isP1 ? '左下角' : '右上角'}的「回合結束」換手。`;
        }
      }
    }
  }

  // Message Popup
  let msgLock = false;
  async function showMessage(cond) {
    G.message_cond = Number(cond);
    sprites.message.lookLike(G.message_cond);
    sprites.message.size = 75;
    sprites.message.x = 0;
    sprites.message.y = 0;
    sprites.message.comeToFront();
    sprites.message.visible = true;

    if (G.message_cond === 16 || G.message_cond === 17) {
      G.game_on = 0;
      updateStatusUI(G.message_cond === 16 ? '🏆 玩家 1 獲勝！' : '🏆 玩家 2 獲勝！');
    } else {
      await sleep(1600);
      sprites.message.visible = false;
    }
  }

  async function showP1LifePopup() {
    sprites.p1_life.size = 100;
    sprites.p1_life.lookLike(G.p1_life + 1);
    sprites.p1_life.x = -100;
    sprites.p1_life.y = 80;
    sprites.p1_life.comeToFront();
    sprites.p1_life.visible = true;
    updateStatusUI();
    await sleep(1000);
    sprites.p1_life.visible = false;
  }

  async function showP2LifePopup() {
    sprites.p2_life.size = 100;
    sprites.p2_life.lookLike(G.p2_life + 1);
    sprites.p2_life.x = -100;
    sprites.p2_life.y = 80;
    sprites.p2_life.comeToFront();
    sprites.p2_life.visible = true;
    updateStatusUI();
    await sleep(1000);
    sprites.p2_life.visible = false;
  }

  async function flashSword(col, row) {
    sprites.sword.x = X_MODIFIED[col - 1] + 10;
    sprites.sword.y = Y_MODIFIED[row - 1] + 10;
    if (G.turn % 2 === 0) {
      sprites.sword.heading = 90;
    } else {
      sprites.sword.rotationStyle = 'left-right';
      sprites.sword.heading = -90;
    }
    sprites.sword.size = 75;
    sprites.sword.comeToFront();
    sprites.sword.visible = true;
    for (let i = 0; i < 3; i++) {
      await sleep(180);
      sprites.sword.visible = false;
      await sleep(180);
      sprites.sword.visible = true;
    }
    await sleep(800);
    sprites.sword.visible = false;
  }

  async function flashShield(col, row) {
    sprites.shield.x = X_MODIFIED[col - 1] + 10;
    sprites.shield.y = Y_MODIFIED[row - 1] + 10;
    sprites.shield.size = 75;
    sprites.shield.comeToFront();
    sprites.shield.visible = true;
    for (let i = 0; i < 3; i++) {
      await sleep(180);
      sprites.shield.visible = false;
      await sleep(180);
      sprites.shield.visible = true;
    }
    await sleep(800);
    sprites.shield.visible = false;
  }

  async function flashGridFrame(col, row) {
    sprites.grid_frame.x = X_MODIFIED[col - 1];
    sprites.grid_frame.y = Y_MODIFIED[row - 1];
    sprites.grid_frame.size = 55;
    sprites.grid_frame.ghost = 50;
    sprites.grid_frame.comeToFront();
    sprites.grid_frame.visible = true;
    await sleep(200);
    sprites.grid_frame.visible = false;
  }

  // Green Flag Initialization
  function initGreenFlag() {
    G.stageCostume = 'waiting';
    G.game_start = 0;
    G.game_on = 0;
    G.field = 0;
    G.turn = 0;
    G.p1_life = 3;
    G.p2_life = 3;
    G.p1_punish = 0;
    G.p2_punish = 0;
    G.panel_lock = 0;
    G.dice_lock = 0;
    G.curr_action_1 = 0;
    G.curr_action_2 = 0;
    G.t1_lock = 0;
    G.t2_lock = 0;
    G.m1_lock = 0;
    G.m2_lock = 0;

    // Reset board 13x19
    G.field_occupied = new Array(13 * 19).fill(0);
    setCell(7, 1, 1);   // Player 1 base at (row=7, col=1) -> index 7
    setCell(7, 19, 2);  // Player 2 base at (row=7, col=19) -> index 13*18+7 = 241

    // Clear all clones & hide sprites
    for (const k of Object.keys(clones)) clones[k] = [];
    for (const sp of Object.values(sprites)) {
      sp.visible = false;
      sp.sayText = '';
      sp.ghost = 0;
      sp.colorEffect = 0;
    }

    // Show p1_enter and p2_enter
    sprites.p1_enter.lookLike('造型1');
    sprites.p1_enter.size = 100;
    sprites.p1_enter.x = -180;
    sprites.p1_enter.y = -80;
    sprites.p1_enter.visible = true;

    sprites.p2_enter.lookLike('造型1');
    sprites.p2_enter.size = 100;
    sprites.p2_enter.x = -40;
    sprites.p2_enter.y = -80;
    sprites.p2_enter.visible = true;

    updateStatusUI();
  }

  // Player Enter Click Handlers
  sprites.p1_enter.onClick = async () => {
    if (sprites.p1_enter.costumeIndex === 1) {
      playSound('playerenter');
      sprites.p1_enter.x = -160;
      sprites.p1_enter.y = -80;
      sprites.p1_enter.size = 75;
      sprites.p1_enter.lookLike('造型2');
      G.game_start += 1;
      if (G.game_start === 2) {
        G.game_on = 1;
        await sleep(800);
        await onGameShow();
      } else if (aiEnabled && sprites.p2_enter.costumeIndex === 1) {
        await sleep(450);
        if (sprites.p2_enter.costumeIndex === 1) {
          await sprites.p2_enter.onClick();
        }
      }
    }
  };

  sprites.p2_enter.onClick = async () => {
    if (aiEnabled && sprites.p1_enter.costumeIndex === 1) {
      // If AI is P2 and user accidentally clicked P2 first, redirect to clicking P1!
      await sprites.p1_enter.onClick();
      return;
    }
    if (sprites.p2_enter.costumeIndex === 1) {
      playSound('playerenter');
      sprites.p2_enter.x = -10;
      sprites.p2_enter.y = -80;
      sprites.p2_enter.size = 75;
      sprites.p2_enter.lookLike('造型2');
      G.game_start += 1;
      if (G.game_start === 2) {
        G.game_on = 1;
        await sleep(800);
        await onGameShow();
      }
    }
  };

  async function onGameShow() {
    G.stageCostume = 'game';
    sprites.p1_enter.visible = false;
    sprites.p2_enter.visible = false;

    sprites.p1_life.size = 75;
    sprites.p1_life.lookLike('3');
    sprites.p1_life.x = -230;
    sprites.p1_life.y = 170;
    sprites.p1_life.comeToFront();
    sprites.p1_life.visible = true;

    sprites.p2_life.size = 75;
    sprites.p2_life.lookLike('3');
    sprites.p2_life.x = 80;
    sprites.p2_life.y = -50;
    sprites.p2_life.comeToFront();
    sprites.p2_life.visible = true;

    await sleep(600);
    sprites.duel.size = 100;
    sprites.duel.x = 0;
    sprites.duel.y = 0;
    sprites.duel.comeToFront();
    for (let i = 0; i < 5; i++) {
      sprites.duel.visible = true;
      await sleep(140);
      sprites.duel.visible = false;
      await sleep(140);
    }
    onGameStart();
  }

  function spawnMonNumbers() {
    clones.mon_numbers = [];
    const isP1 = G.turn % 2 === 0;
    const yPositions = [88, 38, -15, -67, -120];
    for (let j = 1; j <= 5; j++) {
      const sp = new Sprite('mon_number', true);
      const used = isP1 ? G.summon_token_produced[j - 1] : G.summon_token_produced[j + 4];
      const remaining = Math.max(0, SPECIES_MAX[j] - used);
      sp.lookLike(remaining + 1); // costumes: 1->'0', 2->'1', 3->'2', 4->'3'
      sp.x = isP1 ? 220 : -225;
      sp.y = yPositions[j - 1];
      sp.size = 60;
      sp.comeToFront();
      sp.visible = true;
      clones.mon_numbers.push(sp);
    }
  }

  function refreshMonNumbers() {
    if (G.field === 1) {
      clones.mon_numbers = [];
      return;
    }
    spawnMonNumbers();
  }

  function onGameStart() {
    sprites.p1_life.visible = false;
    sprites.p2_life.visible = false;

    // Show field board & generate 3 random stone obstacles
    sprites.field.size = 100;
    sprites.field.x = 0;
    sprites.field.y = 0;
    sprites.field.sendToBack();
    sprites.field.visible = true;

    clones.stone_road = [];
    for (let s = 0; s < 3; s++) {
      const r = randInt(1, 13);
      const c = randInt(2, 18);
      setCell(r, c, 5);
      const stone = new Sprite('stone_road', true);
      stone.x = X_MODIFIED[c - 1];
      stone.y = Y_MODIFIED[r - 1];
      stone.size = 40;
      stone.comeToFront();
      stone.visible = true;
      clones.stone_road.push(stone);
    }

    // Spawn 2 neutral Mystery Treasure Chests in the middle columns (col 8..12)
    G.treasure_chests = [];
    let chestTries = 0;
    while (G.treasure_chests.length < 2 && chestTries < 50) {
      chestTries++;
      const cr = randInt(2, 12);
      const cc = randInt(8, 12);
      if (getCell(cr, cc) === 0 && !G.treasure_chests.some((ch) => ch.row === cr && ch.col === cc)) {
        G.treasure_chests.push({ row: cr, col: cc });
      }
    }

    G.player1_token_list = [];
    G.player2_token_list = [];
    G.player1_mon_field = [0, 0, 0, 0, 0];
    G.player2_mon_field = [0, 0, 0, 0, 0];
    G.summon_token_produced = new Array(10).fill(0);
    G.player1_mon_atk_def = new Array(10).fill(0);
    G.player2_mon_atk_def = new Array(10).fill(0);
    G.attacked = new Array(10).fill(0);

    G.field = 0;
    G.turn = 0;
    G.panel_lock = 0;
    G.dice_lock = 0;
    G.p1_life = 3;
    G.p2_life = 3;
    G.p1_punish = 0;
    G.p2_punish = 0;

    sprites.panel.size = 100;
    sprites.panel.x = 190;
    sprites.panel.y = -5;
    sprites.panel.comeToFront();
    sprites.panel.visible = true;

    spawnMonNumbers();

    sprites.go_to_field.size = 100;
    sprites.go_to_field.x = -165;
    sprites.go_to_field.y = -188;
    sprites.go_to_field.lookLike('造型1');
    sprites.go_to_field.comeToFront();
    sprites.go_to_field.visible = true;

    sprites.next_turn_btn.visible = false;
    updateStatusUI();
  }

  // Token List & Clone Rendering
  function renderTokenClones(player) {
    if (player === 1) {
      clones.p1_tokens = [];
      G.player1_token_list.forEach((val, idx) => {
        if (Number(val) === 0) return;
        const tk = new Sprite('token_player1', true);
        tk.lookLike(Number(val) % 10);
        tk.x = -220 + idx * 60;
        tk.y = 192;
        tk.vars.slotIndex = idx;
        tk.vars.tokenVal = Number(val);
        tk.comeToFront();
        tk.visible = true;
        tk.onClick = () => onClickPlayer1Token(tk);
        clones.p1_tokens.push(tk);
      });
    } else {
      clones.p2_tokens = [];
      G.player2_token_list.forEach((val, idx) => {
        if (Number(val) === 0) return;
        const tk = new Sprite('token_player2', true);
        tk.lookLike(Number(val) % 10);
        tk.x = 210 - idx * 60;
        tk.y = -192;
        tk.vars.slotIndex = idx;
        tk.vars.tokenVal = Number(val);
        tk.comeToFront();
        tk.visible = true;
        tk.onClick = () => onClickPlayer2Token(tk);
        clones.p2_tokens.push(tk);
      });
    }
  }

  function compactTokensAndRender() {
    G.player1_token_list = G.player1_token_list.filter((v) => Number(v) !== 0);
    G.player2_token_list = G.player2_token_list.filter((v) => Number(v) !== 0);
    renderTokenClones(1);
    renderTokenClones(2);
  }

  function addTokenToPlayer(player, tokenVal) {
    const list = player === 1 ? G.player1_token_list : G.player2_token_list;
    const activeCount = list.filter((v) => Number(v) > 0).length;
    if (activeCount >= 5 || list.length >= 5) {
      return false;
    }
    list.push(Number(tokenVal));
    renderTokenClones(player);
    return true;
  }

  // Panel & Dice Rolling Logic
  function rollNoSummon() {
    while (true) {
      const d1 = randInt(1, 6);
      const d2 = randInt(1, 6);
      const d3 = randInt(1, 6);
      const sCount = (d1 === 3 ? 1 : 0) + (d2 === 3 ? 1 : 0) + (d3 === 3 ? 1 : 0);
      if (sCount < 2) {
        G.dice_action = [d1, d2, d3];
        return;
      }
    }
  }

  function checkP1SummonGuarantee(turnTarget, minCount) {
    let k = 0;
    for (let i = 0; i < 5; i++) k += Number(G.summon_token_produced[i]);
    G.defense_done = (G.turn === turnTarget && k < minCount) ? 1 : 0;
  }

  function checkP2SummonGuarantee(turnTarget, minCount) {
    let k = 0;
    for (let i = 5; i < 10; i++) k += Number(G.summon_token_produced[i]);
    G.defense_done = (G.turn === turnTarget && k < minCount) ? 1 : 0;
  }

  function computeDiceForPlayer(isP1) {
    const sp = Number(G.curr_species);
    const offset = isP1 ? 0 : 5;
    const idx = offset + sp - 1;
    const used = Number(G.summon_token_produced[idx]);
    G.summon = 0;

    if (sp === 1) {
      if (used === 0 && randInt(1, 4) === 1) {
        G.dice_action = [3, 3, randInt(1, 6)];
        G.summon_token_produced[idx] += 1;
        G.summon = 1;
      } else rollNoSummon();
    } else if (sp === 2) {
      if ((used === 0 || used === 1) && randInt(1, 3) === 1) {
        G.dice_action = [3, randInt(1, 6), 3];
        G.summon_token_produced[idx] += 1;
        G.summon = 1;
      } else rollNoSummon();
    } else if (sp === 3) {
      if (used === 0) {
        const i = G.defense_done === 1 ? 1 : randInt(1, 2);
        if (i === 1) {
          G.dice_action = [randInt(1, 6), 3, 3];
          G.summon_token_produced[idx] += 1;
          G.summon = 1;
        } else rollNoSummon();
      } else if (used === 1) {
        if (randInt(1, 3) === 1) {
          G.dice_action = [randInt(1, 6), 3, 3];
          G.summon_token_produced[idx] += 1;
          G.summon = 1;
        } else rollNoSummon();
      } else rollNoSummon();
    } else if (sp === 4) {
      if (used === 0 || used === 1) {
        const i = G.defense_done === 1 ? 1 : randInt(1, 3);
        if (i !== 3) {
          G.dice_action = [3, randInt(1, 6), 3];
          G.summon_token_produced[idx] += 1;
          G.summon = 1;
        } else rollNoSummon();
      } else if (used === 2) {
        if (randInt(1, 2) === 1) {
          G.dice_action = [3, randInt(1, 6), 3];
          G.summon_token_produced[idx] += 1;
          G.summon = 1;
        } else rollNoSummon();
      } else rollNoSummon();
    } else if (sp === 5) {
      if (used === 0) {
        const i = G.defense_done === 1 ? 1 : randInt(1, 2);
        if (i === 1) {
          G.dice_action = [randInt(1, 6), 3, 3];
          G.summon_token_produced[idx] += 1;
          G.summon = 1;
        } else rollNoSummon();
      } else if (used === 1) {
        if (randInt(1, 2) === 1) {
          G.dice_action = [randInt(1, 6), 3, 3];
          G.summon_token_produced[idx] += 1;
          G.summon = 1;
        } else rollNoSummon();
      } else rollNoSummon();
    }
  }

  async function animateSingleDie(dieSprite, dieIdx, startX) {
    dieSprite.size = 75;
    dieSprite.x = startX;
    dieSprite.y = 0;
    const baseCos = (G.curr_species - 1) * 5;
    dieSprite.lookLike(baseCos + dieIdx);
    dieSprite.comeToFront();
    dieSprite.visible = true;

    for (let r = 0; r < 10; r++) {
      if (dieIdx === 1) playSound('diceroll');
      await sleep(50);
      dieSprite.nextCostume();
      if (dieSprite.costumeIndex >= G.curr_species * 5) {
        dieSprite.lookLike(baseCos + 1);
      }
    }

    const act = Number(G.dice_action[dieIdx - 1]);
    if (act === 5 || act === 6) {
      dieSprite.lookLike(G.curr_species * 5);
    } else {
      dieSprite.lookLike(baseCos + act);
    }

    if (act === 3 && G.summon === 1) {
      for (let f = 0; f < 5; f++) {
        await sleep(90);
        dieSprite.visible = false;
        await sleep(90);
        dieSprite.visible = true;
      }
      if (dieIdx === 1) G.dice1_done = 1;
      if (dieIdx === 2) G.dice2_done = 1;
      if (dieIdx === 3) G.dice3_done = 1;
    }
  }

  sprites.panel.onClick = async (mx, my) => {
    if (G.panel_lock !== 0 || G.dice_lock !== 0 || G.field !== 0) return;

    let chosenSpecies = 0;
    const isP1 = G.turn % 2 === 0;
    if (isP1 && G.p1_punish === 0) {
      if (mx > 155 && mx < 225) {
        if (my > 82 && my < 129) chosenSpecies = 1;
        else if (my > 28 && my < 76) chosenSpecies = 2;
        else if (my > -24 && my < 24) chosenSpecies = 3;
        else if (my > -76 && my < -30) chosenSpecies = 4;
        else if (my > -127 && my < -82) chosenSpecies = 5;
      }
    } else if (!isP1 && G.p2_punish === 0) {
      if (mx > -225 && mx < -155) {
        if (my > 82 && my < 129) chosenSpecies = 1;
        else if (my > 28 && my < 76) chosenSpecies = 2;
        else if (my > -24 && my < 24) chosenSpecies = 3;
        else if (my > -76 && my < -30) chosenSpecies = 4;
        else if (my > -127 && my < -82) chosenSpecies = 5;
      }
    }

    if (chosenSpecies === 0) return;

    G.panel_lock = 1;
    G.dice_lock = 1;
    G.curr_species = chosenSpecies;
    G.dice_action = [];
    G.defense_done = 0;

    if (isP1) {
      if (G.turn === 2) checkP1SummonGuarantee(2, 1);
      if (G.turn === 6) checkP1SummonGuarantee(6, 2);
      computeDiceForPlayer(true);
    } else {
      if (G.turn === 3) checkP2SummonGuarantee(3, 1);
      if (G.turn === 7) checkP2SummonGuarantee(7, 2);
      computeDiceForPlayer(false);
    }

    refreshMonNumbers();

    G.dice1_done = 0;
    G.dice2_done = 0;
    G.dice3_done = 0;

    await Promise.all([
      animateSingleDie(sprites.dice_1, 1, isP1 ? -150 : -80),
      animateSingleDie(sprites.dice_2, 2, isP1 ? -40 : 30),
      animateSingleDie(sprites.dice_3, 3, isP1 ? 70 : 140),
    ]);

    G.dice_lock = 0;

    if (G.summon > 0) {
      const tokenVal = G.curr_species * 10 + 5;
      const ok = addTokenToPlayer(isP1 ? 1 : 2, tokenVal);
      if (!ok) {
        await showMessage(12); // token_full
      }
    }
    updateStatusUI();
  };

  function setupDieClick(dieSprite, dieIdx) {
    dieSprite.onClick = async () => {
      if (G.dice_lock !== 0 || G.field !== 0) return;
      const doneKey = `dice${dieIdx}_done`;
      if (G[doneKey] !== 0) return;

      const act = Number(G.dice_action[dieIdx - 1]);
      let tokenType = 0;
      if (act === 5 || act === 6) tokenType = 4; // Move
      else if (act === 3) tokenType = 0;        // Star (not collectible individually)
      else if (act === 4) tokenType = 3;        // Trap
      else tokenType = act;                     // 1=Attack, 2=Defense

      if (tokenType === 0) return;

      const isP1 = G.turn % 2 === 0;
      const ok = addTokenToPlayer(isP1 ? 1 : 2, tokenType);
      if (ok) {
        G[doneKey] = 1;
        playSound('pop');
        dieSprite.ghost = 35;
      } else {
        await showMessage(12); // token_full
      }
    };
  }
  setupDieClick(sprites.dice_1, 1);
  setupDieClick(sprites.dice_2, 2);
  setupDieClick(sprites.dice_3, 3);

  // Switch between Panel and Field
  function enterFieldPhase() {
    G.field = 1;
    sprites.panel.visible = false;
    sprites.go_to_field.visible = false;
    sprites.dice_1.visible = false;
    sprites.dice_2.visible = false;
    sprites.dice_3.visible = false;
    sprites.dice_1.ghost = 0;
    sprites.dice_2.ghost = 0;
    sprites.dice_3.ghost = 0;
    clones.mon_numbers = [];

    G.player1_mon_atk_def = new Array(10).fill(0);
    G.player2_mon_atk_def = new Array(10).fill(0);
    G.attacked = new Array(10).fill(0);
    G.m1_lock = 0;
    G.m2_lock = 0;
    G.prepare1_lock = 0;
    G.prepare2_lock = 0;

    const isP1 = G.turn % 2 === 0;
    sprites.next_turn_btn.lookLike(isP1 ? '造型1' : '造型2');
    sprites.next_turn_btn.x = isP1 ? -175 : 175;
    sprites.next_turn_btn.y = isP1 ? -188 : 192;
    sprites.next_turn_btn.size = 100;
    sprites.next_turn_btn.comeToFront();
    sprites.next_turn_btn.visible = true;

    updateStatusUI();
  }

  sprites.go_to_field.onClick = () => {
    if (G.panel_lock === 1) {
      playSound('set');
      enterFieldPhase();
    }
  };

  // End Turn Button (Sprite1)
  sprites.next_turn_btn.onClick = async () => {
    if (G.field !== 1) return;
    // Clear any ongoing speech bubbles or temporary combat UI
    clones.p1_monster.forEach((m) => (m.sayText = ''));
    clones.p2_monster.forEach((m) => (m.sayText = ''));
    sprites.player1_font.visible = false;
    sprites.player2_font.visible = false;
    G.curr_action_1 = 0;
    G.curr_action_2 = 0;
    G.dice_grid_num = 0;
    G.defense_done = 0;
    G.t1_lock = 0;
    G.t2_lock = 0;
    G.m1_lock = 0;
    G.m2_lock = 0;

    compactTokensAndRender();
    G.turn += 1;
    G.field = 0;
    playSound('nextturn');
    sprites.next_turn_btn.visible = false;
    await enterPanelPhase();
  };

  async function enterPanelPhase() {
    G.summon = 0;
    G.panel_lock = 0;
    const isP1 = G.turn % 2 === 0;
    sprites.panel.x = isP1 ? 190 : -190;
    sprites.panel.y = -5;
    sprites.panel.size = 100;
    sprites.panel.comeToFront();
    sprites.panel.visible = true;

    sprites.go_to_field.lookLike(isP1 ? '造型1' : '造型2');
    sprites.go_to_field.x = isP1 ? -170 : 175;
    sprites.go_to_field.y = isP1 ? -188 : 192;
    sprites.go_to_field.size = 100;
    sprites.go_to_field.comeToFront();
    sprites.go_to_field.visible = true;

    spawnMonNumbers();
    updateStatusUI();

    if (isP1 && G.p1_punish === 1) {
      await showMessage(22); // block_throw
      G.p1_punish = 0;
      enterFieldPhase();
    } else if (!isP1 && G.p2_punish === 1) {
      await showMessage(22); // block_throw
      G.p2_punish = 0;
      enterFieldPhase();
      if (aiEnabled) triggerAITurn();
    } else if (!isP1 && aiEnabled) {
      triggerAITurn();
    }
  }

  // Helper: Check if player has any monster alive
  function hasMonsterAlive(player) {
    for (let r = 1; r <= 13; r++) {
      for (let c = 1; c <= 19; c++) {
        const val = getCell(r, c);
        if (val > 10) {
          const rem = val % 10;
          if (player === 1 && (rem === 1 || rem === 3)) return true;
          if (player === 2 && (rem === 2 || rem === 4)) return true;
        }
      }
    }
    return false;
  }

  function hasEmptyTerritory(player) {
    const target = player === 1 ? 1 : 2;
    for (let r = 1; r <= 13; r++) {
      for (let c = 1; c <= 19; c++) {
        if (getCell(r, c) === target) return true;
      }
    }
    return false;
  }

  function consumeToken(player, tokenSprite) {
    const idx = tokenSprite.vars.slotIndex;
    if (player === 1) G.player1_token_list[idx] = 0;
    else G.player2_token_list[idx] = 0;
    tokenSprite.ghost = 50;
  }

  // Original 1~6 equal probability (1/6 = 16.7% each) for Trap token
  function rollSmartTrapEffect() {
    return randInt(1, 6);
  }

  //Player 1 Token Click Handler
  async function onClickPlayer1Token(tk) {
    if (G.field !== 1) return;
    // Allow clicking an already-activated Move, Attack, or Defense token a second time to cancel/discard it!
    if (G.t1_lock === 1 && G.activeToken1 === tk && !G.movingState && !G.targetMonsterResolver) {
      if (G.curr_action_1 === 4 || G.curr_action_1 === 1 || (G.curr_action_1 === 2 && G.turn % 2 === 0)) {
        playSound('coinflip');
        consumeToken(1, tk);
        G.activeToken1 = null;
        G.curr_action_1 = 0;
        G.t1_lock = 0;
        updateStatusUI('🗑️ 已主動丟棄 1 枚徽章，騰出空間！');
        return;
      } else if (G.curr_action_1 === 2) {
        // Cancel defense activation on opponent's turn without consuming
        tk.colorEffect = 0;
        G.activeToken1 = null;
        G.curr_action_1 = 0;
        G.t1_lock = 0;
        updateStatusUI('已取消防禦印記選取。');
        return;
      }
    }
    if (G.t1_lock !== 0) return;
    const slotIdx = tk.vars.slotIndex;
    const rawVal = Number(G.player1_token_list[slotIdx]);
    if (!rawVal) return;

    const isP1Turn = G.turn % 2 === 0;
    const cosIdx = tk.costumeIndex; // 1:Atk, 2:Def, 3:Trap, 4:Mov, 5:Summon

    if (isP1Turn) {
      G.t1_lock = 1;
      G.activeToken1 = tk;
      if (cosIdx === 5) {
        // Summon
        playSound('coinflip');
        tk.colorEffect = 25;
        G.grid_created = [];
        G.curr_action_1 = 5;
        G.dice_grid_num = 0;
        G.defense_done = 0;
        G.summon = Math.floor(rawVal / 10);
        updateStatusUI();
      } else if (cosIdx === 4) {
        // Move
        if (hasMonsterAlive(1)) {
          playSound('coinflip');
          tk.colorEffect = 25;
          G.dice_grid_num = 0;
          G.curr_action_1 = 4;
          updateStatusUI();
        } else {
          await showMessage(13); // invalid
          consumeToken(1, tk);
          G.activeToken1 = null;
          G.curr_action_1 = 0;
          G.t1_lock = 0;
        }
      } else if (cosIdx === 1) {
        // Attack
        if (hasMonsterAlive(1)) {
          playSound('coinflip');
          tk.colorEffect = 25;
          G.atk_success = 0;
          G.dice_grid_num = 0;
          G.curr_action_1 = 1;
          updateStatusUI();
        } else {
          await showMessage(13);
          consumeToken(1, tk);
          G.activeToken1 = null;
          G.curr_action_1 = 0;
          G.t1_lock = 0;
        }
      } else if (cosIdx === 2) {
        // NEW RULE 4: Using Defense token on own turn attaches a Protective Shield to an allied monster!
        if (hasMonsterAlive(1)) {
          playSound('coinflip');
          tk.colorEffect = 25;
          G.curr_action_1 = 2;
          updateStatusUI();
        } else {
          // No monster alive: discard defense token without penalty!
          playSound('coinflip');
          consumeToken(1, tk);
          G.activeToken1 = null;
          G.curr_action_1 = 0;
          G.t1_lock = 0;
          updateStatusUI('🗑️ 場上無怪獸，已將防禦徽章丟棄騰出空間！');
        }
      } else if (cosIdx === 3) {
        // Trap token
        if (hasMonsterAlive(1)) {
          playSound('coinflip');
          tk.colorEffect = 25;
          G.curr_action_1 = 3;
          G.dice_grid_num = 0;
          const effect = rollSmartTrapEffect(2);
          G.defense_done = effect;

          let hasTarget = false;
          if (effect === 1) hasTarget = hasMonsterAlive(2);
          if (effect === 2) hasTarget = hasEmptyTerritory(2);

          await showMessage(effect === 6 ? 13 : effect);

          if (effect === 1 || effect === 2) {
            if (hasTarget) {
              // Wait for user to click enemy monster (effect 1) or enemy grid (effect 2)
              updateStatusUI(effect === 1 ? '【陷阱：破壞怪獸】請點擊場上一隻敵方怪獸將其破壞！' : '【陷阱：破壞領地】請點擊場上一個沒有怪獸的敵方領地格將其破壞！');
              return; // Keep t1_lock = 1 and activeToken1 = tk until target clicked
            } else {
              await showMessage(13);
            }
          } else if (effect >= 3 && effect <= 5) {
            const newType = effect === 3 ? 1 : (effect === 4 ? 2 : 4);
            consumeToken(1, tk);
            G.activeToken1 = null;
            // Compact first so the slot just freed by the trap token can immediately hold the newly drawn token!
            G.player1_token_list = G.player1_token_list.filter((v) => Number(v) !== 0);
            if (G.player1_token_list.length < 5) {
              G.player1_token_list.push(newType);
              renderTokenClones(1);
            } else {
              await showMessage(12);
            }
            G.curr_action_1 = 0;
            G.t1_lock = 0;
            updateStatusUI();
            return;
          }
          consumeToken(1, tk);
          G.activeToken1 = null;
          G.curr_action_1 = 0;
          G.t1_lock = 0;
          updateStatusUI();
        } else {
          await showMessage(13);
          consumeToken(1, tk);
          G.activeToken1 = null;
          G.curr_action_1 = 0;
          G.t1_lock = 0;
        }
      }
    } else {
      // Opponent's turn: Player 1 can only click Defense token (cosIdx === 2)
      if (cosIdx === 2) {
        G.t1_lock = 1;
        if (hasMonsterAlive(1)) {
          playSound('coinflip');
          tk.colorEffect = 25;
          G.defense_done = 0;
          G.curr_action_1 = 2;
          G.activeToken1 = tk;
          updateStatusUI('【防禦印記】請玩家 1 點擊要增加防禦力的己方怪獸！');
        } else {
          await showMessage(13);
          G.t1_lock = 0;
        }
      }
    }
  }

  // Player 2 Token Click Handler
  async function onClickPlayer2Token(tk) {
    if (G.field !== 1) return;
    // Allow clicking an already-activated Move, Attack, or Defense token a second time to discard it!
    if (G.t2_lock === 1 && G.activeToken2 === tk && (G.curr_action_2 === 4 || G.curr_action_2 === 1 || (G.curr_action_2 === 2 && G.turn % 2 === 1)) && !G.movingState && !G.targetMonsterResolver) {
      playSound('coinflip');
      consumeToken(2, tk);
      G.activeToken2 = null;
      G.curr_action_2 = 0;
      G.t2_lock = 0;
      updateStatusUI('🗑️ 已主動丟棄 1 枚徽章，騰出空間！');
      return;
    }
    if (G.t2_lock !== 0) return;
    const slotIdx = tk.vars.slotIndex;
    const rawVal = Number(G.player2_token_list[slotIdx]);
    if (!rawVal) return;

    const isP2Turn = G.turn % 2 === 1;
    const cosIdx = tk.costumeIndex;

    if (isP2Turn) {
      G.t2_lock = 1;
      G.activeToken2 = tk;
      if (cosIdx === 5) {
        playSound('coinflip');
        tk.colorEffect = 25;
        G.grid_created = [];
        G.curr_action_2 = 5;
        G.dice_grid_num = 0;
        G.defense_done = 0;
        G.summon = Math.floor(rawVal / 10);
        updateStatusUI();
      } else if (cosIdx === 4) {
        if (hasMonsterAlive(2)) {
          playSound('coinflip');
          tk.colorEffect = 25;
          G.dice_grid_num = 0;
          G.curr_action_2 = 4;
          updateStatusUI();
        } else {
          await showMessage(13);
          consumeToken(2, tk);
          G.activeToken2 = null;
          G.curr_action_2 = 0;
          G.t2_lock = 0;
        }
      } else if (cosIdx === 1) {
        if (hasMonsterAlive(2)) {
          playSound('coinflip');
          tk.colorEffect = 25;
          G.atk_success = 0;
          G.dice_grid_num = 0;
          G.curr_action_2 = 1;
          updateStatusUI();
        } else {
          await showMessage(13);
          consumeToken(2, tk);
          G.activeToken2 = null;
          G.curr_action_2 = 0;
          G.t2_lock = 0;
        }
      } else if (cosIdx === 2) {
        // NEW RULE 4: Using Defense token on own turn attaches a Protective Shield to an allied monster!
        if (hasMonsterAlive(2)) {
          playSound('coinflip');
          tk.colorEffect = 25;
          G.curr_action_2 = 2;
          updateStatusUI();
        } else {
          playSound('coinflip');
          consumeToken(2, tk);
          G.activeToken2 = null;
          G.curr_action_2 = 0;
          G.t2_lock = 0;
        }
      } else if (cosIdx === 3) {
        if (hasMonsterAlive(2)) {
          playSound('coinflip');
          tk.colorEffect = 25;
          G.curr_action_2 = 3;
          G.dice_grid_num = 0;
          const effect = rollSmartTrapEffect(1);
          G.defense_done = effect;

          let hasTarget = false;
          if (effect === 1) hasTarget = hasMonsterAlive(1);
          if (effect === 2) hasTarget = hasEmptyTerritory(1);

          await showMessage(effect === 6 ? 13 : effect);

          if (effect === 1 || effect === 2) {
            if (hasTarget) {
              updateStatusUI(effect === 1 ? '【陷阱：破壞怪獸】請點擊場上一隻敵方怪獸將其破壞！' : '【陷阱：破壞領地】請點擊場上一個沒有怪獸的敵方領地格將其破壞！');
              return;
            } else {
              await showMessage(13);
            }
          } else if (effect >= 3 && effect <= 5) {
            const newType = effect === 3 ? 1 : (effect === 4 ? 2 : 4);
            consumeToken(2, tk);
            G.activeToken2 = null;
            G.player2_token_list = G.player2_token_list.filter((v) => Number(v) !== 0);
            if (G.player2_token_list.length < 5) {
              G.player2_token_list.push(newType);
              renderTokenClones(2);
            } else {
              await showMessage(12);
            }
            G.curr_action_2 = 0;
            G.t2_lock = 0;
            updateStatusUI();
            return;
          }
          consumeToken(2, tk);
          G.activeToken2 = null;
          G.curr_action_2 = 0;
          G.t2_lock = 0;
          updateStatusUI();
        } else {
          await showMessage(13);
          consumeToken(2, tk);
          G.activeToken2 = null;
          G.curr_action_2 = 0;
          G.t2_lock = 0;
        }
      }
    } else {
      if (cosIdx === 2) {
        G.t2_lock = 1;
        if (hasMonsterAlive(2)) {
          playSound('coinflip');
          tk.colorEffect = 25;
          G.defense_done = 0;
          G.curr_action_2 = 2;
          G.activeToken2 = tk;
          updateStatusUI('【防禦印記】請玩家 2 點擊要增加防禦力的己方怪獸！');
        } else {
          await showMessage(13);
          G.t2_lock = 0;
        }
      }
    }
  }

  function finishTokenAction(player) {
    if (player === 1) {
      if (G.activeToken1) consumeToken(1, G.activeToken1);
      G.activeToken1 = null;
      G.curr_action_1 = 0;
      G.t1_lock = 0;
    } else {
      if (G.activeToken2) consumeToken(2, G.activeToken2);
      G.activeToken2 = null;
      G.curr_action_2 = 0;
      G.t2_lock = 0;
    }
    updateStatusUI();
  }

  // Field Click -> Summon 6 Tiles + Monster (Action 5)
  // Helper: Check if an empty cell (startR, startC) is adjacent to own territory AND has an empty connected component of >= 6 cells!
  function canExpandSixFrom(startR, startC, isP1) {
    if (getCell(startR, startC) !== 0) return false;
    const neighbors = [
      getCell(startR - 1, startC),
      getCell(startR + 1, startC),
      getCell(startR, startC - 1),
      getCell(startR, startC + 1),
    ];
    const validAdj = neighbors.some((val) => {
      if (val < 0) return false;
      const rem = val % 10;
      return isP1 ? (rem === 1 || rem === 4) : (rem === 2 || rem === 3);
    });
    if (!validAdj) return false;

    // BFS to count connected empty cells (need at least 6 connected empty cells so it's not a trapped pocket!)
    const visited = new Set([`${startR},${startC}`]);
    const queue = [{ r: startR, c: startC }];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    while (queue.length > 0 && visited.size < 6) {
      const cur = queue.shift();
      for (const [dr, dc] of dirs) {
        const nr = cur.r + dr;
        const nc = cur.c + dc;
        const key = `${nr},${nc}`;
        if (nr >= 1 && nr <= 13 && nc >= 1 && nc <= 19 && !visited.has(key) && getCell(nr, nc) === 0) {
          visited.add(key);
          queue.push({ r: nr, c: nc });
          if (visited.size >= 6) return true;
        }
      }
    }
    return visited.size >= 6;
  }

  function checkDeadlock() {
    const numPairs = G.grid_created.length / 2;
    for (let k = 1; k <= numPairs; k++) {
      const r = G.grid_created[2 * k - 2];
      const c = G.grid_created[2 * k - 1];
      let openNeighbors = 0;
      if (r > 1 && getCell(r - 1, c) === 0) openNeighbors++;
      if (r < 13 && getCell(r + 1, c) === 0) openNeighbors++;
      if (c > 1 && getCell(r, c - 1) === 0) openNeighbors++;
      if (c < 19 && getCell(r, c + 1) === 0) openNeighbors++;
      if (openNeighbors === 0 && !G.deadlock_list.includes(k)) {
        G.deadlock_list.push(k);
      }
    }
  }

  sprites.field.onClick = async (mx, my) => {
    if (G.field !== 1) return;
    const isP1 = G.turn % 2 === 0;
    const act = isP1 ? G.curr_action_1 : G.curr_action_2;
    if (act !== 5) return;

    // Determine clicked row (1..13) and col (1..19)
    let clickedRow = 13;
    for (let i = 0; i < 12; i++) {
      if (my <= Y_MODIFIED[i] && my > Y_MODIFIED[i + 1]) {
        clickedRow = i + 1;
        break;
      }
    }
    if (my > Y_MODIFIED[0]) clickedRow = 1;

    let clickedCol = 19;
    for (let i = 0; i < 18; i++) {
      if (mx >= X_MODIFIED[i] && mx < X_MODIFIED[i + 1]) {
        clickedCol = i + 1;
        break;
      }
    }
    if (mx < X_MODIFIED[0]) clickedCol = 1;

    // Check if target cell is valid expansion start (empty, adjacent to own territory, and has >= 6 connected empty cells)
    if (!canExpandSixFrom(clickedRow, clickedCol, isP1)) {
      await showMessage(20); // cant_make_road
      finishTokenAction(isP1 ? 1 : 2);
      return;
    }

    // Generate 6 connected territory tiles via Scratch random walk algorithm
    // Retry up to 15 times if a random branch hits a local dead-end, since we already proved >= 6 connected empty cells exist!
    const backupBoard = [...G.field_occupied];
    const ownerVal = isP1 ? 1 : 2;
    let successWalk = false;

    for (let attempt = 0; attempt < 15; attempt++) {
      G.field_occupied = [...backupBoard];
      G.grid_created = [clickedRow, clickedCol];
      G.deadlock_list = [];
      setCell(clickedRow, clickedCol, ownerVal);
      let r = clickedRow;
      let c = clickedCol;
      let countTiles = 1;
      let deadlocked = false;

      while (countTiles < 6) {
        const prevLen = G.grid_created.length;
        if (countTiles < 6 && randInt(1, 4) !== 4 && r > 1 && getCell(r - 1, c) === 0) {
          G.grid_created.push(r - 1, c);
          setCell(r - 1, c, ownerVal);
          countTiles++;
        }
        if (countTiles < 6 && randInt(1, 4) !== 4 && r < 13 && getCell(r + 1, c) === 0) {
          G.grid_created.push(r + 1, c);
          setCell(r + 1, c, ownerVal);
          countTiles++;
        }
        if (countTiles < 6 && randInt(1, 2) === 1 && c > 1 && getCell(r, c - 1) === 0) {
          G.grid_created.push(r, c - 1);
          setCell(r, c - 1, ownerVal);
          countTiles++;
        }
        if (countTiles < 6 && randInt(1, 2) === 1 && c < 19 && getCell(r, c + 1) === 0) {
          G.grid_created.push(r, c + 1);
          setCell(r, c + 1, ownerVal);
          countTiles++;
        }

        checkDeadlock();
        if (G.deadlock_list.length * 2 === G.grid_created.length) {
          deadlocked = true;
          break;
        } else if (prevLen > 2 && countTiles < 6) {
          let pickIdx = randInt(1, 2) === 1 ? 2 : Math.ceil(randInt(1, G.grid_created.length) / 2);
          if (pickIdx > G.grid_created.length / 2) pickIdx = G.grid_created.length / 2;
          if (!G.deadlock_list.includes(pickIdx)) {
            r = G.grid_created[2 * pickIdx - 2];
            c = G.grid_created[2 * pickIdx - 1];
          } else {
            // Pick any non-deadlocked tile in grid_created
            for (let k = 1; k <= G.grid_created.length / 2; k++) {
              if (!G.deadlock_list.includes(k)) {
                r = G.grid_created[2 * k - 2];
                c = G.grid_created[2 * k - 1];
                break;
              }
            }
          }
        }
      }

      if (!deadlocked && G.grid_created.length === 12) {
        successWalk = true;
        break;
      }
    }

    if (!successWalk) {
      G.field_occupied = backupBoard;
      G.grid_created = [];
      await showMessage(20); // cant_make_road
      finishTokenAction(isP1 ? 1 : 2);
      return;
    }

    // Spawn 6 territory tile clones
    G.summon_row = G.grid_created[4];
    G.summon_column = G.grid_created[5];

    for (let j = 1; j <= 6; j++) {
      const tr = G.grid_created[2 * j - 2];
      const tc = G.grid_created[2 * j - 1];
      const tile = new Sprite(isP1 ? 'player1_occupied' : 'player2_occupied', true);
      tile.size = 100;
      tile.x = X_MODIFIED[tc - 1];
      tile.y = Y_MODIFIED[tr - 1];
      tile.vars.row = tr;
      tile.vars.col = tc;
      tile.vars.myID = tr * 100 + tc;
      tile.comeToFront();
      tile.visible = true;
      tile.onClick = () => onClickOccupiedTile(isP1 ? 1 : 2, tile);
      if (isP1) clones.p1_occupied.push(tile);
      else clones.p2_occupied.push(tile);
    }

    // Spawn Monster on 3rd tile (summon_row, summon_column)
    spawnMonster(isP1 ? 1 : 2, G.summon, G.summon_row, G.summon_column);
    finishTokenAction(isP1 ? 1 : 2);
  };

  // Occupied Tile Click Handler (Move destination or Trap Destroy Grid)
  async function onClickOccupiedTile(tileOwner, tileSprite) {
    if (G.field !== 1) return;
    const tr = tileSprite.vars.row;
    const tc = tileSprite.vars.col;

    // Case 1: Moving a monster (curr_action_1 === 4 or curr_action_2 === 4)
    if (G.curr_action_1 === 4 || G.curr_action_2 === 4) {
      G.row = tr;
      G.column = tc;
      await flashGridFrame(tc, tr);
      if (G.moveStepResolver) {
        const res = G.moveStepResolver;
        G.moveStepResolver = null;
        res({ row: tr, col: tc });
      }
      return;
    }

    // Case 2: Trap effect 2 (Destroy enemy empty territory tile)
    const isP1Turn = G.turn % 2 === 0;
    if (isP1Turn && tileOwner === 2 && G.curr_action_1 === 3 && G.defense_done === 2) {
      if (getCell(tr, tc) === 2) {
        setCell(tr, tc, 0);
        playSound('damage');
        clones.p2_occupied = clones.p2_occupied.filter((t) => t !== tileSprite);
        finishTokenAction(1);
      } else {
        await showMessage(13);
        finishTokenAction(1);
      }
    } else if (!isP1Turn && tileOwner === 1 && G.curr_action_2 === 3 && G.defense_done === 2) {
      if (getCell(tr, tc) === 1) {
        setCell(tr, tc, 0);
        playSound('damage');
        clones.p1_occupied = clones.p1_occupied.filter((t) => t !== tileSprite);
        finishTokenAction(2);
      } else {
        await showMessage(13);
        finishTokenAction(2);
      }
    }
  }

  // Spawn Monster Clone
  function getMonsterCostumeIndex(species, instanceNum) {
    if (species === 1) return 1; // dragon
    if (species === 2) return instanceNum === 1 ? 2 : 3; // magician_1, 2
    if (species === 3) return instanceNum === 1 ? 4 : 5; // warrior_1, 2
    if (species === 4) return instanceNum === 1 ? 6 : (instanceNum === 2 ? 7 : 8); // beast_1, 2, 3
    if (species === 5) return instanceNum === 1 ? 9 : 10; // ghost_1, 2
    return 1;
  }

  function spawnMonster(player, species, row, col) {
    const monField = player === 1 ? G.player1_mon_field : G.player2_mon_field;
    monField[species - 1] += 1;
    const instNum = monField[species - 1];
    const cosIdx = getMonsterCostumeIndex(species, instNum);

    const cellCode = cosIdx * 10 + (player === 1 ? 1 : 2);
    setCell(row, col, cellCode);

    const mon = new Sprite(player === 1 ? 'player1_monster' : 'player2_monster', true);
    mon.size = 100;
    mon.lookLike(cosIdx);
    mon.x = 11 + X_MODIFIED[col - 1];
    mon.y = -15 + Y_MODIFIED[row - 1];
    mon.vars.myID = cosIdx;
    mon.vars.row = row;
    mon.vars.col = col;
    mon.vars.player = player;
    mon.vars.shielded = false;
    playSound('summon');
    mon.comeToFront();
    mon.visible = true;

    mon.onClick = () => onClickMonster(mon);
    if (player === 1) clones.p1_monster.push(mon);
    else clones.p2_monster.push(mon);

    // Check if monster landed directly on a Mystery Treasure Chest!
    checkChestPickup(player, mon, row, col);
  }

  async function checkChestPickup(player, mon, row, col) {
    const idx = G.treasure_chests.findIndex((ch) => ch.row === row && ch.col === col);
    if (idx === -1) return;
    G.treasure_chests.splice(idx, 1);
    playSound('specialsummon');

    const reward = randInt(1, 3);
    const pName = player === 1 ? '玩家 1 (紅方)' : '玩家 2 (藍方)';
    if (reward === 1) {
      // Reward 1: +1 Life Heart (up to 4) + Shield
      if (player === 1) G.p1_life = Math.min(4, G.p1_life + 1);
      else G.p2_life = Math.min(4, G.p2_life + 1);
      mon.vars.shielded = true;
      mon.sayText = '💎生命+1 & 護盾!';
      updateStatusUI(`💎 ${pName} 拾獲神秘寶箱！【生命祝福】：生命值 +1 顆心 ❤️，且怪獸獲得護盾 🛡️！`);
    } else if (reward === 2) {
      // Reward 2: Monster gets Shield + player gets 1 Attack & 1 Move token (if space allows)
      mon.vars.shielded = true;
      const list = player === 1 ? G.player1_token_list : G.player2_token_list;
      const compacted = list.filter((v) => Number(v) !== 0);
      if (compacted.length < 5) compacted.push(1);
      if (compacted.length < 5) compacted.push(4);
      if (player === 1) G.player1_token_list = compacted;
      else G.player2_token_list = compacted;
      renderTokenClones(player);
      mon.sayText = '💎戰神祝福!';
      updateStatusUI(`💎 ${pName} 拾獲神秘寶箱！【戰神祝福】：怪獸獲得護盾 🛡️，並額外獲得攻擊與移動徽章！`);
    } else {
      // Reward 3: Gain a free Summon token for an available species (or Attack+Move if all summoned)
      const offset = player === 1 ? 0 : 5;
      let availSp = 0;
      for (const sp of [1, 3, 2, 5, 4]) {
        if (Number(G.summon_token_produced[offset + sp - 1]) < SPECIES_MAX[sp]) {
          availSp = sp;
          break;
        }
      }
      const list = player === 1 ? G.player1_token_list : G.player2_token_list;
      const compacted = list.filter((v) => Number(v) !== 0);
      if (availSp > 0 && compacted.length < 5) {
        G.summon_token_produced[offset + availSp - 1] += 1;
        compacted.push(availSp * 10 + 5);
        if (player === 1) G.player1_token_list = compacted;
        else G.player2_token_list = compacted;
        renderTokenClones(player);
        mon.sayText = '💎獲得召喚徽章!';
        updateStatusUI(`💎 ${pName} 拾獲神秘寶箱！【召喚祝福】：直接獲得 1 枚${SPECIES_NAMES[availSp]}召喚徽章 ⭐！`);
      } else {
        mon.vars.shielded = true;
        if (compacted.length < 5) compacted.push(1);
        if (player === 1) G.player1_token_list = compacted;
        else G.player2_token_list = compacted;
        renderTokenClones(player);
        mon.sayText = '💎護盾&攻擊!';
        updateStatusUI(`💎 ${pName} 拾獲神秘寶箱！怪獸獲得護盾 🛡️ 並獲得攻擊徽章！`);
      }
    }
    setTimeout(() => {
      if (mon.sayText && mon.sayText.startsWith('💎')) mon.sayText = '';
    }, 2200);
  }

  function getBaseAtk(cosIdx) {
    if (cosIdx === 9 || cosIdx === 10) return 1; // Ghost: 500
    if (cosIdx === 4 || cosIdx === 5) return 3;  // Warrior: 1500
    return 2;                                    // Dragon, Magician, Beast: 1000
  }

  function getBaseDef(cosIdx) {
    if (cosIdx >= 6 && cosIdx <= 8) return 1;    // Beast: 500
    if (cosIdx === 1 || cosIdx === 4 || cosIdx === 5) return 2; // Dragon, Warrior: 1000
    return 3;                                    // Magician, Ghost: 1500
  }

  function getMoveRange(cosIdx) {
    if (cosIdx === 1) return 3;                  // Dragon: 3
    if (cosIdx === 2 || cosIdx === 3 || cosIdx === 9 || cosIdx === 10) return 2; // Magician, Ghost: 2
    return 1;                                    // Warrior, Beast: 1
  }

  // Transfer Door (Random Warp 1/6 chance when territory exists 5 columns ahead)
  function checkTransferDoor(player, startRow, startCol) {
    const checkCol = player === 1 ? startCol + 5 : startCol - 5;
    if (checkCol < 1 || checkCol > 19) return null;

    let hasAhead = false;
    for (let r = 1; r <= 13; r++) {
      const v = getCell(r, checkCol);
      if (v === 1 || v === 2) {
        hasAhead = true;
        break;
      }
    }
    if (!hasAhead) return null;
    if (randInt(1, 6) !== 1) return null;

    // Find valid empty territory cell in range
    const candidates = [];
    for (let dr = -4; dr <= 4; dr++) {
      const dcMin = player === 1 ? 2 : -5;
      const dcMax = player === 1 ? 5 : -2;
      for (let dc = dcMin; dc <= dcMax; dc++) {
        const nr = startRow + dr;
        const nc = startCol + dc;
        const v = getCell(nr, nc);
        if (v === 1 || v === 2) candidates.push({ row: nr, col: nc });
      }
    }
    if (candidates.length === 0) return null;
    return candidates[randInt(0, candidates.length - 1)];
  }

  // Monster Click Handler (Attack, Defend, Move, Trap Destroy)
  async function onClickMonster(mon) {
    if (G.field !== 1) return;
    const isP1Turn = G.turn % 2 === 0;
    const player = mon.vars.player;
    const cosIdx = mon.costumeIndex;

    // 1. Own Monster Clicked on Own Turn
    if ((isP1Turn && player === 1) || (!isP1Turn && player === 2)) {
      const lockKey = player === 1 ? 'm1_lock' : 'm2_lock';
      if (G[lockKey] !== 0) return;
      const act = player === 1 ? G.curr_action_1 : G.curr_action_2;

      // --- ACTION 1: ATTACK ---
      if (act === 1) {
        G[lockKey] = 1;
        const atkList = player === 1 ? G.player1_mon_atk_def : G.player2_mon_atk_def;
        let isFirstAttack = false;
        if (Number(atkList[cosIdx - 1]) === 0) {
          atkList[cosIdx - 1] = getBaseAtk(cosIdx);
          isFirstAttack = true;
        } else {
          atkList[cosIdx - 1] += 1;
          isFirstAttack = false;
        }

        const r = mon.vars.row;
        const c = mon.vars.col;

        // Check direct base attack!
        const atEnemyBase = player === 1
          ? ((r === 7 && c === 18) || (r === 6 && c === 19) || (r === 8 && c === 19))
          : ((r === 7 && c === 2) || (r === 6 && c === 1) || (r === 8 && c === 1));

        if (atEnemyBase) {
          playSound('attack');
          if (player === 1) {
            await showMessage(14); // p1_atk_p2
            G.p2_life -= 1;
            await showP2LifePopup();
            if (G.p2_life <= 0) {
              await showMessage(16); // p1_wins
            }
          } else {
            await showMessage(15); // p2_atk_p1
            G.p1_life -= 1;
            await showP1LifePopup();
            if (G.p1_life <= 0) {
              await showMessage(17); // p2_wins
            }
          }
          G[lockKey] = 0;
          finishTokenAction(player);
          return;
        }

        if (isFirstAttack) {
          await showMessage(19); // choose_attacked
          updateStatusUI('【選擇攻擊目標】請點擊相鄰（上下左右）的一隻敵方怪獸！');

          // Wait for player to click an enemy monster
          const targetMon = await new Promise((resolve) => {
            G.targetMonsterResolver = resolve;
          });

          const tr = targetMon.vars.row;
          const tc = targetMon.vars.col;
          const isAdj = (Math.abs(tr - r) + Math.abs(tc - c)) === 1;

          if (isAdj) {
            G.attacked[cosIdx - 1] = targetMon.vars.myID;
            G.summon_row = r;
            G.summon_column = c;
            G.row = tr;
            G.column = tc;
            flashSword(c, r);
            flashShield(tc, tr);
            mon.sayText = `攻擊力${atkList[cosIdx - 1] * 500}`;

            // If targetMon has an active Protective Shield (Rule 4), automatically activate its base defense!
            const defList = player === 1 ? G.player2_mon_atk_def : G.player1_mon_atk_def;
            if (targetMon.vars.shielded) {
              targetMon.vars.shielded = false;
              defList[targetMon.costumeIndex - 1] = getBaseDef(targetMon.costumeIndex);
              targetMon.sayText = `🛡️護盾防禦${defList[targetMon.costumeIndex - 1] * 500}`;
            }

            // Show Prepare buttons for both players
            showPrepareButtons();
            updateStatusUI('【決鬥準備】雙方可繼續點擊攻擊/防禦印記強化怪獸，完成後請雙方點擊畫面下方的「Prepare」按鈕進行結算！');
          } else {
            // Invalid target: reset atkList
            for (let i = 0; i < 10; i++) atkList[i] = 0;
            await showMessage(13); // invalid
          }
          G[lockKey] = 0;
          finishTokenAction(player);
        } else {
          // Stacked attack token!
          mon.sayText = `攻擊力${atkList[cosIdx - 1] * 500}`;
          G[lockKey] = 0;
          finishTokenAction(player);
        }
      }

      // --- ACTION 4: MOVE ---
      else if (act === 4) {
        G[lockKey] = 1;
        const maxSteps = getMoveRange(cosIdx);
        const startRow = mon.vars.row;
        const startCol = mon.vars.col;
        let curRow = startRow;
        let curCol = startCol;
        const path = [{ row: startRow, col: startCol }];
        let failed = false;

        G.movingState = {
          player,
          maxSteps,
          curStep: 1,
          curRow,
          curCol,
          path,
        };

        for (let step = 0; step < maxSteps; step++) {
          // If step > 0, check if there are any valid adjacent tiles to continue moving
          if (step > 0) {
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            const hasMoreSteps = dirs.some(([dr, dc]) => {
              const nr = curRow + dr;
              const nc = curCol + dc;
              const cv = getCell(nr, nc);
              if (cv < 0) return false;
              const rem = cv % 10;
              return (cv === 1 || cv === 2) ||
                (cv > 10 && (player === 1 ? (rem === 1 || rem === 3) : (rem === 2 || rem === 4)));
            });
            if (!hasMoreSteps) break;
          }

          G.movingState.curStep = step + 1;
          G.movingState.curRow = curRow;
          G.movingState.curCol = curCol;
          mon.sayText = step === 0 ? `可移動1~${maxSteps}格` : `第${step + 1}步(點同格停)`;
          updateStatusUI(
            step === 0
              ? `【怪獸移動：第 1 步 / 最多 ${maxSteps} 步】請點擊黃色箭頭的相鄰領地格前進！`
              : `【怪獸移動：第 ${step + 1} 步 / 最多 ${maxSteps} 步】請點擊下一個黃色箭頭格繼續移動，或「再次點擊目前所在的第 ${step} 步格子（✓）」直接停在該格！`
          );
          const nextPos = await new Promise((resolve) => {
            G.moveStepResolver = resolve;
          });
          mon.sayText = '';

          const nr = nextPos.row;
          const nc = nextPos.col;

          // If player already moved at least 1 step and clicked the current destination cell again -> stop here!
          if (step > 0 && nr === curRow && nc === curCol) {
            break;
          }

          const isAdj = (Math.abs(nr - curRow) + Math.abs(nc - curCol)) === 1;
          if (!isAdj) {
            if (step > 0) {
              // Stop at current valid step instead of failing!
              break;
            }
            failed = true;
            break;
          }

          const cellVal = getCell(nr, nc);
          const rem = cellVal % 10;
          const canStep = (cellVal === 1 || cellVal === 2) ||
            (cellVal > 10 && (player === 1 ? (rem === 1 || rem === 3) : (rem === 2 || rem === 4)));

          if (canStep) {
            path.push({ row: nr, col: nc });
            curRow = nr;
            curCol = nc;
            G.movingState.curRow = curRow;
            G.movingState.curCol = curCol;
          } else {
            if (step > 0) break;
            failed = true;
            break;
          }
        }

        G.movingState = null;

        if (!failed) {
          // Prevent two monsters ending on the exact same tile
          const destVal = getCell(curRow, curCol);
          if (destVal > 10 && (curRow !== startRow || curCol !== startCol)) {
            failed = true;
          }
        }

        if (!failed) {
          const warpPos = checkTransferDoor(player, startRow, startCol);
          if (warpPos) {
            await showMessage(23); // transfer_door
            for (let b = 0; b < 3; b++) {
              mon.visible = false;
              await sleep(180);
              mon.visible = true;
              await sleep(180);
            }
            playSound('specialsummon');
            curRow = warpPos.row;
            curCol = warpPos.col;
            mon.x = 11 + X_MODIFIED[curCol - 1];
            mon.y = -15 + Y_MODIFIED[curRow - 1];
            mon.comeToFront();
          } else {
            for (let s = 1; s < path.length; s++) {
              const pt = path[s];
              await mon.glideTo(0.35, 11 + X_MODIFIED[pt.col - 1], -15 + Y_MODIFIED[pt.row - 1]);
              mon.comeToFront();
            }
          }

          // Update field_occupied for start and destination
          const oldVal = getCell(startRow, startCol);
          const oldRem = oldVal % 10;
          const restoredTile = (oldRem === 2 || oldRem === 3) ? 2 : 1;
          setCell(startRow, startCol, restoredTile);

          const newTileBase = getCell(curRow, curCol) % 10;
          const monPrefix = oldVal - oldRem;
          let newCellVal = monPrefix + newTileBase;
          if (player === 1 && newTileBase === 2) newCellVal = monPrefix + 3;
          if (player === 2 && newTileBase === 1) newCellVal = monPrefix + 4;
          setCell(curRow, curCol, newCellVal);

          mon.vars.row = curRow;
          mon.vars.col = curCol;
          mon.comeToFront();

          // Check if monster stepped onto a Mystery Treasure Chest!
          await checkChestPickup(player, mon, curRow, curCol);
        } else {
          await showMessage(18); // invalid_move
        }

        G[lockKey] = 0;
        finishTokenAction(player);
      }

      // --- ACTION 2 (On Own Turn): ATTACH PROTECTIVE SHIELD TO OWN MONSTER ---
      else if (act === 2) {
        G[lockKey] = 1;
        mon.vars.shielded = true;
        playSound('set');
        flashShield(mon.vars.col, mon.vars.row);
        mon.sayText = '🛡️已掛載護盾!';
        setTimeout(() => {
          if (mon.sayText === '🛡️已掛載護盾!') mon.sayText = '';
        }, 1600);
        G[lockKey] = 0;
        finishTokenAction(player);
        updateStatusUI('🛡️ 已為怪獸掛上護盾！（可抵擋 1 次敵方陷阱破壞，或在決鬥被攻擊時自動啟動基礎防禦力）');
      }
    }

    // 2. Enemy Monster Clicked on Turn, OR Own Monster Clicked with Defense Token on Enemy Turn
    else {
      // Case A: Selecting attack target
      if (G.targetMonsterResolver) {
        const res = G.targetMonsterResolver;
        G.targetMonsterResolver = null;
        res(mon);
        return;
      }

      // Case B: Using Defense Token on own monster during opponent's turn
      if ((player === 1 && G.curr_action_1 === 2) || (player === 2 && G.curr_action_2 === 2)) {
        const defList = player === 1 ? G.player1_mon_atk_def : G.player2_mon_atk_def;
        if (Number(defList[cosIdx - 1]) === 0) {
          defList[cosIdx - 1] = getBaseDef(cosIdx);
        } else {
          defList[cosIdx - 1] += 1;
        }
        mon.sayText = `防禦力${defList[cosIdx - 1] * 500}`;
        finishTokenAction(player);
        return;
      }

      // Case B-Quick: During active duel (Prepare buttons visible), if defending player clicks their targeted monster directly without clicking a Defense token first, auto-apply 1 available Defense token!
      if (sprites.player1_font.visible && ((isP1Turn && player === 2) || (!isP1Turn && player === 1))) {
        const isBeingAttacked = G.attacked.some((tid) => Number(tid) === mon.vars.myID);
        if (isBeingAttacked) {
          const defTokens = (player === 1 ? clones.p1_tokens : clones.p2_tokens).filter(
            (t) => t.costumeIndex === 2 && Number((player === 1 ? G.player1_token_list : G.player2_token_list)[t.vars.slotIndex]) > 0
          );
          if (defTokens.length > 0) {
            const dtk = defTokens[0];
            playSound('coinflip');
            consumeToken(player, dtk);
            const defList = player === 1 ? G.player1_mon_atk_def : G.player2_mon_atk_def;
            if (Number(defList[cosIdx - 1]) === 0) {
              defList[cosIdx - 1] = getBaseDef(cosIdx);
            } else {
              defList[cosIdx - 1] += 1;
            }
            mon.sayText = `防禦力${defList[cosIdx - 1] * 500}`;
            if (player === 1) {
              G.activeToken1 = null;
              G.curr_action_1 = 0;
              G.t1_lock = 0;
            } else {
              G.activeToken2 = null;
              G.curr_action_2 = 0;
              G.t2_lock = 0;
            }
            updateStatusUI(`🛡️ 已為怪獸啟動防禦（目前防禦力 ${defList[cosIdx - 1] * 500}）！可繼續追加防禦徽章，或點擊左下角「Prepare」結算決鬥！`);
            return;
          }
        }
      }

      // Case C: Trap Effect 1 (Destroy enemy monster)
      if ((isP1Turn && player === 2 && G.curr_action_1 === 3 && G.defense_done === 1) ||
          (!isP1Turn && player === 1 && G.curr_action_2 === 3 && G.defense_done === 1)) {
        if (mon.vars.shielded) {
          // Protective Shield blocks Trap destruction!
          mon.vars.shielded = false;
          playSound('draw');
          flashShield(mon.vars.col, mon.vars.row);
          mon.sayText = '🛡️護盾抵擋陷阱!';
          setTimeout(() => {
            if (mon.sayText === '🛡️護盾抵擋陷阱!') mon.sayText = '';
          }, 1800);
          await showMessage(isP1Turn ? 8 : 11); // p1_atk_f / p2_atk_f
          finishTokenAction(isP1Turn ? 1 : 2);
          updateStatusUI('🛡️ 敵方怪獸身上的護盾成功抵擋了陷阱破壞！（護盾已消耗）');
        } else {
          destroyMonsterClone(mon);
          playSound('destroyed');
          await showMessage(isP1Turn ? 7 : 10); // p1_atk_s / p2_atk_s
          finishTokenAction(isP1Turn ? 1 : 2);
        }
      }
    }
  }

  function destroyMonsterClone(mon) {
    const r = mon.vars.row;
    const c = mon.vars.col;
    const val = getCell(r, c);
    const rem = val % 10;
    if (rem === 1 || rem === 4) setCell(r, c, 1);
    else if (rem === 2 || rem === 3) setCell(r, c, 2);

    if (mon.vars.player === 1) {
      clones.p1_monster = clones.p1_monster.filter((m) => m !== mon);
    } else {
      clones.p2_monster = clones.p2_monster.filter((m) => m !== mon);
    }
  }

  // Combat Prepare Buttons (player1_font & player2_font)
  let p1Prepared = false;
  let p2Prepared = false;

  function showPrepareButtons() {
    p1Prepared = false;
    p2Prepared = false;

    sprites.player1_font.size = 40;
    sprites.player1_font.x = -200;
    sprites.player1_font.y = -175;
    sprites.player1_font.ghost = 0;
    sprites.player1_font.comeToFront();
    sprites.player1_font.visible = true;

    sprites.player2_font.size = 40;
    sprites.player2_font.x = 120;
    sprites.player2_font.y = -175;
    sprites.player2_font.ghost = 0;
    sprites.player2_font.comeToFront();
    sprites.player2_font.visible = true;

    if (aiEnabled && G.turn % 2 === 0) {
      triggerAIDefenseReaction();
    }
  }

  sprites.player1_font.onClick = async () => {
    if (!sprites.player1_font.visible || p1Prepared) return;
    // If Player 1 clicked a Defense token (curr_action_1 === 2) but forgot to click their monster before hitting Prepare, auto-apply it to the attacked P1 monster!
    if (G.curr_action_1 === 2 && G.activeToken1) {
      const targetID = G.attacked.find((id) => Number(id) > 0);
      const targetMon = clones.p1_monster.find((m) => m.vars.myID === Number(targetID)) || clones.p1_monster[0];
      if (targetMon) {
        const cosIdx = targetMon.costumeIndex;
        if (Number(G.player1_mon_atk_def[cosIdx - 1]) === 0) {
          G.player1_mon_atk_def[cosIdx - 1] = getBaseDef(cosIdx);
        } else {
          G.player1_mon_atk_def[cosIdx - 1] += 1;
        }
        targetMon.sayText = `防禦力${G.player1_mon_atk_def[cosIdx - 1] * 500}`;
        finishTokenAction(1);
      }
    }
    p1Prepared = true;
    sprites.player1_font.ghost = 35;
    playSound('pop');
    if (p1Prepared && p2Prepared) await resolveDuelCombat();
  };

  sprites.player2_font.onClick = async () => {
    if (!sprites.player2_font.visible || p2Prepared) return;
    p2Prepared = true;
    sprites.player2_font.ghost = 35;
    playSound('pop');
    if (p1Prepared && p2Prepared) await resolveDuelCombat();
  };

  async function resolveDuelCombat() {
    sprites.player1_font.visible = false;
    sprites.player2_font.visible = false;

    const isP1Turn = G.turn % 2 === 0;
    const atkList = isP1Turn ? G.player1_mon_atk_def : G.player2_mon_atk_def;
    const defList = isP1Turn ? G.player2_mon_atk_def : G.player1_mon_atk_def;
    const defenderClones = isP1Turn ? clones.p2_monster : clones.p1_monster;

    for (let i = 0; i < 10; i++) {
      const atkScore = Number(atkList[i]);
      if (atkScore > 0) {
        const targetID = Number(G.attacked[i]);
        const defScore = Number(defList[targetID - 1] || 0);
        const targetMon = defenderClones.find((m) => m.vars.myID === targetID);

        if (atkScore > defScore) {
          if (targetMon) {
            destroyMonsterClone(targetMon);
          }
          playSound('destroyed');
          await showMessage(isP1Turn ? 7 : 10); // p1_atk_s (玩家A攻擊成功) / p2_atk_s (玩家B攻擊成功)
        } else {
          playSound('draw');
          await showMessage(isP1Turn ? 8 : 11); // p1_atk_f (玩家A攻擊失敗) / p2_atk_f (玩家B攻擊失敗)
        }
        await sleep(200);
      }
    }

    // Clear speech bubbles & combat buffers
    clones.p1_monster.forEach((m) => (m.sayText = ''));
    clones.p2_monster.forEach((m) => (m.sayText = ''));
    G.player1_mon_atk_def = new Array(10).fill(0);
    G.player2_mon_atk_def = new Array(10).fill(0);
    G.attacked = new Array(10).fill(0);
    updateStatusUI();
  }

  // Canvas Input Handling
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;
    const scratchX = canvasX - CENTER_X;
    const scratchY = CENTER_Y - canvasY;

    // Sort visible clickable sprites top-to-bottom by layerGroup then zOrder
    const renderList = getAllRenderSprites()
      .filter((sp) => sp.visible && typeof sp.onClick === 'function')
      .sort((a, b) => (b.layerGroup - a.layerGroup) || (b.zOrder - a.zOrder));

    // When picking a move destination step (G.moveStepResolver is waiting), prioritize territory tiles over monsters!
    if (G.moveStepResolver) {
      const tileList = [...clones.p1_occupied, ...clones.p2_occupied].filter((sp) => sp.visible);
      for (const tile of tileList) {
        if (tile.hitTest(canvasX, canvasY)) {
          tile.onClick(scratchX, scratchY);
          return;
        }
      }
    }

    for (const sp of renderList) {
      if (sp.hitTest(canvasX, canvasY)) {
        sp.onClick(scratchX, scratchY);
        break;
      }
    }
  });

  // Main Render Loop
  function renderFrame() {
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);

    // Draw top & bottom HUD bar background outside the 480x360 board
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);

    // Draw Stage backdrop centered in the middle 480x360 area (y: 40..400)
    const stageCostumes = assetMeta.costumes['Stage'] || [];
    const stCos = stageCostumes.find((c) => c.name === G.stageCostume) || stageCostumes[0];
    if (stCos && images[stCos.file]) {
      if (G.stageCostume === 'waiting') {
        ctx.drawImage(images[stCos.file], 0, 0, STAGE_W, STAGE_H);
      } else {
        ctx.drawImage(images[stCos.file], 0, 40, 480, 360);
      }
    }

    if (G.stageCostume === 'game') {
      // Subtle divider lines for Top P1 HUD bar & Bottom P2 HUD bar
      ctx.save();
      ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
      ctx.fillRect(0, 0, STAGE_W, 40);
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 40);
      ctx.lineTo(STAGE_W, 40);
      ctx.stroke();

      ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
      ctx.fillRect(0, 400, STAGE_W, 40);
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)';
      ctx.beginPath();
      ctx.moveTo(0, 400);
      ctx.lineTo(STAGE_W, 400);
      ctx.stroke();
      ctx.restore();
    }

    // Draw all sprites ordered by layerGroup first (so monsters ALWAYS stay above territory tiles!), then zOrder
    const list = getAllRenderSprites().sort((a, b) => (a.layerGroup - b.layerGroup) || (a.zOrder - b.zOrder));
    for (const sp of list) {
      sp.draw(ctx);
    }

    // Draw Mystery Treasure Chests on the board & Protective Shield icons on shielded monsters!
    if (G.stageCostume === 'game') {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 220);
      ctx.save();

      // 1. Mystery Treasure Chests
      if (G.treasure_chests && G.treasure_chests.length > 0) {
        for (const ch of G.treasure_chests) {
          const sx = CENTER_X + X_MODIFIED[ch.col - 1];
          const sy = CENTER_Y - Y_MODIFIED[ch.row - 1];
          ctx.fillStyle = `rgba(245, 158, 11, ${0.28 + 0.25 * pulse})`;
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(sx + 1, sy + 1, 20, 20, 4);
          ctx.fill();
          ctx.stroke();

          ctx.font = '14px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('💎', sx + 11, sy + 11);
        }
      }

      // 2. Protective Shield Badges on Shielded Monsters
      const allMonsters = [...clones.p1_monster, ...clones.p2_monster];
      for (const m of allMonsters) {
        if (m.visible && m.vars.shielded) {
          const mx = CENTER_X + m.x;
          const my = CENTER_Y - m.y;
          // Glowing cyan/gold shield ring around monster + mini shield badge
          ctx.strokeStyle = `rgba(56, 189, 248, ${0.55 + 0.4 * pulse})`;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(mx, my - 4, 14, 0, Math.PI * 2);
          ctx.stroke();

          ctx.font = '12px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('🛡️', mx + 10, my - 14);
        }
      }

      ctx.restore();
    }

    // Waiting screen visual guide when P2 is AI: highlight P1 for human player & badge P2 as AI!
    if (G.stageCostume === 'waiting' && sprites.p1_enter.visible) {
      const p1x = CENTER_X + sprites.p1_enter.x;
      const p1y = CENTER_Y - sprites.p1_enter.y;
      const p2x = CENTER_X + sprites.p2_enter.x;
      const p2y = CENTER_Y - sprites.p2_enter.y;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);

      ctx.save();
      if (sprites.p1_enter.costumeIndex === 1) {
        // Glowing spotlight border & bouncing arrow above Player 1
        ctx.strokeStyle = `rgba(250, 204, 21, ${0.45 + 0.45 * pulse})`;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.roundRect(p1x - 46, p1y - 64, 96, 108, 12);
        ctx.stroke();

        const bounceY = p1y - 80 - pulse * 7;
        ctx.fillStyle = '#facc15';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 3;
        ctx.font = 'bold 14px "Microsoft JhengHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = '👇 請點此選 P1 (紅方)';
        ctx.strokeText(label, p1x + 2, bounceY);
        ctx.fillText(label, p1x + 2, bounceY);
      }

      if (aiEnabled && sprites.p2_enter.visible) {
        // Badge above P2 indicating AI auto-join
        ctx.fillStyle = 'rgba(30, 58, 138, 0.9)';
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(p2x - 54, p2y - 84, 112, 24, 999);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#93c5fd';
        ctx.font = 'bold 12px "Microsoft JhengHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🤖 AI 對手 (自動)', p2x + 2, p2y - 72);
      }
      ctx.restore();
    }

    // Highlight valid move step cells & chosen path during Monster Move!
    if (G.field === 1 && G.movingState) {
      const ms = G.movingState;
      const pulse = 0.4 + 0.25 * Math.sin(performance.now() / 150);
      ctx.save();

      // Draw already selected intermediate steps
      for (let i = 1; i < ms.path.length; i++) {
        const pt = ms.path[i];
        const sx = CENTER_X + X_MODIFIED[pt.col - 1];
        const sy = CENTER_Y - Y_MODIFIED[pt.row - 1];
        const isCurrentTip = (i === ms.path.length - 1);
        ctx.fillStyle = isCurrentTip ? 'rgba(34, 197, 94, 0.55)' : 'rgba(250, 204, 21, 0.45)';
        ctx.strokeStyle = isCurrentTip ? '#4ade80' : '#fde047';
        ctx.lineWidth = 2.5;
        ctx.fillRect(sx, sy, 22, 22);
        ctx.strokeRect(sx, sy, 22, 22);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(isCurrentTip ? '✓' : String(i), sx + 11, sy + 11);
      }

      // Highlight the 4 adjacent cells around (ms.curRow, ms.curCol) that are valid for the next step
      const dirs = [
        { dr: -1, dc: 0, label: '↑' },
        { dr: 1, dc: 0, label: '↓' },
        { dr: 0, dc: -1, label: '←' },
        { dr: 0, dc: 1, label: '→' },
      ];
      for (const d of dirs) {
        const nr = ms.curRow + d.dr;
        const nc = ms.curCol + d.dc;
        const cellVal = getCell(nr, nc);
        if (cellVal < 0) continue;
        const rem = cellVal % 10;
        const canStep = (cellVal === 1 || cellVal === 2) ||
          (cellVal > 10 && (ms.player === 1 ? (rem === 1 || rem === 3) : (rem === 2 || rem === 4)));
        if (canStep) {
          const sx = CENTER_X + X_MODIFIED[nc - 1];
          const sy = CENTER_Y - Y_MODIFIED[nr - 1];
          ctx.fillStyle = `rgba(250, 204, 21, ${pulse})`;
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 2.5;
          ctx.fillRect(sx, sy, 22, 22);
          ctx.strokeRect(sx, sy, 22, 22);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 13px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(d.label, sx + 11, sy + 11);
        }
      }
      ctx.restore();
    }

    // Highlight valid placement cells when Summon action (5) is active!
    if (G.field === 1 && (G.curr_action_1 === 5 || G.curr_action_2 === 5)) {
      const isP1 = G.turn % 2 === 0;
      const pulse = 0.35 + 0.25 * Math.sin( performance.now() / 180 );
      ctx.save();
      for (let r = 1; r <= 13; r++) {
        for (let c = 1; c <= 19; c++) {
          if (canExpandSixFrom(r, c, isP1)) {
            const sx = CENTER_X + X_MODIFIED[c - 1];
            const sy = CENTER_Y - Y_MODIFIED[r - 1];
            ctx.fillStyle = isP1 ? `rgba(239, 68, 68, ${pulse})` : `rgba(59, 130, 246, ${pulse})`;
            ctx.strokeStyle = isP1 ? '#f87171' : '#60a5fa';
            ctx.lineWidth = 2;
            ctx.fillRect(sx, sy, 22, 22);
            ctx.strokeRect(sx, sy, 22, 22);
          }
        }
      }
      ctx.restore();
    }

    // Draw speech bubbles on top with anti-overlap positioning
    const placedBubbleBoxes = [];
    for (const sp of list) {
      sp.drawSpeechBubble(ctx, placedBubbleBoxes);
    }

    requestAnimationFrame(renderFrame);
  }

  // Save & Load State Functions
  const SAVE_KEY = 'MONSTER_DICE_SAVE_V1';

  function saveGameState(isAuto = false) {
    if (!G.game_on) {
      if (!isAuto) updateStatusUI('⚠️ 遊戲尚未開始，無法暫存！');
      return;
    }
    const state = {
      timestamp: new Date().toLocaleTimeString(),
      turn: G.turn,
      field: G.field,
      p1_life: G.p1_life,
      p2_life: G.p2_life,
      p1_punish: G.p1_punish,
      p2_punish: G.p2_punish,
      panel_lock: G.panel_lock,
      curr_species: G.curr_species,
      summon: G.summon,
      dice_action: [...G.dice_action],
      dice1_done: G.dice1_done,
      dice2_done: G.dice2_done,
      dice3_done: G.dice3_done,
      field_occupied: [...G.field_occupied],
      player1_token_list: G.player1_token_list.filter((v) => Number(v) !== 0),
      player2_token_list: G.player2_token_list.filter((v) => Number(v) !== 0),
      player1_mon_field: [...G.player1_mon_field],
      player2_mon_field: [...G.player2_mon_field],
      summon_token_produced: [...G.summon_token_produced],
      stones: clones.stone_road.map((s) => ({ x: s.x, y: s.y })),
      treasure_chests: [...(G.treasure_chests || [])],
      p1_tiles: clones.p1_occupied.map((t) => ({ row: t.vars.row, col: t.vars.col })),
      p2_tiles: clones.p2_occupied.map((t) => ({ row: t.vars.row, col: t.vars.col })),
      p1_monsters: clones.p1_monster.map((m) => ({
        cosIdx: m.costumeIndex,
        row: m.vars.row,
        col: m.vars.col,
        myID: m.vars.myID,
        shielded: !!m.vars.shielded,
      })),
      p2_monsters: clones.p2_monster.map((m) => ({
        cosIdx: m.costumeIndex,
        row: m.vars.row,
        col: m.vars.col,
        myID: m.vars.myID,
        shielded: !!m.vars.shielded,
      })),
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      if (!isAuto) {
        playSound('set');
        updateStatusUI(`💾 已成功暫存目前進度！（儲存時間：${state.timestamp}，回合 ${state.turn + 1}）`);
      }
    } catch (e) {
      console.warn('Save failed:', e);
    }
  }

  function loadGameState() {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) {
      updateStatusUI('⚠️ 找不到暫存紀錄！請先在遊戲中點擊「💾 暫存進度」。');
      return;
    }
    try {
      const state = JSON.parse(raw);
      // Cancel any pending resolvers
      G.moveStepResolver = null;
      G.targetMonsterResolver = null;
      G.movingState = null;

      G.stageCostume = 'game';
      G.game_start = 2;
      G.game_on = 1;
      G.turn = state.turn;
      G.field = state.field;
      G.p1_life = state.p1_life;
      G.p2_life = state.p2_life;
      G.p1_punish = state.p1_punish;
      G.p2_punish = state.p2_punish;
      G.panel_lock = state.panel_lock;
      G.dice_lock = 0;
      G.curr_species = state.curr_species || 1;
      G.summon = state.summon || 0;
      G.dice_action = state.dice_action || [1, 2, 3];
      G.dice1_done = state.dice1_done ?? 1;
      G.dice2_done = state.dice2_done ?? 1;
      G.dice3_done = state.dice3_done ?? 1;

      G.curr_action_1 = 0;
      G.curr_action_2 = 0;
      G.dice_grid_num = 0;
      G.defense_done = 0;
      G.t1_lock = 0;
      G.t2_lock = 0;
      G.m1_lock = 0;
      G.m2_lock = 0;

      G.field_occupied = [...state.field_occupied];
      G.treasure_chests = state.treasure_chests ? [...state.treasure_chests] : [];
      G.player1_token_list = [...state.player1_token_list];
      G.player2_token_list = [...state.player2_token_list];
      G.player1_mon_field = [...state.player1_mon_field];
      G.player2_mon_field = [...state.player2_mon_field];
      G.summon_token_produced = [...state.summon_token_produced];
      G.player1_mon_atk_def = new Array(10).fill(0);
      G.player2_mon_atk_def = new Array(10).fill(0);
      G.attacked = new Array(10).fill(0);

      // Hide all base sprites first
      for (const sp of Object.values(sprites)) {
        sp.visible = false;
        sp.sayText = '';
        sp.ghost = 0;
        sp.colorEffect = 0;
      }

      sprites.field.size = 100;
      sprites.field.x = 0;
      sprites.field.y = 0;
      sprites.field.visible = true;

      // Rebuild stones
      clones.stone_road = (state.stones || []).map((s) => {
        const stone = new Sprite('stone_road', true);
        stone.x = s.x;
        stone.y = s.y;
        stone.size = 40;
        stone.visible = true;
        return stone;
      });

      // Rebuild P1 territory tiles
      clones.p1_occupied = (state.p1_tiles || []).map((t) => {
        const tile = new Sprite('player1_occupied', true);
        tile.size = 100;
        tile.x = X_MODIFIED[t.col - 1];
        tile.y = Y_MODIFIED[t.row - 1];
        tile.vars.row = t.row;
        tile.vars.col = t.col;
        tile.vars.myID = t.row * 100 + t.col;
        tile.visible = true;
        tile.onClick = () => onClickOccupiedTile(1, tile);
        return tile;
      });

      // Rebuild P2 territory tiles
      clones.p2_occupied = (state.p2_tiles || []).map((t) => {
        const tile = new Sprite('player2_occupied', true);
        tile.size = 100;
        tile.x = X_MODIFIED[t.col - 1];
        tile.y = Y_MODIFIED[t.row - 1];
        tile.vars.row = t.row;
        tile.vars.col = t.col;
        tile.vars.myID = t.row * 100 + t.col;
        tile.visible = true;
        tile.onClick = () => onClickOccupiedTile(2, tile);
        return tile;
      });

      // Rebuild P1 monsters
      clones.p1_monster = (state.p1_monsters || []).map((m) => {
        const mon = new Sprite('player1_monster', true);
        mon.size = 100;
        mon.lookLike(m.cosIdx);
        mon.x = 11 + X_MODIFIED[m.col - 1];
        mon.y = -15 + Y_MODIFIED[m.row - 1];
        mon.vars.myID = m.myID;
        mon.vars.row = m.row;
        mon.vars.col = m.col;
        mon.vars.player = 1;
        mon.vars.shielded = !!m.shielded;
        mon.visible = true;
        mon.onClick = () => onClickMonster(mon);
        return mon;
      });

      // Rebuild P2 monsters
      clones.p2_monster = (state.p2_monsters || []).map((m) => {
        const mon = new Sprite('player2_monster', true);
        mon.size = 100;
        mon.lookLike(m.cosIdx);
        mon.x = 11 + X_MODIFIED[m.col - 1];
        mon.y = -15 + Y_MODIFIED[m.row - 1];
        mon.vars.myID = m.myID;
        mon.vars.row = m.row;
        mon.vars.col = m.col;
        mon.vars.player = 2;
        mon.vars.shielded = !!m.shielded;
        mon.visible = true;
        mon.onClick = () => onClickMonster(mon);
        return mon;
      });

      renderTokenClones(1);
      renderTokenClones(2);

      const isP1 = G.turn % 2 === 0;
      if (G.field === 0) {
        sprites.panel.x = isP1 ? 190 : -190;
        sprites.panel.y = -5;
        sprites.panel.size = 100;
        sprites.panel.visible = true;

        sprites.go_to_field.lookLike(isP1 ? '造型1' : '造型2');
        sprites.go_to_field.x = isP1 ? -170 : 175;
        sprites.go_to_field.y = isP1 ? -188 : 192;
        sprites.go_to_field.size = 100;
        sprites.go_to_field.visible = true;
        spawnMonNumbers();

        if (G.panel_lock === 1 && G.dice_action.length === 3) {
          const baseCos = (G.curr_species - 1) * 5;
          const dSprites = [sprites.dice_1, sprites.dice_2, sprites.dice_3];
          const dXs = isP1 ? [-150, -40, 70] : [-80, 30, 140];
          const dDones = [G.dice1_done, G.dice2_done, G.dice3_done];
          dSprites.forEach((ds, idx) => {
            const act = Number(G.dice_action[idx]);
            ds.size = 75;
            ds.x = dXs[idx];
            ds.y = 0;
            ds.lookLike(act === 5 || act === 6 ? G.curr_species * 5 : baseCos + act);
            ds.ghost = dDones[idx] ? 35 : 0;
            ds.visible = true;
          });
        }
      } else {
        clones.mon_numbers = [];
        sprites.next_turn_btn.lookLike(isP1 ? '造型1' : '造型2');
        sprites.next_turn_btn.x = isP1 ? -175 : 175;
        sprites.next_turn_btn.y = isP1 ? -188 : 192;
        sprites.next_turn_btn.size = 100;
        sprites.next_turn_btn.visible = true;
      }

      playSound('coinflip');
      updateStatusUI(`📂 已成功讀取暫存進度！（儲存時間：${state.timestamp}，回合 ${state.turn + 1}）`);
      if (aiEnabled && G.game_on === 1 && G.turn % 2 === 1) {
        triggerAITurn();
      }
    } catch (e) {
      console.error('Load failed:', e);
      updateStatusUI('⚠️ 讀取暫存失敗！');
    }
  }

  // ============================================================================
  // AI Controller (Player 2 Automated Heuristic Engine)
  // ============================================================================

  function findBestMovePathForAI(mon, maxSteps) {
    const startR = mon.vars.row;
    const startC = mon.vars.col;
    // BFS up to maxSteps on valid territory cells
    const queue = [{ r: startR, c: startC, path: [] }];
    const visited = new Set([`${startR},${startC}`]);
    const candidates = [];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur.path.length > 0) {
        // A valid final destination must not already contain another monster
        const destVal = getCell(cur.r, cur.c);
        if (destVal === 1 || destVal === 2) {
          candidates.push(cur);
        }
      }
      if (cur.path.length >= maxSteps) continue;

      for (const [dr, dc] of dirs) {
        const nr = cur.r + dr;
        const nc = cur.c + dc;
        const key = `${nr},${nc}`;
        if (nr < 1 || nr > 13 || nc < 1 || nc > 19 || visited.has(key)) continue;
        const cv = getCell(nr, nc);
        const rem = cv % 10;
        const canStep = (cv === 1 || cv === 2) || (cv > 10 && (rem === 2 || rem === 4));
        if (canStep) {
          visited.add(key);
          queue.push({ r: nr, c: nc, path: [...cur.path, { row: nr, col: nc }] });
        }
      }
    }

    if (candidates.length === 0) return null;

    // Score each candidate destination:
    // Priority 1: Direct base attack squares (7,2), (6,1), (8,1)
    // Priority 2: Squares adjacent to an enemy monster we can beat
    // Priority 3: Closer to P1 base (row 7, col 1) than current position
    const curDistToBase = Math.abs(startR - 7) + Math.abs(startC - 1);
    let bestCand = null;
    let bestScore = -9999;

    const atkTokensCount = clones.p2_tokens.filter((t) => t.costumeIndex === 1 && Number(G.player2_token_list[t.vars.slotIndex]) > 0).length;
    const myPotentialAtk = getBaseAtk(mon.costumeIndex) + Math.max(0, atkTokensCount - 1);

    for (const cand of candidates) {
      let score = 0;
      const isBaseAdj = (cand.r === 7 && cand.c === 2) || (cand.r === 6 && cand.c === 1) || (cand.r === 8 && cand.c === 1);
      if (isBaseAdj) {
        score += 5000;
      }

      const newDistToBase = Math.abs(cand.r - 7) + Math.abs(cand.c - 1);
      const distGain = curDistToBase - newDistToBase;
      score += distGain * 40;

      // Bonus for stepping directly onto a Mystery Treasure Chest!
      if (G.treasure_chests && G.treasure_chests.some((ch) => ch.row === cand.r && ch.col === cand.c)) {
        score += 450;
      }

      // Check adjacency to P1 monsters
      for (const em of clones.p1_monster) {
        const d = Math.abs(cand.r - em.vars.row) + Math.abs(cand.c - em.vars.col);
        if (d === 1 && atkTokensCount > 0) {
          const enemyBaseDef = getBaseDef(em.costumeIndex);
          if (myPotentialAtk > enemyBaseDef) {
            score += 600;
          } else {
            score += 120;
          }
        }
      }

      // Only consider moves that either reach base, engage enemy, or advance closer to P1 base
      if (score > 0 && score > bestScore) {
        bestScore = score;
        bestCand = cand;
      }
    }

    return bestCand ? bestCand.path : null;
  }

  async function triggerAIDefenseReaction() {
    await sleep(650);
    if (!aiEnabled || !G.game_on || G.field !== 1 || G.turn % 2 !== 0) return;
    if (!sprites.player2_font.visible) return;

    // Find which P2 monster is being attacked
    let attackerIdx = -1;
    let targetID = 0;
    for (let i = 0; i < 10; i++) {
      if (Number(G.player1_mon_atk_def[i]) > 0 && Number(G.attacked[i]) > 0) {
        attackerIdx = i;
        targetID = Number(G.attacked[i]);
        break;
      }
    }

    if (attackerIdx !== -1 && targetID > 0) {
      const targetMon = clones.p2_monster.find((m) => m.vars.myID === targetID);
      if (targetMon) {
        const atkVal = Number(G.player1_mon_atk_def[attackerIdx]);
        const baseDef = getBaseDef(targetMon.costumeIndex);
        const defTokens = clones.p2_tokens.filter(
          (t) => t.costumeIndex === 2 && Number(G.player2_token_list[t.vars.slotIndex]) > 0
        );

        // First defense token sets defense to baseDef; each subsequent token adds +1
        const maxPossibleDef = defTokens.length > 0 ? baseDef + (defTokens.length - 1) : 0;

        // If using defense tokens can save the monster (def >= atk), use just enough tokens!
        if (defTokens.length > 0 && maxPossibleDef >= atkVal) {
          for (const dtk of defTokens) {
            const curDef = Number(G.player2_mon_atk_def[targetMon.costumeIndex - 1]);
            if (curDef >= atkVal) break;
            updateStatusUI('🤖 AI 正在發動防禦印記強化怪獸...');
            await onClickPlayer2Token(dtk);
            await sleep(400);
            await onClickMonster(targetMon);
            await sleep(450);
          }
        }
      }
    }

    // Finally click P2's Prepare button (and P1's Prepare button if P1 already finished or after a short wait)
    if (sprites.player2_font.visible && !p2Prepared) {
      await sprites.player2_font.onClick();
    }
  }

  async function triggerAITurn() {
    if (aiRunning || !aiEnabled || !G.game_on || G.turn % 2 !== 1) return;
    aiRunning = true;

    try {
      await sleep(650);
      if (!aiEnabled || !G.game_on || G.turn % 2 !== 1) return;

      // ======================================================================
      // PHASE 1: PANEL (Choose monster species to roll dice & collect tokens)
      // ======================================================================
      if (G.field === 0) {
        if (G.panel_lock === 0 && G.p2_punish === 0) {
          updateStatusUI('🤖 AI (藍方) 正在選擇怪獸並擲骰子...');
          // Choose best available species:
          // Priority: if no monsters on board, pick highest summon probability (4:Beast, 3:Warrior, 5:Ghost, 2:Magician, 1:Dragon)
          // If already have monsters on board, mix in Dragon/Warrior/Magician
          const hasMonsters = clones.p2_monster.length > 0;
          const order = hasMonsters ? [3, 1, 4, 2, 5] : [4, 3, 5, 2, 1];
          let chosenSp = 4;
          for (const sp of order) {
            const used = Number(G.summon_token_produced[sp + 4]);
            if (used < SPECIES_MAX[sp]) {
              chosenSp = sp;
              break;
            }
          }
          const speciesY = [0, 105, 52, 0, -53, -105];
          await sprites.panel.onClick(-190, speciesY[chosenSp]);
          await sleep(600);
        }

        // Collect dice tokens if hand < 5
        if (!aiEnabled || !G.game_on || G.turn % 2 !== 1) return;
        const diceSprites = [
          { sp: sprites.dice_1, idx: 1 },
          { sp: sprites.dice_2, idx: 2 },
          { sp: sprites.dice_3, idx: 3 },
        ];

        // Sort dice by priority: Move (5,6) > Attack (1) > Trap (4) > Defense (2)
        const priorityOf = (act) => {
          if (act === 5 || act === 6) return 10;
          if (act === 1) return 8;
          if (act === 4) return 6;
          if (act === 2) return 4;
          return 0;
        };
        diceSprites.sort(
          (a, b) => priorityOf(Number(G.dice_action[b.idx - 1])) - priorityOf(Number(G.dice_action[a.idx - 1]))
        );

        for (const d of diceSprites) {
          const activeCount = G.player2_token_list.filter((v) => Number(v) > 0).length;
          if (activeCount >= 5) break;
          const doneKey = `dice${d.idx}_done`;
          const act = Number(G.dice_action[d.idx - 1]);
          if (G[doneKey] === 0 && act !== 3) {
            await d.sp.onClick();
            await sleep(380);
          }
        }

        // Click "開始戰鬥" (go_to_field)
        await sleep(450);
        if (!aiEnabled || !G.game_on || G.turn % 2 !== 1) return;
        if (G.field === 0 && G.panel_lock === 1) {
          sprites.go_to_field.onClick();
          await sleep(600);
        }
      }

      // ======================================================================
      // PHASE 2: FIELD (Use Summon, Trap, Move, Attack tokens)
      // ======================================================================
      if (G.field === 1 && aiEnabled && G.game_on && G.turn % 2 === 1) {
        // 2A. Use all Summon Tokens (cosIdx === 5)
        for (const tk of [...clones.p2_tokens]) {
          if (!aiEnabled || !G.game_on || G.turn % 2 !== 1) return;
          const rawVal = Number(G.player2_token_list[tk.vars.slotIndex]);
          if (!rawVal || tk.costumeIndex !== 5) continue;

          // Find all valid expansion cells and pick the one closest to P1 base (row 7, col 1)
          let bestCell = null;
          let bestDist = 9999;
          for (let r = 1; r <= 13; r++) {
            for (let c = 1; c <= 19; c++) {
              if (canExpandSixFrom(r, c, false)) {
                const dist = Math.abs(r - 7) * 1.2 + Math.abs(c - 1) * 2.0 + Math.random() * 0.5;
                if (dist < bestDist) {
                  bestDist = dist;
                  bestCell = { r, c };
                }
              }
            }
          }

          if (bestCell) {
            updateStatusUI('🤖 AI 正在發動召喚印記並鋪設領地...');
            await onClickPlayer2Token(tk);
            await sleep(550);
            const targetX = X_MODIFIED[bestCell.c - 1] + 10;
            const targetY = Y_MODIFIED[bestCell.r - 1] - 10;
            await sprites.field.onClick(targetX, targetY);
            await sleep(750);
          }
        }

        // 2B. Use Trap Tokens (cosIdx === 3) if AI has at least one monster alive
        for (const tk of [...clones.p2_tokens]) {
          if (!aiEnabled || !G.game_on || G.turn % 2 !== 1) return;
          const rawVal = Number(G.player2_token_list[tk.vars.slotIndex]);
          if (!rawVal || tk.costumeIndex !== 3 || !hasMonsterAlive(2)) continue;

          updateStatusUI('🤖 AI 正在發動陷阱印記...');
          await onClickPlayer2Token(tk);
          await sleep(500);

          // If trap requires selecting an enemy monster (defense_done === 1)
          if (G.curr_action_2 === 3 && G.defense_done === 1 && clones.p1_monster.length > 0) {
            // Pick enemy monster closest to P2 base (col 19) or highest attack
            const targetMon = [...clones.p1_monster].sort((a, b) => b.vars.col - a.vars.col)[0];
            if (targetMon) {
              await onClickMonster(targetMon);
              await sleep(600);
            }
          }
          // If trap requires selecting an enemy empty territory tile (defense_done === 2)
          else if (G.curr_action_2 === 3 && G.defense_done === 2) {
            const emptyEnemyTiles = clones.p1_occupied.filter((t) => getCell(t.vars.row, t.vars.col) === 1);
            if (emptyEnemyTiles.length > 0) {
              // Pick tile furthest right (closest to P2 base)
              emptyEnemyTiles.sort((a, b) => b.vars.col - a.vars.col);
              await onClickOccupiedTile(1, emptyEnemyTiles[0]);
              await sleep(600);
            }
          }
        }

        // 2C. Use Move Tokens (cosIdx === 4) to advance towards P1 base or enemy monsters
        for (const tk of [...clones.p2_tokens]) {
          if (!aiEnabled || !G.game_on || G.turn % 2 !== 1) return;
          const rawVal = Number(G.player2_token_list[tk.vars.slotIndex]);
          if (!rawVal || tk.costumeIndex !== 4 || clones.p2_monster.length === 0) continue;

          // Find which P2 monster has the best move path
          let chosenMon = null;
          let chosenPath = null;
          // Sort monsters by closest to P1 base first
          const sortedMons = [...clones.p2_monster].sort((a, b) => a.vars.col - b.vars.col);
          for (const m of sortedMons) {
            // Don't move a monster that is already at P1 base attack position!
            const atBase = (m.vars.row === 7 && m.vars.col === 2) ||
                           (m.vars.row === 6 && m.vars.col === 1) ||
                           (m.vars.row === 8 && m.vars.col === 1);
            if (atBase) continue;
            const path = findBestMovePathForAI(m, getMoveRange(m.costumeIndex));
            if (path && path.length > 0) {
              chosenMon = m;
              chosenPath = path;
              break;
            }
          }

          if (chosenMon && chosenPath) {
            updateStatusUI('🤖 AI 正在移動怪獸推進戰線...');
            await onClickPlayer2Token(tk);
            await sleep(450);

            // Start monster move async loop (it awaits G.moveStepResolver for each step)
            const movePromise = onClickMonster(chosenMon);
            const maxRange = getMoveRange(chosenMon.costumeIndex);

            for (let s = 0; s < chosenPath.length; s++) {
              await sleep(450);
              if (G.moveStepResolver) {
                const stepPt = chosenPath[s];
                await flashGridFrame(stepPt.col, stepPt.row);
                const res = G.moveStepResolver;
                G.moveStepResolver = null;
                res(stepPt);
              }
            }
            // If chosenPath is shorter than maxRange, click the last cell one more time to stop early!
            if (chosenPath.length < maxRange) {
              await sleep(450);
              if (G.moveStepResolver) {
                const lastPt = chosenPath[chosenPath.length - 1];
                const res = G.moveStepResolver;
                G.moveStepResolver = null;
                res(lastPt);
              }
            }
            await movePromise;
            await sleep(600);
          }
        }

        // 2D. Use Attack Tokens (cosIdx === 1)
        const atkTokens = clones.p2_tokens.filter(
          (t) => t.costumeIndex === 1 && Number(G.player2_token_list[t.vars.slotIndex]) > 0
        );

        if (atkTokens.length > 0 && clones.p2_monster.length > 0) {
          // Priority 1: Any monster at P1 base? Use all attack tokens on it!
          const baseAttacker = clones.p2_monster.find(
            (m) => (m.vars.row === 7 && m.vars.col === 2) ||
                   (m.vars.row === 6 && m.vars.col === 1) ||
                   (m.vars.row === 8 && m.vars.col === 1)
          );

          if (baseAttacker) {
            for (const atkTk of atkTokens) {
              if (!aiEnabled || !G.game_on || G.turn % 2 !== 1) return;
              updateStatusUI('🤖 AI 直接對紅方基地發動攻擊！');
              await onClickPlayer2Token(atkTk);
              await sleep(450);
              await onClickMonster(baseAttacker);
              await sleep(700);
            }
          } else {
            // Priority 2: Any monster adjacent to a P1 monster?
            let pair = null;
            for (const m of clones.p2_monster) {
              for (const em of clones.p1_monster) {
                if (Math.abs(m.vars.row - em.vars.row) + Math.abs(m.vars.col - em.vars.col) === 1) {
                  pair = { attacker: m, defender: em };
                  break;
                }
              }
              if (pair) break;
            }

            if (pair) {
              const myBaseAtk = getBaseAtk(pair.attacker.costumeIndex);
              const enemyBaseDef = getBaseDef(pair.defender.costumeIndex);
              const maxMyAtk = myBaseAtk + (atkTokens.length - 1);

              // Attack if we can beat or tie enemy base defense, or if our hand is full (>= 4 tokens)
              const activeHandSize = G.player2_token_list.filter((v) => Number(v) > 0).length;
              if (maxMyAtk >= enemyBaseDef || activeHandSize >= 4) {
                updateStatusUI('🤖 AI 對相鄰的紅方怪獸發起決鬥！');
                // First attack token initiates duel
                await onClickPlayer2Token(atkTokens[0]);
                await sleep(450);
                const atkPromise = onClickMonster(pair.attacker);
                // Wait until G.targetMonsterResolver is ready (after choose_attacked message)
                let waitTicks = 0;
                while (!G.targetMonsterResolver && waitTicks < 30) {
                  await sleep(100);
                  waitTicks++;
                }
                if (G.targetMonsterResolver) {
                  await onClickMonster(pair.defender);
                }
                await atkPromise;
                await sleep(500);

                // Stack extra attack tokens if needed to exceed enemyBaseDef
                let curAtk = Number(G.player2_mon_atk_def[pair.attacker.costumeIndex - 1]);
                for (let k = 1; k < atkTokens.length; k++) {
                  if (curAtk > enemyBaseDef) break;
                  await onClickPlayer2Token(atkTokens[k]);
                  await sleep(400);
                  await onClickMonster(pair.attacker);
                  curAtk = Number(G.player2_mon_atk_def[pair.attacker.costumeIndex - 1]);
                  await sleep(400);
                }

                // AI clicks P2's Prepare button and waits for P1 (Human) to optionally add defense and click P1's Prepare button!
                if (sprites.player2_font.visible && !p2Prepared) {
                  await sprites.player2_font.onClick();
                  updateStatusUI('⚔️ AI 已準備完成！請玩家 1 (紅方) 選擇是否點擊防禦徽章強化怪獸，接著點擊左下角「Prepare (準備完成)」結算決鬥！');
                }

                // Wait until duel is resolved by human clicking Prepare
                while (sprites.player1_font.visible && aiEnabled && G.game_on && G.turn % 2 === 1) {
                  await sleep(250);
                }
                await sleep(600);
              }
            }
          }
        }

        // 2E. Smart Hand Management & Active Shielding at End of AI Turn:
        // First, if AI has an unshielded monster and >= 2 Defense tokens (or hand >= 4 with a Defense token), actively put a Shield on its frontline monster!
        const defTokensEnd = clones.p2_tokens.filter(
          (t) => Number(G.player2_token_list[t.vars.slotIndex]) > 0 && t.costumeIndex === 2
        );
        const unshieldedMons = clones.p2_monster
          .filter((m) => !m.vars.shielded)
          .sort((a, b) => a.vars.col - b.vars.col);

        if (defTokensEnd.length > 0 && unshieldedMons.length > 0) {
          const curHand = G.player2_token_list.filter((v) => Number(v) > 0).length;
          if (defTokensEnd.length >= 2 || curHand >= 4) {
            updateStatusUI('🤖 AI 主動使用防禦徽章為前線怪獸掛上護盾 🛡️！');
            await onClickPlayer2Token(defTokensEnd[0]);
            await sleep(400);
            await onClickMonster(unshieldedMons[0]);
            await sleep(450);
          }
        }

        // Don't let AI clog all 5 slots with Attack/Defense tokens when it needs room for Move, Trap, or Summon!
        let activeTokens = clones.p2_tokens.filter(
          (t) => Number(G.player2_token_list[t.vars.slotIndex]) > 0 && t.costumeIndex !== 5
        );
        const curCount = G.player2_token_list.filter((v) => Number(v) > 0).length;

        if (!hasMonsterAlive(2) && curCount >= 3 && activeTokens.length > 0) {
          // When no monster is alive, leave at most 2 tokens (e.g. Defense/Attack) so there are 3 open slots!
          activeTokens.sort((a, b) => (a.costumeIndex === 2 ? 1 : -1) - (b.costumeIndex === 2 ? 1 : -1));
          const toDiscard = curCount - 2;
          for (let d = 0; d < toDiscard && d < activeTokens.length; d++) {
            if (!aiEnabled || !G.game_on || G.turn % 2 !== 1) return;
            updateStatusUI('🤖 AI 場上無怪獸，正在丟棄多餘徽章騰出空間...');
            consumeToken(2, activeTokens[d]);
            playSound('coinflip');
            await sleep(380);
          }
        } else if (curCount >= 4 && activeTokens.length > 0) {
          // Even when monsters ARE alive, if AI ends its turn with 4 or 5 tokens (meaning it couldn't use its Attack/Defense tokens),
          // discard excess Attack (1) or Defense (2) tokens down to 3 tokens so it always has 2 open slots for Move, Trap, or Summon!
          // Prefer discarding excess Attack tokens (if > 1) first, then excess Defense tokens (if > 1)
          const atkList = activeTokens.filter((t) => t.costumeIndex === 1);
          const defList = activeTokens.filter((t) => t.costumeIndex === 2);
          const discardOrder = [...atkList.slice(1), ...defList.slice(1), ...atkList, ...defList, ...activeTokens];
          const uniqueDiscard = [...new Set(discardOrder)];

          const toDiscard = curCount - 3; // Always leave 2 empty slots at end of turn!
          for (let d = 0; d < toDiscard && d < uniqueDiscard.length; d++) {
            if (!aiEnabled || !G.game_on || G.turn % 2 !== 1) return;
            updateStatusUI('🤖 AI 正在整理手牌，丟棄多餘的攻防徽章以騰出空間給移動/召喚...');
            consumeToken(2, uniqueDiscard[d]);
            playSound('coinflip');
            await sleep(380);
          }
        }

        // End AI Turn
        if (aiEnabled && G.game_on && G.turn % 2 === 1 && G.field === 1) {
          await sleep(500);
          await sprites.next_turn_btn.onClick();
        }
      }
    } finally {
      aiRunning = false;
    }
  }

  // Bind Top Toolbar Buttons
  const aiBtn = document.getElementById('btn-ai');
  aiBtn?.addEventListener('click', () => {
    aiEnabled = !aiEnabled;
    aiBtn.textContent = aiEnabled ? '🤖 P2：AI 對手 (開)' : '👥 P2：真人對戰 (關)';
    aiBtn.className = aiEnabled ? 'btn btn-primary' : 'btn';
    if (aiEnabled && G.game_on === 1) {
      if (G.turn % 2 === 1) triggerAITurn();
      else if (sprites.player2_font.visible && !p2Prepared) triggerAIDefenseReaction();
    }
  });

  document.getElementById('btn-save')?.addEventListener('click', () => {
    saveGameState(false);
  });

  document.getElementById('btn-load')?.addEventListener('click', () => {
    loadGameState();
  });

  document.getElementById('btn-restart')?.addEventListener('click', () => {
    initGreenFlag();
  });

  document.getElementById('btn-quickstart')?.addEventListener('click', async () => {
    initGreenFlag();
    playSound('playerenter');
    G.game_start = 2;
    G.game_on = 1;
    await onGameShow();
  });

  const soundBtn = document.getElementById('btn-sound');
  soundBtn?.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    soundBtn.textContent = soundEnabled ? '🔊 音效：開' : '🔇 音效：關';
  });

  // Boot
  loadAllAssets().then(() => {
    initGreenFlag();
    requestAnimationFrame(renderFrame);
  });
})();
