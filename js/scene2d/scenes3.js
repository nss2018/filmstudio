/* scene2d/scenes3.js —— 第二批生活场景的 2D 插画版（追加进同一个注册表）
 *
 * 客厅 / 办公室 / 面包房 / 医院病房 / 田埂麦田 / 公交站
 * 与 3D 的 world3.js 一一对应，数量补齐后 2D 就不需要再顺延回退到别的场景了。
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});
  var S;

  function boot() {
    S = FS.s2d;
    var W = S.W, H = S.H, HZ = S.HZ;
    var A = S.A, shade = S.shade, lerp = S.lerp;

    function push(g, p, amount) {
      var k = 1 + (amount === undefined ? 0.04 : amount) * S.easeOut(p);
      g.translate(W / 2, H / 2); g.scale(k, k); g.translate(-W / 2, -H / 2);
    }
    function vignette(g, a) {
      var rg = g.createRadialGradient(W / 2, H / 2, W * 0.32, W / 2, H / 2, W * 0.75);
      rg.addColorStop(0, 'rgba(0,0,0,0)');
      rg.addColorStop(1, 'rgba(0,0,0,' + (a || 0.34) + ')');
      g.fillStyle = rg; g.fillRect(0, 0, W, H);
    }
    function floorSlab(g, y, col) {
      g.fillStyle = col; g.fillRect(0, y, W, H - y);
    }
    /** 木地板条纹（透视收敛到 vp） */
    function woodFloor(g, y0, cA, cB) {
      floorSlab(g, y0, cA);
      var vp = W / 2;
      g.strokeStyle = A('#3a2a1c', 0.35); g.lineWidth = 2;
      for (var i = -8; i <= 8; i++) {
        g.beginPath();
        g.moveTo(W / 2 + i * 26, y0);
        g.lineTo(vp + i * 210, H);
        g.stroke();
      }
      g.strokeStyle = A('#3a2a1c', 0.22);
      for (var r = 1; r < 5; r++) {
        var yy = y0 + (H - y0) * (r / 5) * (r / 5);
        g.beginPath(); g.moveTo(0, yy); g.lineTo(W, yy); g.stroke();
      }
      g.fillStyle = cB;
    }

    /* ==================================================================
     * 19. 客厅（室内·暖）
     * ================================================================== */
    function livingroom(g, t, p, o) {
      S.sky(g, [[0, '#efe9dd'], [1, '#d8cdbb']], 0, HZ);
      floorSlab(g, HZ - 40, '#9a7550');
      woodFloor(g, HZ - 40, '#9a7550', '#a8805a');
      // 地毯
      g.fillStyle = A('#b08a6a', 0.85);
      g.beginPath(); g.ellipse(W / 2, HZ + 110, 300, 96, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = A('#8f6a4a', 0.7); g.lineWidth = 4;
      g.beginPath(); g.ellipse(W / 2, HZ + 110, 258, 78, 0, 0, Math.PI * 2); g.stroke();
      // 窗（黄昏暖光）
      g.fillStyle = '#ffeec8'; g.fillRect(W - 420, 150, 260, 220);
      g.strokeStyle = '#e8e2d6'; g.lineWidth = 8;
      g.strokeRect(W - 420, 150, 260, 220);
      g.beginPath(); g.moveTo(W - 290, 150); g.lineTo(W - 290, 370); g.stroke();
      g.beginPath(); g.moveTo(W - 420, 260); g.lineTo(W - 160, 260); g.stroke();
      S.glow(g, W - 290, 260, 240, '#ffdca0', 0.26);
      // 电视柜 + 电视
      g.fillStyle = '#5a4535'; g.fillRect(120, HZ + 10, 300, 30);
      g.fillStyle = '#1c1c22'; g.fillRect(160, 250, 230, 130);
      g.fillStyle = A('#6fa8d8', 0.92); g.fillRect(172, 262, 206, 106);
      S.glow(g, 275, 315, 210, '#8fd0f0', 0.2);
      g.fillStyle = A('#dfe8f0', 0.5); g.fillRect(172, 262, 206, 26);
      // 沙发
      g.fillStyle = '#6a7f9a'; g.fillRect(430, HZ + 30, 380, 70);
      g.fillStyle = shade('#6a7f9a', 1.08); g.fillRect(430, HZ - 10, 380, 52);
      g.fillStyle = shade('#6a7f9a', 0.88);
      g.fillRect(420, HZ - 10, 26, 96);
      g.fillRect(774, HZ - 10, 26, 96);
      g.fillStyle = shade('#6a7f9a', 0.8); g.fillRect(430, HZ + 56, 380, 18);
      g.fillStyle = '#c86a7a'; g.fillRect(470, HZ + 2, 70, 40);   // 抱枕
      // 茶几 + 杯子
      g.fillStyle = '#8a6a4a'; g.fillRect(520, HZ + 138, 190, 14);
      g.fillStyle = '#6b5236'; g.fillRect(534, HZ + 152, 16, 46);
      g.fillRect(672, HZ + 152, 16, 46);
      S.cup(g, { x: 600, y: HZ + 130, s: 1, color: '#f2eee4' });
      // 落地灯
      g.fillStyle = '#2f3238'; g.fillRect(W - 170, HZ - 130, 8, 190);
      g.fillStyle = '#e8d8b0';
      g.beginPath(); g.moveTo(W - 190, HZ - 130); g.lineTo(W - 110, HZ - 130);
      g.lineTo(W - 160, HZ - 250); g.lineTo(W - 140, HZ - 250); g.closePath(); g.fill();
      S.lampCone(g, W - 150, HZ - 240, 70, 260, '#ffdca0', 0.16);
      // 人坐在沙发上
      S.personSil(g, { x: 620, baseY: HZ + 96, h: 150, color: '#3a4a5a', action: 'sit', t: t });
      S.birdSil(g, { x: W - 300, baseY: 250, s: 0.5, action: 'fly', t: t });
      g.save(); push(g, p, 0.03); g.restore();
      vignette(g, 0.34);
    }

    /* ==================================================================
     * 20. 办公室（室内·冷白）
     * ================================================================== */
    function office(g, t, p, o) {
      S.sky(g, [[0, '#eef2f6'], [1, '#c8d0d8']], 0, HZ);
      floorSlab(g, HZ + 10, '#5a5f66');
      // 隔断 + 桌面
      for (var i = 0; i < 3; i++) {
        var x = 90 + i * 420;
        g.fillStyle = '#7a8290'; g.fillRect(x - 110, 200, 220, HZ - 100);
        g.fillStyle = '#c8c2b4'; g.fillRect(x - 100, HZ - 40, 200, 14);
        g.fillStyle = '#5a5a60'; g.fillRect(x - 90, HZ - 26, 180, 10);
        // 显示器
        g.fillStyle = '#2a2e34'; g.fillRect(x - 46, HZ - 150, 92, 66);
        g.fillStyle = A('#7ea8d8', 0.9); g.fillRect(x - 38, HZ - 142, 76, 50);
        S.glow(g, x, HZ - 116, 130, '#9ec8e8', 0.16);
        // 键盘 + 文件
        g.fillStyle = '#3f444c'; g.fillRect(x - 46, HZ - 52, 92, 8);
        g.fillStyle = '#f4f2ea'; g.fillRect(x + 30, HZ - 50, 46, 22);
        g.fillStyle = '#dcd8cc'; g.fillRect(x + 42, HZ - 46, 34, 14);
        S.personSil(g, { x: x, baseY: HZ - 20, h: 130, color: '#3a4048', action: 'sit', t: t + i });
      }
      // 顶灯 + 吊顶
      g.fillStyle = '#4a5058'; g.fillRect(0, 96, W, 26);
      for (var l = 0; l < 4; l++) {
        var lx = 140 + l * 260;
        g.fillStyle = '#f4f0e4'; g.fillRect(lx - 44, 122, 88, 8);
        S.glow(g, lx, 150, 150, '#f4f0e4', 0.12);
      }
      // 会议室玻璃
      g.fillStyle = A('#9fc4d8', 0.32); g.fillRect(W - 300, 190, 280, HZ - 60);
      g.strokeStyle = A('#8a9098', 0.8); g.lineWidth = 4;
      g.strokeRect(W - 300, 190, 280, HZ - 60);
      S.bush(g, { x: 150, y: HZ + 20, s: 1.1, c: '#3f8a4a' });
      g.save(); push(g, p, 0.03); g.restore();
      vignette(g, 0.3);
    }

    /* ==================================================================
     * 21. 面包房（室内·暖黄）
     * ================================================================== */
    function bakery(g, t, p, o) {
      S.sky(g, [[0, '#efe4cc'], [1, '#d8c8a8']], 0, HZ);
      floorSlab(g, HZ + 20, '#c4bcae');
      g.strokeStyle = A('#a89e8c', 0.6); g.lineWidth = 3;
      for (var f = 0; f < 5; f++) {
        var y = HZ + 20 + f * 34;
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      }
      // 招牌
      S.sign(g, W / 2 - 110, 120, 220, 66, '面包', { bg: '#8a5a3a', fg: '#ffd88a', glowOn: true });
      // 烤箱
      g.fillStyle = '#5a5a60'; g.fillRect(W - 330, HZ - 250, 240, 250);
      g.fillStyle = A('#ff9a4a', 0.92); g.fillRect(W - 300, HZ - 210, 180, 90);
      S.glow(g, W - 210, HZ - 165, 190, '#ff9a4a', 0.3);
      g.fillStyle = '#3f4248'; g.fillRect(W - 250, HZ - 80, 220, 16);
      // 面包架
      g.fillStyle = '#8a6338'; g.fillRect(120, HZ - 230, 260, 14);
      g.fillStyle = '#8a6338'; g.fillRect(120, HZ - 150, 260, 14);
      g.fillStyle = '#8a6338'; g.fillRect(120, HZ - 70, 260, 14);
      for (var b = 0; b < 6; b++) {
        for (var r = 0; r < 3; r++) {
          g.fillStyle = ['#c88a4a', '#d8a860', '#a8643f'][(b + r) % 3];
          g.beginPath(); g.arc(146 + b * 42, HZ - 240 - r * 82, 17, 0, Math.PI * 2); g.fill();
        }
      }
      // 柜台 + 玻璃甜点柜
      g.fillStyle = '#a8763f'; g.fillRect(300, HZ - 96, 420, 96);
      g.fillStyle = '#d8ccb0'; g.fillRect(288, HZ - 110, 444, 16);
      g.fillStyle = A('#cfe0e8', 0.5); g.fillRect(330, HZ - 240, 360, 130);
      g.strokeStyle = A('#8a9098', 0.7); g.lineWidth = 3;
      g.strokeRect(330, HZ - 240, 360, 130);
      for (var c = 0; c < 4; c++) {
        g.fillStyle = ['#f2d8c0', '#c88a9a', '#d8c070', '#a8c0a8'][c];
        g.beginPath(); g.arc(366 + c * 88, HZ - 180, 24, 0, Math.PI * 2); g.fill();
      }
      // 吊灯
      for (var l = 0; l < 3; l++) {
        var lx = 300 + l * 220;
        g.fillStyle = '#3a3028'; g.fillRect(lx - 3, 150, 6, 90);
        g.fillStyle = '#f0d090';
        g.beginPath(); g.moveTo(lx - 30, 240); g.lineTo(lx + 30, 240);
        g.lineTo(lx + 16, 272); g.lineTo(lx - 16, 272); g.closePath(); g.fill();
        S.glow(g, lx, 258, 130, '#ffdca0', 0.2);
      }
      S.personSil(g, { x: 520, baseY: HZ + 20, h: 150, color: '#4a3a2c', action: 'stand', t: t });
      // 蒸汽
      S.particles(g, {
        n: 26, t: t, y0: HZ - 260, y1: HZ - 470, color: '#f2ece0',
        alpha: 0.22, size: 12, speed: 40, shape: 'blob', drift: 30
      });
      g.save(); push(g, p, 0.03); g.restore();
      vignette(g, 0.36);
    }

    return { livingroom: livingroom, office: office, bakery: bakery };
  }

  var REG = boot();

  /* 后三个场景与注册放在第二段的 boot 里，保证前三个先注册完 */
  (function () {
    var S2, W, H, HZ, A, shade2, lerp2;
    S2 = FS.s2d; W = S2.W; H = S2.H; HZ = S2.HZ;
    A = S2.A; shade2 = S2.shade; lerp2 = S2.lerp;

    /* 田埂 / 麦田 / 医院 / 公交站 的公共小工具 */
    function hazeFloor(g, y, c) {
      g.fillStyle = c; g.fillRect(0, y, W, H - y);
    }
    function vignette(g, a) {
      var rg = g.createRadialGradient(W / 2, H / 2, W * 0.32, W / 2, H / 2, W * 0.75);
      rg.addColorStop(0, 'rgba(0,0,0,0)');
      rg.addColorStop(1, 'rgba(0,0,0,' + (a || 0.34) + ')');
      g.fillStyle = rg; g.fillRect(0, 0, W, H);
    }
    function push(g, p, amount) {
      var k = 1 + (amount === undefined ? 0.04 : amount) * S2.easeOut(p);
      g.translate(W / 2, H / 2); g.scale(k, k); g.translate(-W / 2, -H / 2);
    }
    /** 麦浪：一排会摆动的竖穗 */
    function wheat(g, y, n, col, sway, t) {
      g.strokeStyle = col; g.lineWidth = 3;
      for (var i = 0; i < n; i++) {
        var wx = (i + 0.5) * (W / n);
        var h = 26 + ((i * 37) % 26);
        var sw = Math.sin(t * 1.6 + i * 0.7) * (sway || 8);
        g.beginPath();
        g.moveTo(wx, y);
        g.quadraticCurveTo(wx + sw * 0.6, y - h * 0.6, wx + sw, y - h);
        g.stroke();
        g.fillStyle = col;
        g.beginPath(); g.ellipse(wx + sw, y - h - 3, 3.4, 7, 0, 0, Math.PI * 2); g.fill();
      }
    }

    /* ==================================================================
     * 22. 医院病房（室内·冷白）
     * ================================================================== */
    function hospital(g, t, p, o) {
      S2.sky(g, [[0, '#eef4f8'], [1, '#c8d4dc']], 0, HZ);
      hazeFloor(g, HZ + 16, '#9aa4ac');
      // 窗（冷白光）
      g.fillStyle = '#dceaf4'; g.fillRect(W - 380, 150, 240, 200);
      g.strokeStyle = '#b8c4cc'; g.lineWidth = 8;
      g.strokeRect(W - 380, 150, 240, 200);
      S2.glow(g, W - 260, 250, 220, '#dceaf6', 0.22);
      // 病床
      g.fillStyle = '#5a6470'; g.fillRect(150, HZ - 60, 380, 16);
      g.fillStyle = '#8a949c'; g.fillRect(170, HZ - 44, 12, 44);
      g.fillStyle = '#8a949c'; g.fillRect(498, HZ - 44, 12, 44);
      g.fillStyle = '#f2f6f8'; g.fillRect(158, HZ - 78, 364, 26);
      g.fillStyle = '#9ab8cc'; g.fillRect(150, HZ - 120, 380, 44);
      g.fillStyle = '#f8faf8'; g.beginPath(); g.ellipse(210, HZ - 96, 44, 22, 0, 0, Math.PI * 2); g.fill();
      // 床头柜 + 水杯
      g.fillStyle = '#a8b0b6'; g.fillRect(560, HZ - 92, 60, 92);
      g.fillStyle = A('#7fd0e8', 0.9); g.fillRect(576, HZ - 80, 28, 20);
      // 输液架
      g.fillStyle = '#8a949c'; g.fillRect(660, HZ - 250, 7, 250);
      g.fillStyle = '#dfe8f0';
      g.beginPath(); g.ellipse(664, HZ - 280, 20, 26, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = A('#a8e0f4', 0.8);
      g.beginPath(); g.ellipse(664, HZ - 278, 14, 19, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#dfe8f0'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(664, HZ - 258); g.lineTo(664, HZ - 160); g.stroke();
      S2.glow(g, 664, HZ - 278, 70, '#a8e0f4', 0.2);
      // 陪客椅 + 坐着的人
      g.fillStyle = '#6a7a88'; g.fillRect(330, HZ - 40, 70, 40);
      g.fillStyle = shade2('#6a7a88', 1.1); g.fillRect(330, HZ - 90, 70, 52);
      S2.personSil(g, { x: 365, baseY: HZ - 40, h: 130, color: '#4a5560', action: 'sit', t: t });
      // 顶灯
      S2.lampCone(g, W / 2, 90, W * 0.5, 240, '#f0f6fb', 0.1);
      g.save(); push(g, p, 0.03); g.restore();
      vignette(g, 0.3);
    }

    /* ==================================================================
     * 23. 田埂麦田（户外·黄昏）
     * ================================================================== */
    function farmfield(g, t, p, o) {
      S2.sky(g, [[0, '#6a8fc0'], [0.55, '#e8c89a'], [1, '#f3d2a4']], 0, HZ);
      // 远山 + 谷仓
      g.fillStyle = '#8a9a7a';
      g.beginPath(); g.moveTo(0, HZ);
      g.lineTo(120, HZ - 150); g.lineTo(280, HZ - 60); g.lineTo(420, HZ - 190);
      g.lineTo(660, HZ - 90); g.lineTo(820, HZ - 170); g.lineTo(W, HZ - 60);
      g.lineTo(W, HZ); g.closePath(); g.fill();
      g.fillStyle = '#a8402f'; g.fillRect(120, HZ - 160, 140, 110);
      g.fillStyle = '#7a3025';
      g.beginPath(); g.moveTo(108, HZ - 160); g.lineTo(190, HZ - 220);
      g.lineTo(272, HZ - 160); g.closePath(); g.fill();
      g.fillStyle = '#d8c8a0'; g.fillRect(160, HZ - 110, 56, 70);
      S2.glow(g, 188, HZ - 74, 70, '#ffdca0', 0.3);
      // 田垄 + 麦浪
      hazeFloor(g, HZ, '#a8905f');
      for (var r = 0; r < 5; r++) {
        var ry = HZ + 8 + r * 34;
        g.fillStyle = shade2('#8a6a44', 1 + r * 0.06);
        g.fillRect(0, ry, W, 24);
        wheat(g, ry, 22 + r * 3, shade2('#c8b048', 1 + r * 0.05), 7 + r, t + r);
      }
      // 稻草人
      var sx = 470, sy = HZ + 120;
      g.strokeStyle = '#6b4f3a'; g.lineWidth = 8;
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx, sy - 170); g.stroke();
      g.lineWidth = 6;
      g.beginPath(); g.moveTo(sx - 46, sy - 120); g.lineTo(sx + 46, sy - 120); g.stroke();
      g.fillStyle = '#d8c490';
      g.beginPath(); g.arc(sx, sy - 190, 24, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#a8763f';
      g.beginPath(); g.moveTo(sx - 38, sy - 206); g.lineTo(sx + 38, sy - 206);
      g.lineTo(sx, sy - 244); g.closePath(); g.fill();
      g.fillStyle = '#8a6a4a'; g.fillRect(sx - 22, sy - 136, 44, 42);
      g.fillStyle = A('#f2d8a0', 0.9); g.fillRect(sx - 14, sy - 130, 28, 12);
      // 树 + 鸟
      S2.tree(g, { x: 880, baseY: HZ + 60, s: 1.5, c: '#4f8a48' });
      S2.birdSil(g, { x: 240, baseY: 210, s: 0.6, action: 'fly', t: t });
      S2.birdSil(g, { x: 320, baseY: 250, s: 0.42, action: 'fly', t: t + 1.4 });
      S2.personSil(g, { x: 700, baseY: HZ + 130, h: 150, color: '#5a4a3a', action: 'stand', t: t });
      g.save(); push(g, p, 0.03); g.restore();
      vignette(g, 0.28);
    }

    /* ==================================================================
     * 24. 公交站（户外·城市边）
     * ================================================================== */
    function busstop(g, t, p, o) {
      S2.sky(g, [[0, '#7fb2e5'], [1, '#dceaf6']], 0, HZ);
      // 背景楼
      for (var b = 0; b < 6; b++) {
        var bx = -60 + b * 260, bh = 180 + ((b * 73) % 120), by = HZ - bh;
        g.fillStyle = ['#c8b8a0', '#b8a890', '#d0c0ac'][b % 3];
        g.fillRect(bx, by, 220, bh);
        for (var r = 0; r < 4; r++) {
          for (var c = 0; c < 3; c++) {
            if ((b + r + c) % 3) continue;
            g.fillStyle = A('#ffeec0', 0.8);
            g.fillRect(bx + 24 + c * 62, by + 30 + r * 46, 36, 28);
          }
        }
      }
      // 路 + 人行道
      g.fillStyle = '#9a9690'; g.fillRect(0, HZ - 30, W, 30);
      g.fillStyle = '#41454a'; g.fillRect(0, HZ, W, H - HZ);
      S2.groundGrid(g, { hz: HZ, vp: W / 2, color: '#5a6068', a: 0.24, cols: 9, rows: 6, drift: p * 0.6 });
      g.fillStyle = A('#e0c040', 0.7); g.fillRect(0, HZ + 60, W, 10);
      // 顶棚
      g.fillStyle = '#5a6268'; g.fillRect(220, 150, 420, 18);
      g.fillStyle = '#4a5258'; g.fillRect(250, 168, 14, HZ - 168 + 40);
      g.fillRect(616, 168, 14, HZ - 168 + 40);
      S2.glow(g, 430, 170, 240, '#ffeec0', 0.14);
      // 站牌
      g.fillStyle = '#3f464c'; g.fillRect(690, 220, 8, HZ - 100);
      S2.sign(g, 640, 210, 110, 130, '站', { bg: '#3f464c', fg: '#d8e8f4', glowOn: false });
      // 长椅
      g.fillStyle = '#7a6a52'; g.fillRect(300, HZ + 60, 190, 12);
      g.fillStyle = shade2('#7a6a52', 1.15); g.fillRect(300, HZ + 14, 190, 10);
      g.fillStyle = '#5a5248'; g.fillRect(312, HZ + 72, 10, 30); g.fillRect(468, HZ + 72, 10, 30);
      // 人等车 + 猫 + 树
      S2.personSil(g, { x: 400, baseY: HZ + 110, h: 160, color: '#3a4450', action: 'stand', t: t });
      S2.catSil(g, { x: 540, baseY: HZ + 132, s: 0.55, action: 'sit', t: t });
      S2.tree(g, { x: 170, baseY: HZ + 30, s: 1.3, c: '#4a8a48' });
      // 公交车（远处驶过）
      var busx = ((t * 60) % (W + 600)) - 300;
      g.fillStyle = A('#4a90b8', 0.9); g.fillRect(busx, HZ - 110, 260, 90);
      g.fillStyle = A('#dceaf4', 0.9);
      g.fillRect(busx + 30, HZ - 80, 60, 40); g.fillRect(busx + 150, HZ - 80, 60, 40);
      g.fillStyle = '#2f3238'; g.fillRect(busx + 14, HZ - 22, 232, 22);
      g.save(); push(g, p, 0.03); g.restore();
      vignette(g, 0.32);
    }

    REG.hospital = hospital;
    REG.farmfield = farmfield;
    REG.busstop = busstop;
  })();

  /* 注册进 2D 场景表 */
  var R = FS.s2dScenes;
  Object.keys(REG).forEach(function (k) { R[k] = REG[k]; });
  if (!R.meta) R.meta = {};
  R.meta.livingroom = { name: '客廳', tags: ['室内', '生活', '温暖'] };
  R.meta.office = { name: '辦公室', tags: ['职场', '日常'] };
  R.meta.bakery = { name: '面包房', tags: ['室内', '市井', '烟火'] };
  R.meta.hospital = { name: '病房', tags: ['室内', '情绪', '陪伴'] };
  R.meta.farmfield = { name: '田埂', tags: ['户外', '乡村', '自然'] };
  R.meta.busstop = { name: '公交站', tags: ['户外', '通勤', '日常'] };
})(typeof window !== 'undefined' ? window : this);
