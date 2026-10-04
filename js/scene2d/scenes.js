/* scene2d/scenes.js —— 12 个 2D 生活场景（低多边形插画风）
 *
 * 每个场景是纯函数 draw(g, t, p, o)：
 *   t = 全局秒（所有动画都由它算，不用 Math.random → 导出可复现）
 *   p = 本段进度 0..1（可用来做「段内推进」，如镜头缓推）
 *   o = { mood, cast, place }
 * 分层顺序固定：天空 → 远景 → 中景 → 地面 → 主体 → 前景 → 光斑/天气 → 暗角
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});
  var S = FS.s2d;
  var W = S.W, H = S.H, HZ = S.HZ;
  var A = S.A, shade = S.shade;

  /* 段内缓推：p 0→1 时画面轻微推近（scale 1.0 → 1.04），让每段有推进感 */
  function push(g, p, amount) {
    var k = 1 + (amount === undefined ? 0.04 : amount) * S.easeOut(p);
    g.translate(W / 2, H / 2);
    g.scale(k, k);
    g.translate(-W / 2, -H / 2);
  }

  /** 统一暗角，把注意力收到中间 */
  function vignette(g, a) {
    var grd = S.glow(g, W / 2, H / 2, W * 0.72, '#000000', 0);
    g.save();
    var rg = g.createRadialGradient(W / 2, H / 2, W * 0.32, W / 2, H / 2, W * 0.75);
    rg.addColorStop(0, 'rgba(0,0,0,0)');
    rg.addColorStop(1, 'rgba(0,0,0,' + (a || 0.34) + ')');
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);
    g.restore();
  }

  /* ==================================================================
   * 1. 咖啡馆（室内·暖）
   * ================================================================== */
  function cafe(g, t, p, o) {
    S.sky(g, [[0, '#3a2b23'], [0.6, '#4a352a'], [1, '#5c4032']], 0, HZ);
    g.save(); push(g, p, 0.03);
    // 后墙 + 窗
    g.fillStyle = '#4a382c'; g.fillRect(0, 0, W, HZ);
    g.fillStyle = '#2a1f18';
    g.fillRect(80, 120, 300, 240);
    g.fillStyle = '#ffe6b8'; g.fillRect(92, 132, 276, 216);
    S.glow(g, 230, 240, 260, '#ffd9a0', 0.22);
    // 吧台
    g.fillStyle = '#3d2c20'; g.fillRect(0, HZ - 60, W, 60);
    g.fillStyle = '#6b4f3a'; g.fillRect(0, HZ - 72, W, 14);
    // 咖啡机
    g.fillStyle = '#2f3238'; g.fillRect(160, HZ - 200, 120, 128);
    g.fillStyle = '#8a8f98'; g.fillRect(172, HZ - 190, 96, 34);
    g.fillStyle = '#c9a06a'; g.fillRect(176, HZ - 168, 40, 8); g.fillRect(224, HZ - 168, 40, 8);
    // 吊灯（锥光 + 灯泡）
    S.lampCone(g, 640, 150, 210, 320, '#ffcf8a', 0.16);
    g.fillStyle = '#c98a3f';
    g.beginPath(); g.moveTo(600, 150); g.lineTo(680, 150); g.lineTo(660, 108); g.lineTo(620, 108); g.closePath(); g.fill();
    S.glow(g, 640, 150, 90, '#ffe9b0', 0.5);
    // 前景桌 + 杯（蒸汽）
    S.table2d(g, 430, 690, 420, 190, '#c9b79a', '#3a3a44');
    S.cup(g, 400, 500, 46, 40, '#f2ede2', t, {});
    S.cup(g, 476, 512, 38, 34, '#e8dcc8', t + 1.3, {});
    // 坐着的客人 + 对面的人
    S.personSil(g, { x: 250, baseY: 560, h: 190, color: '#4a5a6a', action: 'sit', t: t });
    S.personSil(g, { x: 880, baseY: 545, h: 200, color: '#6a4a5a', action: 'wave', t: t });
    S.cup(g, 852, 500, 40, 34, '#f2ede2', t + 0.7, {});
    S.particles(g, { n: 26, t: t, y0: 120, y1: HZ, color: '#ffd9a0', alpha: 0.16, size: 2.4, speed: 14 });
    g.restore();
    vignette(g, 0.42);
  }

  /* ==================================================================
   * 2. 街道（室外·白天）
   * ================================================================== */
  function street(g, t, p, o) {
    S.sky(g, [[0, '#7fb2e5'], [0.7, '#b8d4ee'], [1, '#dceaf6']], 0, HZ);
    // 远景楼群（视差：随 p 缓慢横移）
    var off = -p * 60;
    // 顺序是 [x, 宽, 高, 色]——写反的话 b[2] 拿到颜色当高度、b[3] 拿到数字当颜色，
    // 表现为 building() 里 shade(number) 抛「hex.slice is not a function」
    [[-60, 150, 300, '#a89f92'], [140, 120, 230, '#b9b2a6'], [330, 170, 360, '#9f9789'],
     [560, 130, 270, '#b0a89c'], [790, 160, 330, '#a49b8e'], [1010, 140, 250, '#b5ada0']].forEach(function (b) {
      S.building(g, { x: b[0] + off, y: HZ, w: b[1], h: b[2], color: b[3], depth: 18, windows: true, winRows: 3, winCols: 3, lit: 0.12, winColor: '#cfe0ee' });
    });
    S.haze(g, HZ - 30, 80, '#cfe0f0', 0.5);
    // 地面
    g.fillStyle = '#45494f'; g.fillRect(0, HZ, W, H - HZ);
    S.groundBand(g, { y0: H, y1: HZ + 10, x0: 90, x1: 1190, xr0: 560, xr1: 720, color: '#6b6f76' });
    g.strokeStyle = A('#f0e6a8', 0.5); g.lineWidth = 4;
    g.setLineDash([40, 34]);
    g.beginPath(); g.moveTo(640, HZ + 10); g.lineTo(640, H); g.stroke();
    g.setLineDash([]);
    // 路灯
    [180, 1050].forEach(function (x) {
      g.fillStyle = '#2f3238'; g.fillRect(x - 4, HZ - 200, 8, 200);
      g.fillRect(x - 4, HZ - 200, 40, 8);
      S.glow(g, x + 32, HZ - 192, 46, '#fff4cf', 0.5);
    });
    // 车
    g.fillStyle = '#c0483f';
    g.fillRect(830, HZ + 34, 190, 46);
    g.fillStyle = '#2f3a45';
    g.beginPath(); g.moveTo(852, HZ + 34); g.lineTo(880, HZ - 2); g.lineTo(950, HZ - 2); g.lineTo(976, HZ + 34); g.closePath(); g.fill();
    // 行人（走）
    S.personSil(g, { x: 300 + ((t * 40) % 700), baseY: 660, h: 150, color: '#33404f', action: 'walk', t: t });
    S.personSil(g, { x: 980 - ((t * 26) % 520), baseY: 620, h: 128, color: '#4a3f52', action: 'walk', t: t + 1 });
    S.catSil(g, { x: 180, baseY: 700, s: 0.5, action: 'sit', t: t });
    S.birdSil(g, 300 + ((t * 26) % 700), 130, 1, '#3a3a44');
    vignette(g, 0.28);
  }

  /* ==================================================================
   * 3. 公园（室外·绿色）
   * ================================================================== */
  function park(g, t, p, o) {
    S.sky(g, [[0, '#6fa8e0'], [0.75, '#bfe0ee'], [1, '#e4f2e2']], 0, HZ);
    S.glow(g, 1080, 120, 90, '#fff6c8', 0.5);
    // 远树
    [[120, 0.8], [420, 0.62], [760, 0.7], [1080, 0.58], [1300, 0.75]].forEach(function (tr, i) {
      S.tree(g, tr[0] - p * 40, HZ + 8, 210 * tr[1], { leaf: i % 2 ? '#3f7a46' : '#468a4a' });
    });
    S.haze(g, HZ, 60, '#cfe3c8', 0.45);
    // 草地
    g.fillStyle = '#6aa35c'; g.fillRect(0, HZ, W, H - HZ);
    S.groundGrid(g, { hz: HZ, color: '#4f8a48', a: 0.16, cols: 10, rows: 5, drift: p });
    // 小径
    S.groundBand(g, { y0: H, y1: HZ + 6, x0: 200, x1: 900, xr0: 600, xr1: 680, color: '#cbbfa4' });
    // 长椅 + 坐着的人
    g.fillStyle = '#8a6a45'; g.fillRect(150, HZ + 150, 190, 16);
    g.fillStyle = '#8a6a45'; g.fillRect(150, HZ + 118, 190, 12);
    g.fillStyle = '#3a3a44'; g.fillRect(162, HZ + 166, 12, 40); g.fillRect(316, HZ + 166, 12, 40);
    S.personSil(g, { x: 210, baseY: HZ + 150, h: 150, color: '#5a6a8a', action: 'sit', t: t });
    S.personSil(g, { x: 276, baseY: HZ + 150, h: 138, color: '#8a6a5a', action: 'sit', t: t + 0.6 });
    // 跑的人 + 狗
    S.personSil(g, { x: 700 + ((t * 120) % 640) - 200, baseY: 690, h: 160, color: '#3f5a7a', action: 'run', t: t });
    S.catSil(g, { x: 260, baseY: 700, s: 0.55, action: 'walk', t: t });
    // 鸽子
    for (var i = 0; i < 3; i++) {
      S.birdSil(g, 420 + i * 46 + Math.sin(t * 0.7 + i) * 30, 250 + i * 20, 0.8, '#4a4a55');
    }
    S.particles(g, { n: 30, t: t, y0: 200, y1: H, color: '#e8f4c8', alpha: 0.3, size: 2.2, speed: 10, sway: 20 });
    vignette(g, 0.24);
  }

  /* ==================================================================
   * 4. 海边（室外·黄昏）
   * ================================================================== */
  function seaside(g, t, p, o) {
    S.sky(g, [[0, '#3f6fa8'], [0.45, '#c98a6a'], [0.8, '#f0b878'], [1, '#f7d8a8']], 0, 460);
    // 落日
    S.glow(g, 980, 430, 200, '#ffb867', 0.55);
    g.fillStyle = '#ffd98a';
    g.beginPath(); g.arc(980, 430, 44, 0, Math.PI * 2); g.fill();
    // 海（波纹横线，随 t 起伏）
    g.fillStyle = '#2f6f96'; g.fillRect(0, 440, W, 200);
    for (var i = 0; i < 16; i++) {
      var y = 448 + i * 12;
      var ph = t * 1.6 + i * 0.7;
      g.strokeStyle = A(i % 2 ? '#7fc0d8' : '#a8d8e8', 0.28 + 0.2 * Math.sin(ph));
      g.lineWidth = 2 + i * 0.12;
      g.beginPath();
      for (var x = 0; x <= W; x += 40) {
        var yy = y + Math.sin(x * 0.012 + ph) * (2 + i * 0.22);
        if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
      }
      g.stroke();
    }
    // 沙滩
    g.fillStyle = '#e0cfa4';
    g.beginPath();
    g.moveTo(0, 640);
    g.quadraticCurveTo(W / 2, 616, W, 640);
    g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();
    // 浪花线
    g.strokeStyle = A('#ffffff', 0.5); g.lineWidth = 3;
    g.beginPath();
    for (var x2 = 0; x2 <= W; x2 += 20) {
      var yy2 = 640 + Math.sin(x2 * 0.02 + t * 2) * 4;
      if (x2 === 0) g.moveTo(x2, yy2); else g.lineTo(x2, yy2);
    }
    g.stroke();
    // 椰树
    g.fillStyle = '#7a5c3e';
    g.beginPath();
    g.moveTo(180, 700); g.quadraticCurveTo(200, 480, 250, 380);
    g.lineTo(268, 384); g.quadraticCurveTo(224, 486, 206, 700);
    g.closePath(); g.fill();
    for (var f = 0; f < 5; f++) {
      var a = -2.5 + f * 0.5 + Math.sin(t * 0.8 + f) * 0.04;
      g.fillStyle = shade('#4f9a52', 0.8 + f * 0.06);
      g.beginPath();
      g.ellipse(258 + Math.cos(a) * 60, 380 + Math.sin(a) * 34, 66, 16, a, 0, Math.PI * 2);
      g.fill();
    }
    // 礁石
    g.fillStyle = '#8a8378';
    g.beginPath(); g.ellipse(980, 680, 90, 34, 0, Math.PI, 0); g.fill();
    g.fillStyle = '#7d7669';
    g.beginPath(); g.ellipse(1080, 690, 60, 22, 0, Math.PI, 0); g.fill();
    // 人物：追蝴蝶 / 站着看海
    S.personSil(g, { x: 520, baseY: 700, h: 165, color: '#3a4a5a', action: 'walk', t: t });
    S.personSil(g, { x: 640, baseY: 690, h: 158, color: '#5a4a6a', action: 'stand', t: t });
    // 蝴蝶
    var bx = 540 + Math.sin(t * 1.4) * 70, by = 420 + Math.sin(t * 2.2) * 40;
    g.fillStyle = '#f0a0c0';
    g.beginPath(); g.ellipse(bx - 7, by, 8, 6, Math.sin(t * 12) * .5, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(bx + 7, by, 8, 6, -Math.sin(t * 12) * .5, 0, Math.PI * 2); g.fill();
    S.birdSil(g, 200 + ((t * 40) % 900), 160 + Math.sin(t) * 20, 1.1, '#3a3a44');
    vignette(g, 0.3);
  }

  /* ==================================================================
   * 5. 书房（室内·安静）
   * ================================================================== */
  function study(g, t, p, o) {
    S.sky(g, [[0, '#252a31'], [1, '#343a42']], 0, HZ);
    // 书架墙
    g.fillStyle = '#4d3a2c'; g.fillRect(60, 60, 520, 400);
    for (var r = 0; r < 4; r++) {
      g.fillStyle = '#3a2a20'; g.fillRect(70, 150 + r * 92, 500, 10);
      for (var b = 0; b < 14; b++) {
        var hue = [0, 24, 48, 190, 210, 340][(r * 5 + b) % 6];
        g.fillStyle = 'hsl(' + hue + ',45%,' + (42 + ((r + b) % 3) * 8) + '%)';
        var bh = 46 + ((r * 7 + b * 13) % 5) * 6;
        g.fillRect(78 + b * 35, 150 + r * 92 - bh, 26, bh);
      }
    }
    // 窗（月光）
    g.fillStyle = '#1b2733'; g.fillRect(760, 90, 400, 300);
    g.fillStyle = '#e8f0ff'; g.beginPath(); g.arc(1030, 170, 30, 0, Math.PI * 2); g.fill();
    S.glow(g, 1030, 170, 120, '#cfe0ff', 0.3);
    g.strokeStyle = '#3a4450'; g.lineWidth = 8;
    g.strokeRect(760, 90, 400, 300);
    g.beginPath(); g.moveTo(960, 90); g.lineTo(960, 390); g.moveTo(760, 240); g.lineTo(1160, 240); g.stroke();
    // 地板
    g.fillStyle = '#8a6a4a'; g.fillRect(0, HZ, W, H - HZ);
    S.groundGrid(g, { hz: HZ, color: '#6b4f3a', a: 0.2, cols: 8, rows: 4, drift: p * 0.4 });
    // 书桌 + 台灯（灯光锥）
    S.table2d(g, 520, 660, 420, 170, '#c9a06a', '#3a3a44');
    S.lampCone(g, 660, 500, 120, 220, '#ffe0a8', 0.2);
    g.fillStyle = '#2f3238'; g.fillRect(654, 500, 12, -80);
    g.fillStyle = '#fff0c0'; g.beginPath(); g.arc(660, 414, 12, 0, Math.PI * 2); g.fill();
    S.glow(g, 660, 414, 60, '#ffe9b0', 0.5);
    // 摊开的书
    g.fillStyle = '#f0ead8';
    g.beginPath(); g.moveTo(430, 560); g.lineTo(520, 546); g.lineTo(520, 596); g.lineTo(430, 606); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(520, 546); g.lineTo(610, 560); g.lineTo(610, 606); g.lineTo(520, 596); g.closePath(); g.fill();
    g.strokeStyle = A('#8a8f98', 0.6); g.lineWidth = 1;
    for (var ln = 0; ln < 5; ln++) {
      g.beginPath(); g.moveTo(440, 566 + ln * 8); g.lineTo(512, 556 + ln * 8); g.stroke();
      g.beginPath(); g.moveTo(528, 556 + ln * 8); g.lineTo(600, 566 + ln * 8); g.stroke();
    }
    // 伏案的人
    S.personSil(g, { x: 350, baseY: 700, h: 175, color: '#3f4a5a', action: 'sit', t: t });
    S.particles(g, { n: 22, t: t, y0: 100, y1: HZ, color: '#cfe0ff', alpha: 0.18, size: 2, speed: 8, sway: 14 });
    vignette(g, 0.44);
  }

  /* ==================================================================
   * 6. 夜市（室外·夜）
   * ================================================================== */
  function nightmarket(g, t, p, o) {
    S.sky(g, [[0, '#151220'], [1, '#2a2430']], 0, HZ);
    // 远处楼影
    g.fillStyle = '#1a1826';
    g.fillRect(0, 240, W, HZ - 240);
    // 摊位（4 个，带蒸汽与灯）
    var stallX = [90, 380, 670, 960];
    for (var i = 0; i < 4; i++) {
      var x = stallX[i];
      var c = ['#c0483f', '#3f7fc0', '#c08a3f', '#5aa06a'][i];
      // 布篷
      g.fillStyle = c;
      g.beginPath();
      g.moveTo(x, 300); g.lineTo(x + 220, 282); g.lineTo(x + 220, 320); g.lineTo(x, 336); g.closePath(); g.fill();
      // 灯（闪烁）
      var flick = 0.75 + 0.25 * Math.sin(t * (2 + i) + i);
      S.glow(g, x + 110, 336, 130, '#ffd070', 0.3 * flick);
      g.fillStyle = '#ffdf9a';
      g.beginPath(); g.arc(x + 110, 336, 13, 0, Math.PI * 2); g.fill();
      // 摊台 + 货
      g.fillStyle = '#5a4a3a'; g.fillRect(x, 430, 220, 26);
      g.fillStyle = '#3a3a44'; g.fillRect(x + 8, 456, 12, 110); g.fillRect(x + 200, 456, 12, 110);
      for (var k = 0; k < 4; k++) {
        g.fillStyle = ['#e8c05a', '#c0683f', '#7ab05a'][k % 3];
        g.fillRect(x + 20 + k * 48, 404, 34, 26);
      }
      // 蒸汽
      S.glow(g, x + 150, 400, 60, '#ffd9a0', 0.14);
      // 招牌
      S.sign(g, x + 30, 366, 160, 32, ['面', '串', '糖水', '茶'][i], { bg: '#1f2937', fg: '#ffdf9a', glowOn: true });
    }
    // 地面 + 人影（走动）
    g.fillStyle = '#3a3a42'; g.fillRect(0, HZ, W, H - HZ);
    S.groundGrid(g, { hz: HZ, color: '#5a5a62', a: 0.18, cols: 9, rows: 4, drift: p });
    // 灯笼串
    for (var l = 0; l < 9; l++) {
      var lx = 60 + l * 145;
      var ly = 200 + Math.sin(l * 0.9) * 18 + Math.sin(t * 1.2 + l) * 4;
      g.strokeStyle = A('#ff6f5a', 0.7); g.lineWidth = 2;
      g.beginPath(); g.moveTo(lx, ly - 20); g.lineTo(lx, ly - 8); g.stroke();
      g.fillStyle = l % 2 ? '#ff6f5a' : '#ffd76f';
      g.beginPath(); g.ellipse(lx, ly, 15, 18, 0, 0, Math.PI * 2); g.fill();
    }
    for (var pp = 0; pp < 3; pp++) {
      S.personSil(g, {
        x: 200 + pp * 400 + ((t * (34 + pp * 12)) % 500) - 120, baseY: 660 + pp * 18,
        h: 150 - pp * 8, color: ['#3a3a48', '#4a3a44', '#2f3a44'][pp],
        action: 'walk', t: t + pp
      });
    }
    vignette(g, 0.4);
  }

  FS.s2dScenes = { cafe: cafe, street: street, park: park, seaside: seaside, study: study, nightmarket: nightmarket };
})(typeof window !== 'undefined' ? window : this);
