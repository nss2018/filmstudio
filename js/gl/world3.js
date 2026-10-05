/* world3.js —— 再追加 6 个「生活」3D 场景
 *
 * 客厅 / 办公室 / 面包房 / 医院病房 / 田埂 / 公交站
 *
 * 承接 world2.js 的做法：单独一个文件，加载后 push 进 FS.world.PLACES（world.js 零改动）。
 * 复用 world.js 导出的零件：at / bake / table / chair / plant / tree / lampPost
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});
  var G = FS.geom, C = G.color;
  var P = FS.world.parts;                 // at / bake / table / chair / plant / tree / lampPost
  var at = P.at, bake = P.bake;

  function chair(col) { return P.chair(col); }
  function table(col, h) { return P.table(col, h); }
  function tree(rng, s, c) { return P.tree(rng, s, c); }
  function plant(rng, s, c) { return P.plant(rng, s, c); }
  function lamp(h, col) { return P.lampPost(h || 4.2, col || '#fff'); }

  /* ==================== 客厅 ==================== */
  function livingroom(rng) {
    var wall = C('#e0dcd2'), floorC = C('#9a7550'), cloth = C('#6a7f9a');
    var sofa = [
      at(G.box(2.6, .45, 1, cloth), [0, .35, 0]),                  // 坐垫
      at(G.box(2.6, .7, .24, G.shade(cloth, .9)), [0, .78, -.38]), // 靠背
      at(G.box(.24, .6, 1, G.shade(cloth, .95)), [-1.18, .55, 0]), // 扶手
      at(G.box(.24, .6, 1, G.shade(cloth, .95)), [1.18, .55, 0]),
      at(G.box(2.6, .12, .9, G.shade(cloth, .75)), [0, .12, .05])  // 底座
    ];
    return {
      solid: bake([
        at(G.box(11, .2, 11, floorC), [0, -.1, 0]),               // 地板
        at(G.box(11, 3.2, .2, wall), [0, 1.6, -5.4]),             // 后墙
        at(G.box(.2, 3.2, 11, wall), [-5.4, 1.6, 0]),             // 左墙
        at(G.box(9, .2, 9, C('#f2eee6')), [0, 3.2, .5]),          // 天花板
        // 地毯
        at(G.cylinder(2.6, 2.6, .04, 20, C('#b08a6a')), [1.4, .02, 1.4]),
        // 窗（发光面 + 框）
        at(G.box(2.6, 1.8, .08, C('#ffeec8')), [3.4, 1.9, 5.35]),
        at(G.box(2.8, .12, .12, C('#e8e2d6')), [3.4, 1.9, 5.42]),
        // 电视柜 + 电视
        at(G.box(1.8, .5, .5, C('#5a4535')), [-2.4, .25, -5.0]),
        at(G.box(1.4, .9, .1, C('#1c1c22')), [-2.4, 1.05, -5.05]),
        at(G.box(1.24, .74, .02, C('#6fa8d8')), [-2.4, 1.05, -4.98]),
        // 书架
        at(G.box(.4, 1.8, 1.6, C('#6b4f3a')), [5.2, .9, -3.2]),
        at(G.box(.34, .06, 1.5, C('#8a6a4a')), [5.05, 1.3, -3.2]),
        at(G.box(.34, .06, 1.5, C('#8a6a4a')), [5.05, .8, -3.2]),
        // 落地灯
        at(G.cylinder(.04, .04, 1.5, 6, C('#2f3238')), [4.2, .75, 3.2]),
        at(G.cone(.3, .35, 8, C('#e8d8b0')), [4.2, 1.6, 3.2])
      ].concat(sofa.map(function (p) { return at(p, [-1.2, .2, 1.6]); }))
        .concat([at(G.box(1.1, .08, .6, C('#8a6a4a')), [-1.2, .62, 1.6])])
        .concat(table('#8a6a4a').map(function (p) { return at(p, [1.2, 0, 1.2]); }))
        .concat(chair('#7a8a6a').map(function (p) { return at(p, [3.2, 0, 2.4]); }))
        .concat(plant(rng, 1.1, '#4e8f52').map(function (p) { return at(p, [4.4, 0, -4]); }))
        .concat(lamp(1.9, '#fff2c4').map(function (p) { return at(p, [-3.8, .1, 3.6]); }))),
      water: G.empty(),
      glow: bake([
        at(G.box(2.4, 1.6, .03, C('#bcd8ee')), [3.4, 1.9, 5.3]),  // 窗光
        at(G.box(1.05, .6, .02, C('#8fc4e8')), [-2.4, 1.05, -4.94]), // 屏幕
        at(G.sphere(.2, 8, 5, C('#fff0c0')), [-3.8, 1.95, 3.6])   // 灯罩
      ]),
      lights: [
        { pos: [-3.8, 1.5, 3.6], color: '#ffdca8', intensity: 1.0, radius: 8 },
        { pos: [-2.4, 1.1, -4.8], color: '#7fbce0', intensity: .7, radius: 7 },
        { pos: [3.4, 2.0, 5.0], color: '#ffeec8', intensity: .8, radius: 9 }
      ],
      fog: { color: '#3d3630', near: 7, far: 26 },
      sky: { top: '#2e2a26', bottom: '#3d3630' },
      indoor: true
    };
  }

  /* ==================== 办公室工位 ==================== */
  function office(rng) {
    var floorC = C('#5a5f66'), wallC = C('#3d454d'), panel = C('#7a8290');
    var screens = [], cubes = [];
    for (var i = 0; i < 3; i++) {
      var cx = -2.6 + i * 2.6;
      cubes.push(at(G.box(2.2, 1.5, .08, panel), [cx, .75, -1.6]));          // 隔断
      cubes.push(at(G.box(1.6, .05, .8, C('#c8c2b4')), [cx, .74, -.4]));     // 桌面
      cubes.push(at(G.box(1.5, .9, .05, C('#2a2e34')), [cx, 1.2, -.75]));    // 显示器背板
      screens.push(at(G.box(1.36, .76, .02, C('#7ea8d8')), [cx, 1.2, -.72]));
      cubes.push(at(G.box(1.4, .04, .7, C('#5a5a60')), [cx + .1, .73, .1]));
    }
    return {
      solid: bake([
        at(G.plane(14, 12, 12, 10, null, floorC), [0, 0, 0]),
        at(G.box(13, 3, .2, wallC), [0, 1.5, -5.6]),
        at(G.box(14, .2, 12, C('#4a5058')), [0, 3, .4]),                     // 吊顶
        at(G.box(3.6, .12, .12, C('#2f3238')), [-3, 2.5, -5.4]),
        // 会议室玻璃隔断
        at(G.box(6, 2.6, .1, C('#9fc4d8')), [5.2, 1.3, 2]),
        at(G.box(.12, 2.6, 4, C('#8a9098')), [2.2, 1.3, 2]),
        // 绿植
        at(G.box(.5, .4, .5, C('#6b4f3a')), [-5.2, .2, 3.4])
      ].concat(cubes).concat(screens.map(function (s) { return s; }))
        .concat(plant(rng, 1.2, '#3f8a4a').map(function (p) { return at(p, [5.4, .2, 4.2]); }))
        .concat(chair('#3f4650').map(function (p) { return at(p, [-3.4, 0, -.2], [0, .5, 0]); }))
        .concat(chair('#4a525c').map(function (p) { return at(p, [0, 0, .05], [0, -.4, 0]); }))),
      water: G.empty(),
      glow: bake([
        at(G.box(1.36, .76, .02, C('#9ec8e8')), [-2.6, 1.2, -.72]),
        at(G.box(1.36, .76, .02, C('#a8d0c0')), [0, 1.2, -.72]),
        at(G.box(1.36, .76, .02, C('#c8d8f0')), [2.6, 1.2, -.72]),
        at(G.box(5.8, 2.4, .04, C('#c4e0ee')), [5.2, 1.3, 1.9]),
        at(G.box(3.2, .08, .12, C('#f8f4e8')), [-3, 2.48, -5.34])
      ]),
      lights: [
        { pos: [-3, 2.4, -4], color: '#f4f0e4', intensity: 1.0, radius: 12 },
        { pos: [0, 2.4, 0], color: '#f4f0e4', intensity: .9, radius: 12 },
        { pos: [3, 2.4, 3], color: '#e8ecf2', intensity: .8, radius: 13 },
        { pos: [5.2, 1.4, 1.6], color: '#cfe4ee', intensity: .7, radius: 9 }
      ],
      fog: { color: '#333a42', near: 9, far: 30 },
      sky: { top: '#252b33', bottom: '#333a42' },
      indoor: true
    };
  }

  FS.buildPlace3 = { livingroom: livingroom, office: office };

  /** 后两个场景与注册放在第二个 IIFE 里，保证上面两个先跑完再对外可见 */
  (function () {
    var FS2 = FS, G2 = G, C2 = C, P2 = P;

    /* ==================== 面包房 ==================== */
    function bakery(rng) {
      var floorC = C('#c4bcae'), wallC = C('#e8ddc4'), wood = C('#a8763f');
      var breads = [], shelves = [];
      for (var i = 0; i < 9; i++) {
        var bx = -1.6 + (i % 5) * .8;
        var by = 1.1 + Math.floor(i / 5) * .5;
        breads.push(at(G.sphere(.16, 6, 4, C(['#c88a4a', '#d8a860', '#a8643f'][i % 3])), [bx, by, -3.4]));
      }
      for (var s = 0; s < 3; s++) {
        shelves.push(at(G.box(2.6, .08, .5, C('#8a6338')), [-.2, .9 + s * .55, -3.5]));
      }
      var lamps = [];
      for (var l = 0; l < 3; l++) {
        lamps.push(at(G.cylinder(.03, .03, .9, 6, C('#3a3028')), [-2.2 + l * 2.2, 2.5, .6]));
        lamps.push(at(G.cone(.26, .3, 8, C('#f0d090')), [-2.2 + l * 2.2, 1.85, .6]));
      }
      return {
        solid: bake([
          at(G.plane(12, 10, 12, 10, null, floorC), [0, 0, 0]),
          at(G.box(12, 3.2, .2, wallC), [0, 1.6, -5]),
          at(G.box(12, .2, 10, C('#efe6d2')), [0, 3.2, .5]),
          // 柜台
          at(G.box(4.4, 1.05, .9, wood), [0, .52, 1.2]),
          at(G.box(4.6, .12, 1.1, C('#d8ccb0')), [0, 1.08, 1.2]),
          at(G.box(4.6, .3, 1.2, C('#7a5a3a')), [0, .15, 1.2]),
          // 玻璃柜（甜点）
          at(G.box(3.2, .9, .06, C('#cfe0e8')), [0, 1.5, .6]),
          // 烤箱
          at(G.box(1.6, 1.1, .9, C('#5a5a60')), [4, .55, -3.6]),
          at(G.box(1.2, .5, .06, C('#ff9a4a')), [4, .7, -3.15]),
          // 招牌
          at(G.box(2.2, .6, .12, C('#8a5a3a')), [0, 2.6, -4.85]),
          at(G.box(1.8, .34, .02, C('#ffd88a')), [0, 2.6, -4.78]),
          at(G.cylinder(.06, .06, 1.3, 6, C('#8a6a4a')), [-5.2, .65, 1.2]),
          at(G.cylinder(.5, .5, .06, 12, C('#e0d0b0')), [-5.2, 1.3, 1.2])
        ].concat(shelves).concat(breads).concat(lamps)),
        water: G.empty(),
        glow: bake([
          at(G.box(1.0, .34, .02, C('#ffe0a0')), [0, 2.6, -4.74]),
          at(G.box(1.0, .38, .02, C('#ffb060')), [4, .7, -3.1]),
          at(G.box(2.9, .7, .02, C('#dceaf2')), [0, 1.5, .55]),
          at(G.sphere(.2, 8, 5, C('#ffe6b0')), [-2.2, 1.7, .6]),
          at(G.sphere(.2, 8, 5, C('#ffe6b0')), [0, 1.7, .6]),
          at(G.sphere(.2, 8, 5, C('#ffe6b0')), [2.2, 1.7, .6])
        ]),
        lights: [
          { pos: [-2.2, 1.7, .6], color: '#ffdca0', intensity: .9, radius: 8 },
          { pos: [0, 1.7, .6], color: '#ffdca0', intensity: .9, radius: 8 },
          { pos: [2.2, 1.7, .6], color: '#ffdca0', intensity: .9, radius: 8 },
          { pos: [4, .8, -3.2], color: '#ff9a4a', intensity: .8, radius: 7 }
        ],
        fog: { color: '#4a4238', near: 7, far: 24 },
        sky: { top: '#3a342c', bottom: '#4a4238' },
        indoor: true
      };
    }

    /* ==================== 医院病房 ==================== */
    function hospital(rng) {
      var wall = C('#dfe4e8'), floorC = C('#9aa4ac'), steel = C('#8a949c');
      var winGrids = [];
      for (var w = 0; w < 3; w++) {
        winGrids.push(at(G.box(1.1, .9, .06, C('#dceaf4')), [1.2 + w * 1.3, 1.9, 4.9]));
      }
      return {
        solid: bake([
          at(G.plane(12, 10, 12, 10, null, floorC), [0, 0, 0]),
          at(G.box(12, 3, .2, wall), [0, 1.5, -5]),
          at(G.box(12, .2, 10, C('#eef2f6')), [0, 3, .5]),
          // 病床
          at(G.box(1.1, .18, 2.1, C('#5a6470')), [-1.6, .55, -1.2]),
          at(G.box(1.0, .16, 2, C('#f2f6f8')), [-1.6, .72, -1.2]),
          at(G.box(1.04, .22, .9, C('#9ab8cc')), [-1.6, .88, -.6]),
          at(G.box(.5, .16, .34, C('#f8faf8')), [-1.6, .92, -2.1]),
          at(G.cylinder(.05, .05, .5, 6, steel), [-2.0, .25, -.2]),
          at(G.cylinder(.05, .05, .5, 6, steel), [-1.2, .25, -.2]),
          at(G.cylinder(.05, .05, .5, 6, steel), [-2.0, .25, -2.2]),
          at(G.cylinder(.05, .05, .5, 6, steel), [-1.2, .25, -2.2]),
          // 床头柜
          at(G.box(.6, .6, .5, C('#a8b0b6')), [.2, .3, -2.4]),
          at(G.sphere(.12, 8, 5, C('#7fd0e8')), [.2, .66, -2.4]),
          // 输液架
          at(G.cylinder(.04, .04, 1.7, 6, steel), [.9, .85, -.2]),
          at(G.cylinder(.24, .18, .34, 10, C('#dfe8f0')), [.9, 1.7, -.2]),
          at(G.cylinder(.02, .02, .3, 4, steel), [.9, 1.42, -.2]),
          // 陪客椅
          at(G.box(.6, .1, .6, C('#6a7a88')), [1.6, .45, 1.6]),
          at(G.box(.6, .5, .1, C('#6a7a88')), [1.6, .7, 1.35]),
          // 长椅
          at(G.box(2.6, .12, .5, C('#c0c8cc')), [4.2, .45, -2.6]),
          at(G.box(2.6, .5, .12, C('#c0c8cc')), [4.2, .7, -2.4]),
          at(G.box(.12, .45, .5, steel), [3.1, .22, -2.6]),
          at(G.box(.12, .45, .5, steel), [5.3, .22, -2.6]),
          // 门口亮面
          at(G.box(1.6, 2.2, .06, C('#c8d4dc')), [-4.6, 1.1, -3.4])
        ].concat(winGrids)),
        water: G.empty(),
        glow: bake([
          at(G.box(2.7, 1.0, .03, C('#e8f4ff')), [1.4, 1.9, 4.84]),
          at(G.box(3.4, .08, .12, C('#f4f8fc')), [4.2, 3.1, -2.6]),
          at(G.sphere(.12, 8, 5, C('#a8e0f4')), [.2, .68, -2.4]),
          at(G.cylinder(.2, .16, .3, 10, C('#e2eef4')), [.9, 1.62, -.2])
        ]),
        lights: [
          { pos: [0, 2.7, 0], color: '#eef4fa', intensity: 1.0, radius: 14 },
          { pos: [1.4, 2.0, 4.4], color: '#dceaf6', intensity: .8, radius: 10 },
          { pos: [-1.6, .9, -.4], color: '#c8d8e0', intensity: .4, radius: 6 }
        ],
        fog: { color: '#3e464e', near: 9, far: 30 },
        sky: { top: '#2e343a', bottom: '#3e464e' },
        indoor: true
      };
    }

    /* ==================== 田埂 ==================== */
    function farmfield(rng) {
      var soil = C('#8a6a44'), crop = C('#c8b048'), sky = C('#f0c9a0');
      var rows = [], stalks = [];
      for (var r = 0; r < 5; r++) {
        rows.push(at(G.box(26, .16, 1.5, soil), [0, .08, -3 + r * 2.2]));
        for (var s = 0; s < 22; s++) {
          var sx = -11 + s * 1.05;
          stalks.push(at(G.box(.06, .5 + ((s + r) % 3) * .12, .06, G.shade(crop, .85 + ((s + r) % 4) * .06)),
            [sx, .45 + ((s + r) % 3) * .06, -3 + r * 2.2]));
        }
      }
      var scarecrow = [
        at(G.cylinder(.07, .06, 2, 6, C('#6b4f3a')), [3.4, 1, -2.6]),
        at(G.cylinder(.05, .05, 1.4, 6, C('#6b4f3a')), [3.4, 1.5, -2.6], [0, 0, Math.PI / 2]),
        at(G.sphere(.26, 8, 6, C('#d8c490')), [3.4, 2.05, -2.6]),
        at(G.cone(.42, .28, 8, C('#a8763f')), [3.4, 2.32, -2.6]),
        at(G.box(.7, .55, .12, C('#8a6a4a')), [3.4, 1.6, -2.6])
      ];
      var hills = [
        at(G.blob(6, 1, .5, rng, C('#6a7a5a')), [-13, 1.2, -14]),
        at(G.blob(5, 1, .5, rng, C('#7a8a62')), [4, .8, -16]),
        at(G.blob(7, 1, .5, rng, C('#5f7050')), [14, 1.6, -13])
      ];
      return {
        solid: bake([
          at(G.plane(30, 26, 16, 14, null, C('#a8905f')), [0, 0, 0]),
          at(G.box(30, .18, .8, C('#6b5236')), [0, .09, 6.4]),   // 田埂小径
          at(G.box(30, .18, .8, C('#6b5236')), [0, .09, -7.6]),
          // 谷仓
          at(G.box(4.4, 3, 3.4, C('#a8402f')), [-8.5, 1.5, -8]),
          at(G.prism(4, 3.4, 1.6, C('#7a3025'), Math.PI / 4), [-8.5, 4.5, -8]),
          at(G.box(1.1, 2, .1, C('#d8c8a0')), [-8.5, 1, -6.3]),
          // 远山
          at(G.box(60, 8, 2, C('#8a9a7a')), [0, 2, -18])
        ].concat(rows).concat(stalks).concat(scarecrow).concat(hills)
          .concat(tree(rng, 1.4, '#4f8a48').map(function (p) { return at(p, [9, 0, -4]); }))
          .concat(tree(rng, 1.1, '#57924e').map(function (p) { return at(p, [-11, 0, 1]); }))),
        water: G.empty(),
        glow: bake([
          at(G.box(1.5, 2.2, .04, C('#ffe0a8')), [-8.5, 1.6, -6.24])
        ]),
        lights: [{ pos: [0, 9, -2], color: '#ffd8a0', intensity: 1.3, radius: 40 }],
        fog: { color: '#f0c9a0', near: 20, far: 70 },
        sky: { top: '#6a8fc0', bottom: '#f3d2a4' },
        indoor: false
      };
    }

    /* ==================== 公交站 ==================== */
    function busstop(rng) {
      var road = C('#41454a'), walk = C('#9a9690');
      var windows = [], houses = [];
      for (var h = 0; h < 5; h++) {
        var hx = -8 + h * 4.2;
        houses.push(at(G.box(3.6, 4 + (h % 2) * 1.6, 3, C(['#c8b8a0', '#b8a890', '#d0c0ac'][h % 3])), [hx, (4 + (h % 2) * 1.6) / 2, -9]));
        for (var r0 = 0; r0 < 3; r0++) {
          for (var c0 = 0; c0 < 3; c0++) {
            windows.push(at(G.box(.5, .5, .06, C('#ffeec0')), [hx - 1 + c0 * 1, 1.2 + r0 * 1.3, -7.46]));
          }
        }
      }
      return {
        solid: bake([
          at(G.plane(24, 20, 16, 14, null, road), [0, 0, -3]),
          at(G.box(24, .2, 3.4, walk), [0, .1, 3.2]),
          at(G.box(24, .04, .3, C('#e0c040')), [0, .22, 1.4]),      // 候车黄线
          // 站台顶棚
          at(G.box(3.4, .14, 1.8, C('#5a6268')), [0, 2.7, 2.2]),
          at(G.box(3.6, .1, .1, C('#5a6268')), [0, 2.86, 3.1]),
          at(G.cylinder(.08, .07, 2.7, 6, C('#4a5258')), [-1.5, 1.35, 3.0]),
          at(G.cylinder(.08, .07, 2.7, 6, C('#4a5258')), [1.5, 1.35, 3.0]),
          // 站牌
          at(G.cylinder(.07, .06, 2.4, 6, C('#3f464c')), [2.8, 1.2, 3.0]),
          at(G.box(1.3, .8, .08, C('#3f464c')), [2.8, 2.4, 3.0]),
          // 长椅
          at(G.box(1.8, .1, .45, C('#7a6a52')), [-.3, .5, 2.2]),
          at(G.box(1.8, .45, .1, C('#7a6a52')), [-.3, .72, 2.0]),
          at(G.box(.1, .45, .45, C('#5a5248')), [-1.1, .25, 2.2]),
          at(G.box(.1, .45, .45, C('#5a5248')), [.5, .25, 2.2]),
          // 垃圾桶 + 自行车棚柱
          at(G.cylinder(.28, .24, .8, 10, C('#4f8a5a')), [1.7, .4, 2.6]),
          at(G.cylinder(.06, .06, 1.2, 6, C('#3f464c')), [-4, .6, 2.4])
        ].concat(windows).concat(houses)
          .concat(tree(rng, 1.5, '#4a8a48').map(function (p) { return at(p, [5.5, 0, -1.5]); }))
          .concat(tree(rng, 1.2, '#528f4a').map(function (p) { return at(p, [-6.5, 0, -2.5]); }))),
        water: G.empty(),
        glow: bake([
          at(G.box(1.1, .5, .04, C('#d8e8f4')), [2.8, 2.4, 2.94]),
          at(G.box(2.8, .08, .12, C('#fff0c8')), [0, 2.6, 2.2])
        ]),
        lights: [
          { pos: [0, 2.5, 2.2], color: '#ffeec0', intensity: .9, radius: 9 },
          { pos: [-4, 3, 0], color: '#ffdca0', intensity: .7, radius: 20 }
        ],
        fog: { color: '#b8c2cc', near: 16, far: 56 },
        sky: { top: '#7fb2e5', bottom: '#dceaf6' },
        indoor: false
      };
    }

    var EXTRA3 = [
      { id: 'livingroom', name: '客厅', tags: ['室内', '生活', '居家', '温暖'], build: livingroom },
      { id: 'office', name: '办公室', tags: ['职场', '日常', '城市'], build: office },
      { id: 'bakery', name: '面包房', tags: ['室内', '市井', '烟火', '香甜'], build: bakery },
      { id: 'hospital', name: '医院病房', tags: ['室内', '情绪', '陪伴'], build: hospital },
      { id: 'farmfield', name: '田埂麦田', tags: ['户外', '乡村', '自然', '安静'], build: farmfield },
      { id: 'busstop', name: '公交站', tags: ['户外', '通勤', '城市', '日常'], build: busstop }
    ];

    EXTRA3.forEach(function (p) { FS2.world.PLACES.push(p); });
    FS2.world.EXTRA3 = EXTRA3;

    FS2.buildPlace3.bakery = bakery;
    FS2.buildPlace3.hospital = hospital;
    FS2.buildPlace3.farmfield = farmfield;
    FS2.buildPlace3.busstop = busstop;
  })();
})(typeof window !== 'undefined' ? window : this);
