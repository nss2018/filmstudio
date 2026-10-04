/* scene2d/scenes2.js —— 另 6 个 2D 生活场景（追加进同一个注册表）
 * 雨巷 / 地铁站台 / 菜市场 / 阳台天台 / 校园 / 卧室
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});
  var S = FS.s2d;
  var W = S.W, H = S.H, HZ = S.HZ;
  var A = S.A, shade = S.shade, lerp = S.lerp, clamp01 = S.clamp01;

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

  /* ==================================================================
   * 7. 雨巷（室外·夜雨）
   * ================================================================== */
  function rainy(g, t, p, o) {
    S.sky(g, [[0, '#141a24'], [1, '#28323f']], 0, HZ);
    // 两侧楼（透视：近大远小）
    g.save(); push(g, p, 0.05);
    for (var side = 0; side < 2; side++) {
      for (var i = 0; i < 5; i++) {
        var d = i / 5;
        var x = side ? W - 40 - d * 620 : 40 + d * 620;
        var w = lerp(300, 90, d), h = lerp(520, 240, d);
        g.fillStyle = shade('#1e2630', 1 - d * 0.4);
        g.fillRect(x - (side ? w : 0), HZ - h, w, h);
        // 窗（暖光）
        for (var r = 0; r < 4; r++) {
          for (var c = 0; c < 3; c++) {
            if (((r * 5 + c * 3 + i + side * 2) % 4) > 1) continue;
            g.fillStyle = A('#ffcf8a', 0.5 - d * 0.3);
            g.fillRect(x - (side ? w : 0) + 16 + c * (w / 3.4), HZ - h + 30 + r * (h / 4.6), w / 5, h / 8);
          }
        }
      }
    }
    // 巷道地面 + 湿反光
    g.fillStyle = '#1a2028'; g.fillRect(0, HZ, W, H - HZ);
    S.groundGrid(g, { hz: HZ, vp: W / 2, color: '#3d4a58', a: 0.2, cols: 7, rows: 6, drift: p * 0.6 });
    // 霓虹倒影（地面上的竖条）
    for (var n = 0; n < 4; n++) {
      var nx = 220 + n * 280;
      var col = ['#ff6f8a', '#6fc8ff', '#ffd76f', '#8fe89a'][n];
      g.fillStyle = A(col, 0.16 + 0.06 * Math.sin(t * 2 + n));
      g.fillRect(nx - 16, HZ, 32, H - HZ);
      S.glow(g, nx, HZ + 10, 90, col, 0.18);
      // 灯箱本体
      S.sign(g, nx - 34, 210 + n * 18, 68, 92, ['茶', '面', '书', '酒'][n], { bg: '#12161d', fg: col, glowOn: true });
    }
    // 路灯 + 光锥
    S.lampCone(g, 640, 200, 90, 300, '#ffe0a8', 0.12);
    g.fillStyle = '#2f3238'; g.fillRect(634, 150, 12, 160);
    S.glow(g, 640, 150, 60, '#fff4cf', 0.45);
    // 撑伞的人
    S.personSil(g, { x: 430, baseY: 700, h: 175, color: '#28323f', action: 'walk', t: t });
    g.fillStyle = A('#6fc8ff', 0.75);
    g.beginPath();
    g.arc(430, 452, 66, Math.PI, 0); g.closePath(); g.fill();
    g.strokeStyle = A('#cfe8ff', 0.9); g.lineWidth = 3;
    g.beginPath(); g.moveTo(430, 452); g.lineTo(430, 528); g.stroke();
    S.personSil(g, { x: 880, baseY: 660, h: 140, color: '#3a2f3f', action: 'walk', t: t + 2 });
    g.fillStyle = A('#ff9a8f', 0.7);
    g.beginPath(); g.arc(880, 500, 54, Math.PI, 0); g.closePath(); g.fill();
    S.catSil(g, { x: 1020, baseY: 706, s: 0.5, action: 'sit', t: t });
    // 雨 + 地面涟漪
    S.particles(g, { n: 150, t: t, y0: -40, y1: H, color: '#cfe0f0', alpha: 0.4, size: 2.2, speed: 620, shape: 'streak', slant: 6 });
    for (var k = 0; k < 5; k++) {
      var rx = ((t * 60 + k * 260) % (W + 200)) - 100;
      var ry = HZ + 40 + ((k * 97) % 180);
      g.strokeStyle = A('#cfe0f0', 0.18 * (1 - ((t * 1.6 + k) % 1)));
      g.lineWidth = 2;
      g.beginPath(); g.ellipse(rx, ry, 18, 5, 0, 0, Math.PI * 2); g.stroke();
    }
    g.restore();
    vignette(g, 0.46);
  }

  /* ==================================================================
   * 8. 地铁站台（室内·冷）
   * ================================================================== */
  function metro(g, t, p, o) {
    S.sky(g, [[0, '#1c2228'], [1, '#2a323a']], 0, HZ);
    // 隧道 + 对面墙
    g.fillStyle = '#232a31'; g.fillRect(0, 180, W, HZ - 180);
    // 站台柱
    for (var i = 0; i < 5; i++) {
      var x = 60 + i * 290;
      g.fillStyle = '#39434d';
      g.fillRect(x, 200, 44, HZ - 200);
      g.fillStyle = A('#6fc8ff', 0.1);
      g.fillRect(x, 200, 44, HZ - 200);
    }
    // 顶灯
    for (var l = 0; l < 6; l++) {
      var lx = 100 + l * 216;
      g.fillStyle = '#dfe8f0';
      g.fillRect(lx - 40, 168, 80, 8);
      S.glow(g, lx, 200, 150, '#cfe4f0', 0.14);
    }
    // 黄线 + 屏蔽门
    g.fillStyle = '#f0c040'; g.fillRect(0, HZ - 96, W, 10);
    g.fillStyle = A('#8fd8e8', 0.14); g.fillRect(0, 150, W, HZ - 246);
    g.strokeStyle = A('#6fc8ff', 0.5); g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, HZ - 150); g.lineTo(W, HZ - 150); g.stroke();
    for (var d = 0; d < 8; d++) {
      g.beginPath(); g.moveTo(d * 160, 150); g.lineTo(d * 160, HZ - 150); g.stroke();
    }
    // 地砖 + 黄警戒线
    g.fillStyle = '#3a424a'; g.fillRect(0, HZ, W, H - HZ);
    S.groundGrid(g, { hz: HZ, color: '#59636d', a: 0.2, cols: 12, rows: 5, drift: p });
    g.fillStyle = A('#f0c040', 0.5); g.fillRect(0, HZ + 6, W, 8);
    // 列车（从左侧驶入，p 驱动）
    var tx = lerp(-700, W + 200, S.easeOut(clamp01(p * 1.3)));
    g.fillStyle = '#c8d2d8'; g.fillRect(tx, 210, 660, 250);
    g.fillStyle = '#2f3a45'; g.fillRect(tx, 240, 660, 90);
    g.fillStyle = A('#ffe9a8', 0.5);
    for (var wdw = 0; wdw < 4; wdw++) g.fillRect(tx + 40 + wdw * 150, 250, 110, 70);
    g.fillStyle = A('#ff6b5a', 0.8); g.fillRect(tx + 20, 226, 60, 14);
    // 等车的人 + 报站牌
    S.personSil(g, { x: 220, baseY: 690, h: 168, color: '#33404d', action: 'stand', t: t });
    S.personSil(g, { x: 300, baseY: 700, h: 150, color: '#4d3a44', action: 'stand', t: t + 1 });
    S.personSil(g, { x: 1050, baseY: 680, h: 158, color: '#3a4a3f', action: 'walk', t: t });
    S.sign(g, 560, 120, 160, 46, '2 号线', { bg: '#12161d', fg: '#8fd8e8', glowOn: true });
    g.restore && g.restore();
    vignette(g, 0.4);
  }

  /* ==================================================================
   * 9. 菜市场（室外·白天）
   * ================================================================== */
  function market(g, t, p, o) {
    S.sky(g, [[0, '#8fb8d8'], [1, '#dce8e0']], 0, 300);
    // 棚顶（条纹布）
    var stripes = ['#d85a4a', '#e8e0d0'];
    for (var s = 0; s < 12; s++) {
      g.fillStyle = stripes[s % 2];
      g.fillRect(s * 110, 60, 110, 70);
    }
    g.fillStyle = '#3a3a44'; g.fillRect(0, 126, W, 10);
    g.fillStyle = '#4a4a54'; g.fillRect(30, 136, 12, 180); g.fillRect(W - 42, 136, 12, 180);
    // 后排摊：菜筐 + 秤
    g.fillStyle = '#8a7a5a'; g.fillRect(0, 330, W, 24);
    for (var i = 0; i < 6; i++) {
      var x = 70 + i * 200;
      g.fillStyle = '#a8763f';
      g.beginPath(); g.ellipse(x, 330, 52, 18, 0, 0, Math.PI * 2); g.fill();
      // 菜
      for (var v = 0; v < 6; v++) {
        g.fillStyle = ['#7ab05a', '#e8c05a', '#c0683f', '#8a5aa8'][(i + v) % 4];
        g.beginPath();
        g.arc(x - 36 + v * 15, 322 - (v % 2) * 6, 8, 0, Math.PI * 2);
        g.fill();
      }
      // 秤
      g.fillStyle = '#9aa4ae'; g.fillRect(x + 70, 300, 8, 30);
      g.fillStyle = '#dfe4e8'; g.fillRect(x + 60, 294, 30, 8);
    }
    // 地面
    g.fillStyle = '#6b6f72'; g.fillRect(0, HZ, W, H - HZ);
    S.groundGrid(g, { hz: HZ, color: '#8a8e92', a: 0.18, cols: 8, rows: 4, drift: p });
    // 前景摊（鱼/水果）
    S.table2d(g, 300, 700, 480, 200, '#a8763f', '#5a4a3a');
    for (var f = 0; f < 5; f++) {
      g.fillStyle = ['#e8734f', '#e8b04a', '#7ab05a', '#c0483f', '#f0d060'][f];
      g.beginPath(); g.arc(150 + f * 76, 512, 20, 0, Math.PI * 2); g.fill();
      g.fillStyle = A('#ffffff', 0.25);
      g.beginPath(); g.arc(144 + f * 76, 506, 7, 0, Math.PI * 2); g.fill();
    }
    // 讨价还价的人
    S.personSil(g, { x: 190, baseY: 700, h: 172, color: '#4a3a44', action: 'wave', t: t });
    S.personSil(g, { x: 880, baseY: 690, h: 165, color: '#3a4a5a', action: 'stand', t: t + 0.5 });
    S.catSil(g, { x: 1080, baseY: 706, s: 0.55, action: 'walk', t: t });
    vignette(g, 0.3);
  }

  /* ==================================================================
   * 10. 阳台天台（室外·黄昏）
   * ================================================================== */
  function balcony(g, t, p, o) {
    S.sky(g, [[0, '#5a7fb5'], [0.5, '#e0a878'], [1, '#f5d8a8']], 0, 520);
    S.glow(g, 340, 470, 180, '#ffb867', 0.5);
    // 远景城市剪影
    for (var i = 0; i < 12; i++) {
      var x = i * 112 - p * 30;
      var h = 120 + ((i * 97) % 130);
      g.fillStyle = shade('#4a4560', 0.9 + (i % 3) * 0.06);
      g.fillRect(x, 520 - h, 96, h);
    }
    S.haze(g, 500, 70, '#f0c9a0', 0.4);
    // 阳台地面 + 栏杆
    g.fillStyle = '#8a7a68'; g.fillRect(0, 560, W, H - 560);
    S.groundGrid(g, { hz: 560, color: '#6b5f52', a: 0.2, cols: 10, rows: 4, drift: p * 0.5 });
    g.strokeStyle = '#4a4238'; g.lineWidth = 8;
    g.beginPath(); g.moveTo(0, 470); g.lineTo(W, 470); g.stroke();
    g.lineWidth = 5;
    for (var b = 0; b < 17; b++) {
      g.beginPath(); g.moveTo(b * 78, 470); g.lineTo(b * 78, 560); g.stroke();
    }
    // 盆栽排排
    for (var pl = 0; pl < 4; pl++) {
      var px = 120 + pl * 300;
      g.fillStyle = '#a86b4a';
      g.beginPath();
      g.moveTo(px - 30, 660); g.lineTo(px + 30, 660); g.lineTo(px + 22, 600); g.lineTo(px - 22, 600);
      g.closePath(); g.fill();
      g.fillStyle = '#4e8f52';
      g.beginPath(); g.ellipse(px, 578, 38, 26, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(px - 20, 592, 22, 15, 0.3, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(px + 22, 590, 20, 14, -0.3, 0, Math.PI * 2); g.fill();
    }
    // 晾衣绳 + 衣服（随风摆）
    g.strokeStyle = A('#ffffff', 0.5); g.lineWidth = 2;
    g.beginPath(); g.moveTo(60, 220); g.quadraticCurveTo(640, 260, 1220, 210); g.stroke();
    for (var c = 0; c < 4; c++) {
      var cx = 200 + c * 280;
      var cy = 236 + Math.sin(c) * 14;
      var sway = Math.sin(t * 1.4 + c) * 6;
      g.fillStyle = ['#e8734f', '#6fc8ff', '#f0d060', '#8fe89a'][c];
      g.beginPath();
      g.moveTo(cx - 26, cy);
      g.lineTo(cx + 26, cy);
      g.lineTo(cx + 22 + sway, cy + 78);
      g.lineTo(cx - 22 + sway, cy + 78);
      g.closePath(); g.fill();
    }
    // 躺着晒太阳的人 + 猫
    g.fillStyle = '#4a5a6a';
    g.beginPath(); g.ellipse(760, 640, 90, 26, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3a4a5a';
    g.beginPath(); g.arc(840, 626, 22, 0, Math.PI * 2); g.fill();
    S.catSil(g, { x: 990, baseY: 646, s: 0.5, action: 'sit', t: t });
    S.birdSil(g, 200 + ((t * 30) % 900), 140, 1, '#4a4560');
    vignette(g, 0.3);
  }

  /* ==================================================================
   * 11. 校园（室外·白天）
   * ================================================================== */
  function campus(g, t, p, o) {
    S.sky(g, [[0, '#7ab0e0'], [1, '#dcecf4']], 0, HZ);
    S.glow(g, 180, 110, 80, '#fff6c8', 0.45);
    // 教学楼
    S.building(g, { x: 320, y: HZ, w: 640, h: 330, color: '#c8bfae', depth: 26, windows: true, winCols: 8, winRows: 4, lit: 0.1, winColor: '#cfe4ee' });
    g.fillStyle = '#8a7f6a';
    g.fillRect(600, HZ - 100, 80, 100);
    g.fillStyle = '#5a4a3a'; g.fillRect(300, HZ - 360, 14, 30);
    // 旗杆
    g.fillStyle = '#c8ccd0'; g.fillRect(150, 200, 8, HZ - 200);
    g.fillStyle = '#c0483f';
    g.beginPath();
    g.moveTo(158, 206);
    g.quadraticCurveTo(158 + 60 + Math.sin(t * 2) * 8, 216 + Math.sin(t * 3) * 5, 158, 246);
    g.closePath(); g.fill();
    // 操场跑道
    g.fillStyle = '#b05a48'; g.fillRect(0, HZ, W, H - HZ);
    S.groundGrid(g, { hz: HZ, color: '#e8e0d0', a: 0.5, cols: 3, rows: 4, drift: p * 0.3, lw: 2.4 });
    g.strokeStyle = A('#ffffff', 0.5); g.lineWidth = 3;
    g.beginPath(); g.ellipse(W / 2, HZ + 130, 380, 90, 0, 0, Math.PI * 2); g.stroke();
    // 树
    S.tree(g, 1060, HZ + 10, 240, { leaf: '#3f7a46' });
    S.tree(g, 120, HZ + 6, 180, { leaf: '#468a4a' });
    S.bush(g, 220, HZ + 40, 90, '#4f8a48');
    S.bush(g, 1000, HZ + 60, 110, '#4f8a48');
    // 跑步的学生 + 老师
    S.personSil(g, { x: 320 + ((t * 150) % 760) - 120, baseY: 700, h: 148, color: '#3f5a7a', action: 'run', t: t });
    S.personSil(g, { x: 900, baseY: 690, h: 158, color: '#5a4a3a', action: 'stand', t: t + 0.4 });
    S.particles(g, { n: 24, t: t, y0: 200, y1: H, color: '#ffffff', alpha: 0.22, size: 2.4, speed: 12, sway: 18 });
    vignette(g, 0.26);
  }

  /* ==================================================================
   * 12. 卧室（室内·晨）
   * ================================================================== */
  function bedroom(g, t, p, o) {
    S.sky(g, [[0, '#3a3646'], [1, '#4a4458']], 0, HZ);
    // 窗（晨光斜射）
    g.fillStyle = '#2a3040'; g.fillRect(760, 80, 420, 280);
    var grd = g.createLinearGradient(760, 80, 1180, 360);
    grd.addColorStop(0, '#ffe9b8'); grd.addColorStop(1, '#ffb877');
    g.fillStyle = grd; g.fillRect(772, 92, 396, 256);
    S.glow(g, 980, 200, 260, '#ffd9a0', 0.3);
    g.strokeStyle = '#4a4438'; g.lineWidth = 10;
    g.strokeRect(760, 80, 420, 280);
    g.beginPath(); g.moveTo(970, 80); g.lineTo(970, 360); g.moveTo(760, 220); g.lineTo(1180, 220); g.stroke();
    // 晨光光柱（斜射到地面）
    g.save();
    g.globalAlpha = 0.14;
    g.fillStyle = '#ffd9a0';
    g.beginPath();
    g.moveTo(772, 348); g.lineTo(1168, 348); g.lineTo(1100, H); g.lineTo(420, H);
    g.closePath(); g.fill();
    g.restore();
    // 地板
    g.fillStyle = '#8a6a4a'; g.fillRect(0, HZ, W, H - HZ);
    S.groundGrid(g, { hz: HZ, color: '#6b4f3a', a: 0.18, cols: 9, rows: 4, drift: p * 0.4 });
    // 床
    g.fillStyle = '#5a4a6a'; g.fillRect(80, 470, 520, 190);
    g.fillStyle = '#f0eae0'; g.fillRect(70, 440, 540, 60);
    g.fillStyle = '#e8e2d8'; g.beginPath(); g.ellipse(200, 430, 74, 34, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c86a7a'; g.fillRect(70, 500, 540, 40);
    // 床头柜 + 台灯 + 相框
    g.fillStyle = '#6b4f3a'; g.fillRect(620, 500, 130, 160);
    g.fillStyle = '#2f3238'; g.fillRect(676, 430, 10, 70);
    g.fillStyle = '#f0c060'; g.beginPath();
    g.moveTo(650, 430); g.lineTo(716, 430); g.lineTo(700, 396); g.lineTo(666, 396); g.closePath(); g.fill();
    S.glow(g, 683, 428, 70, '#ffd9a0', 0.35);
    g.fillStyle = '#3a3a44'; g.fillRect(730, 520, 46, 58);
    g.fillStyle = '#ffd9a0'; g.fillRect(736, 526, 34, 46);
    // 衣柜
    g.fillStyle = '#4a3a2c'; g.fillRect(1180, 200, 100, 460);
    g.fillStyle = A('#ffffff', 0.12); g.fillRect(1230, 210, 4, 440);
    // 绿植
    g.fillStyle = '#a86b4a'; g.fillRect(830, 600, 60, 70);
    g.fillStyle = '#4e8f52';
    g.beginPath(); g.ellipse(860, 570, 52, 34, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(826, 584, 30, 20, 0.3, 0, Math.PI * 2); g.fill();
    // 猫在窗台 + 人坐床边
    S.catSil(g, { x: 1000, baseY: 400, s: 0.5, action: 'sit', t: t });
    S.personSil(g, { x: 300, baseY: 700, h: 168, color: '#4a5a6a', action: 'sit', t: t });
    S.particles(g, { n: 20, t: t, x0: 700, x1: 1200, y0: 100, y1: HZ, color: '#ffe9b8', alpha: 0.3, size: 2.6, speed: 8, sway: 16 });
    vignette(g, 0.4);
  }

  /* 追加进注册表 */
  var R = FS.s2dScenes;
  R.rainy = rainy;
  R.metro = metro;
  R.market = market;
  R.balcony = balcony;
  R.campus = campus;
  R.bedroom = bedroom;

  /** 场景元信息：中文名 + 关键词（与 3D 导演层共用一套词表，这里给别名） */
  R.meta = {
    cafe: { name: '咖啡館', tags: ['室内', '生活', '温暖'] },
    street: { name: '街道', tags: ['城市', '通勤'] },
    park: { name: '公園', tags: ['户外', '绿色'] },
    seaside: { name: '海邊', tags: ['户外', '度假'] },
    study: { name: '書房', tags: ['室内', '安静'] },
    nightmarket: { name: '夜市', tags: ['夜间', '热闹'] },
    rainy: { name: '雨巷', tags: ['夜间', '城市', '情绪'] },
    metro: { name: '地鐵', tags: ['城市', '通勤'] },
    market: { name: '菜市場', tags: ['生活', '日常', '市井'] },
    balcony: { name: '陽台', tags: ['生活', '黄昏', '安静'] },
    campus: { name: '校園', tags: ['户外', '年轻'] },
    bedroom: { name: '臥室', tags: ['室内', '生活', '私密'] }
  };
})(typeof window !== 'undefined' ? window : this);
