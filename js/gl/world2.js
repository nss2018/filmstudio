/* world2.js —— 追加 6 个 3D 生活场景（卧室 / 菜市场 / 地铁站台 / 校园 / 雨中街道 / 阳台天台）
 *
 * 单独一个文件而不是塞进 world.js：world.js 已经很长了，追加式改动出问题时好定位。
 * 加载后自动 push 进 FS.world.PLACES（world.js 本身零改动）。
 * 复用 world.js 导出的零件：at / bake / table / chair / plant / tree / lampPost
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});
  var G = FS.geom, C = G.color;
  var P = FS.world.parts;                 // at / bake / table / chair / plant / tree / lampPost
  var at = P.at, bake = P.bake;

  function lamp(h, col) { return P.lampPost(h || 4.2, col || '#fff'); }

  /* ==================== 卧室 ==================== */
  function bedroom(rng) {
    var wall = C('#d8d2c8'), wood = C('#8a6a4a'), cloth = C('#e8e2d8'), accent = C('#c86a7a');
    return {
      solid: bake([
        at(G.box(9, .2, 9, wood), [0, -.1, 0]),
        at(G.box(9, 3.2, .2, wall), [0, 1.6, -4.4]),
        at(G.box(.2, 3.2, 9, wall), [-4.4, 1.6, 0]),
        at(G.box(9, .2, 9, C('#f0ece4')), [0, 3.2, 0]),
        // 床（床垫 + 被 + 枕头 + 床架）
        at(G.box(2.2, .5, 3.4, C('#5a4a6a')), [-2.2, .25, -.4]),
        at(G.box(2.1, .22, 3.3, cloth), [-2.2, .62, -.4]),
        at(G.box(2.15, .12, 1.5, accent), [-2.2, .78, .5]),
        at(G.sphere(.42, 10, 7, C('#f4f0e8')), [-2.2, .82, -1.5], null, [1.5, .5, .9]),
        // 床头柜 + 台灯
        at(G.box(.8, .6, .6, C('#6b4f3a')), [-.6, .3, -1.6]),
        at(G.cylinder(.05, .04, .5, 6, C('#2f3238')), [-.6, .6, -1.6]),
        at(G.sphere(.16, 8, 5, C('#f0c060')), [-.6, 1.12, -1.6]),
        // 衣柜
        at(G.box(1.6, 2.2, .7, C('#4a3a2c')), [3.2, 1.1, -3.9]),
        at(G.box(.04, 1.9, .05, C('#2f3238')), [3.2, 1.1, -3.53]),
        // 地毯
        at(G.cylinder(1.5, 1.5, .02, 14, C('#9a6a5a')), [1.2, .01, 1.2]),
        // 窗（发光面）
        at(G.box(2.2, 1.5, .1, C('#ffe9b8')), [2.6, 1.8, 4.3])
      ].concat(P.plant(rng, 1.2, '#4e8f52').map(function (p) { return at(p, [3.4, 0, 2.6]); }))),
      water: G.empty(),
      glow: bake([
        at(G.sphere(.14, 8, 5, C('#ffd9a0')), [-.6, 1.14, -1.6]),
        at(G.box(2.05, 1.35, .04, C('#ffeec8')), [2.6, 1.8, 4.24])
      ]),
      lights: [
        { pos: [-.6, 1.2, -1.6], color: '#ffd9a0', intensity: 1.0, radius: 5 },
        { pos: [2.6, 1.9, 3.9], color: '#ffe8c0', intensity: .85, radius: 7 }
      ],
      fog: { color: '#2e2a2e', near: 6, far: 20 },
      sky: { top: '#22202a', bottom: '#2e2a2e' },
      indoor: true
    };
  }

  /* ==================== 菜市场 ==================== */
  function market(rng) {
    var stallWood = C('#a8763f'), ground = C('#6b6f72');
    var veg = [C('#7ab05a'), C('#e8c05a'), C('#c0683f'), C('#8a5aa8')];
    var bins = [], backWall = [];
    // 棚顶条纹（用交替色块拼）
    for (var s = 0; s < 10; s++) {
      var col = s % 2 ? C('#d85a4a') : C('#e8e0d0');
      backWall.push(at(G.box(1.4, .1, 9, col), [-6.3 + s * 1.4, 3.4, 0]));
    }
    // 后排菜筐
    for (var i = 0; i < 5; i++) {
      var x = -5 + i * 2.6;
      backWall.push(at(G.cylinder(.5, .42, .3, 10, C('#a8763f')), [x, 0, -2.8]));
      for (var v = 0; v < 6; v++) {
        var vc = veg[(i + v) % 4];
        backWall.push(at(G.sphere(.13, 6, 4, vc), [x - .3 + (v % 3) * .3, .34, -2.8 + Math.floor(v / 3) * .26]));
      }
      // 秤
      backWall.push(at(G.box(.06, .3, .06, C('#9aa4ae')), [x + .8, .45, -2.8]));
      backWall.push(at(G.box(.4, .06, .3, C('#dfe4e8')), [x + .8, .62, -2.8]));
    }
    // 前景水果摊
    var front = [];
    front.push(at(G.box(3.4, .9, 1.2, stallWood), [1.4, .45, 2.2]));
    front.push(at(G.box(3.5, .08, 1.3, C('#b8864a')), [1.4, .93, 2.2]));
    for (var f = 0; f < 5; f++) {
      front.push(at(G.sphere(.2, 8, 5, veg[f % 4]), [.2 + f * .6, 1.1, 2.2]));
    }
    return {
      solid: bake([
        at(G.plane(14, 14, 8, 8, null, ground), [0, 0, 0]),
        at(G.box(.12, 3.4, 9, C('#8a8f98')), [-6.5, 1.7, 0]),
        at(G.box(.12, 3.4, 9, C('#8a8f98')), [6.5, 1.7, 0])
      ].concat(backWall, front).concat(
        P.plant(rng, 1, '#4a7f4f').map(function (p) { return at(p, [5.4, 0, 3.4]); })
      )),
      water: G.empty(),
      glow: bake([at(G.box(2.2, .1, .5, C('#fff4d0')), [0, 3.3, 0])]),
      lights: [
        { pos: [0, 3.2, 0], color: '#fff2d8', intensity: 1.15, radius: 12 },
        { pos: [1.4, 1.4, 2.2], color: '#ffe8c0', intensity: .45, radius: 4 }
      ],
      fog: { color: '#c8d4d8', near: 12, far: 40 },
      sky: { top: '#8fb8d8', bottom: '#dce8e0' },
      indoor: false
    };
  }

  /* ==================== 地铁站台 ==================== */
  function metro(rng) {
    var pillar = C('#39434d'), floorC = C('#3a424a'), wallC = C('#232a31');
    var cols = [];
    for (var i = 0; i < 4; i++) {
      var x = -5.4 + i * 3.6;
      cols.push(at(G.box(.5, 2.8, .5, pillar), [x, 1.4, -1.2]));
      cols.push(at(G.box(.56, .12, .56, C('#4d5760')), [x, 2.84, -1.2]));
    }
    // 屏蔽门框
    for (var d = 0; d < 7; d++) {
      cols.push(at(G.box(.1, 2.2, .1, C('#4d5760')), [-6 + d * 2, 1.1, -4.3]));
    }
    return {
      solid: bake([
        at(G.plane(20, 12, 10, 6, null, floorC), [0, 0, 0]),
        at(G.box(16, 3.4, .3, wallC), [0, 1.7, -5]),
        at(G.box(16, .3, 12, C('#2c343c')), [0, 3.5, 0]),
        // 黄线
        at(G.box(16, .04, .35, C('#f0c040')), [0, .02, -3.5])
      ].concat(cols)),
      water: G.empty(),
      glow: bake([
        at(G.box(1.4, .08, .3, C('#dfe8f0')), [-4.5, 3.3, 0]),
        at(G.box(1.4, .08, .3, C('#dfe8f0')), [0, 3.3, 0]),
        at(G.box(1.4, .08, .3, C('#dfe8f0')), [4.5, 3.3, 0]),
        // 车厢（对面，简化）
        at(G.box(11, 1.4, 1.2, C('#c8d2d8')), [1, 1.1, -6.4]),
        at(G.box(10.4, .7, .06, C('#2f3a45')), [1, 1.5, -5.75]),
        at(G.box(.5, .16, .06, C('#ff6b5a')), [-3.6, 1.9, -5.75])
      ]),
      lights: [
        { pos: [-4.5, 3.1, 0], color: '#dfe8f0', intensity: .9, radius: 9 },
        { pos: [0, 3.1, 0], color: '#dfe8f0', intensity: .9, radius: 9 },
        { pos: [4.5, 3.1, 0], color: '#dfe8f0', intensity: .9, radius: 9 },
        { pos: [1, 1.4, -5.6], color: '#ffe9a8', intensity: .5, radius: 6 }
      ],
      fog: { color: '#28313a', near: 8, far: 30 },
      sky: { top: '#1c2228', bottom: '#2a323a' },
      indoor: true
    };
  }

  /* ==================== 校园 ==================== */
  function campus(rng) {
    var bldg = C('#c8bfae'), track = C('#b05a48');
    var win = [];
    for (var r = 0; r < 4; r++) {
      for (var c = 0; c < 9; c++) {
        win.push(at(G.box(1, .9, .06, C('#cfe4ee')), [-6 + c * 1.5, 1.4 + r * 1.7, -4.4]));
      }
    }
    return {
      solid: bake([
        at(G.plane(40, 34, 20, 16, null, track), [0, 0, 0]),
        // 教学楼
        at(G.box(15, 6.2, 3, bldg), [0, 3.1, -6]),
        at(G.box(15.4, .4, 3.4, C('#8a7f6a')), [0, 6.3, -6]),
        at(G.box(2.4, 1.8, .2, C('#5a4a3a')), [0, .9, -4.4])
      ].concat(win).concat([
        // 跑道白线
        at(G.cylinder(6.4, 6.4, .02, 26, C('#e8e0d0')), [0, .01, 4]),
        // 旗杆
        at(G.cylinder(.06, .05, 5, 6, C('#c8ccd0')), [-7.5, 0, 2]),
        at(G.box(1.2, .1, .1, C('#c0483f')), [-7.1, 4.4, 2])
      ]).concat(
        P.tree(rng, 1.5, '#3f7a46').map(function (p) { return at(p, [8.5, 0, 1]); })
      ).concat(
        P.tree(rng, 1.2, '#468a4a').map(function (p) { return at(p, [-9, 0, 4]); })
      ).concat([
        at(G.blob(1.1, 1, .4, rng, C('#4f8a48')), [5.5, 0, 5.5])
      ])),
      water: G.empty(),
      glow: G.empty(),
      lights: [{ pos: [0, 8, 2], color: '#fff8e8', intensity: 1.2, radius: 34 }],
      fog: { color: '#cfe0e8', near: 20, far: 62 },
      sky: { top: '#7ab0e0', bottom: '#dcecf4' },
      indoor: false
    };
  }

  /* ==================== 雨中街道 ==================== */
  function rainstreet(rng) {
    var road = C('#2f343c'), wall = C('#3a4450');
    var rain = [], puddle = [];
    // 雨丝：细长斜盒（静态，靠氛围表达；动态下落留给 shader 的 uWave 同类方案）
    for (var i = 0; i < 160; i++) {
      var rx = -9 + (i % 20) * .95;
      var rz = -12 + Math.floor(i / 20) * 1.6;
      var ry = 1.2 + ((i * 37) % 60) * .05;
      rain.push(at(G.box(.025, .55, .025, C('#a8c8dc')), [rx, ry, rz], [0, 0, .32]));
    }
    // 地面反光（薄亮片）
    for (var p = 0; p < 7; p++) {
      puddle.push(at(G.cylinder(.5 + (p % 3) * .4, .5 + (p % 3) * .4, .01, 12, C('#4a6070')),
        [-6 + p * 2.1, .01, -4 + (p % 3) * 2.4]));
    }
    var neon = [];
    [[-3.5, '#ff6f8a'], [2.2, '#6fc8ff'], [6.4, '#ffd76f']].forEach(function (n) {
      neon.push(at(G.box(1.1, 1.4, .12, C(n[1])), [n[0], 2.6, -4.3]));
    });
    return {
      solid: bake([
        at(G.plane(24, 40, 12, 20, null, road), [0, 0, 0]),
        at(G.box(24, 10, 4, wall), [0, 5, -10]),
        at(G.box(4, 9, 30, C('#333c48')), [-9, 4.5, -2]),
        at(G.box(4, 8, 24, C('#3d4652')), [9, 4, 0])
      ].concat(rain, puddle).concat(
        lamp(4.6).map(function (x) { return at(x, [-5.4, 0, -4]); })
      ).concat(
        lamp(4.6).map(function (x) { return at(x, [5.4, 0, 4]); })
      )),
      water: G.empty(),
      glow: bake(neon.concat([
        at(G.sphere(.18, 8, 5, C('#fff4cf')), [-5.4, 4.6, -4]),
        at(G.sphere(.18, 8, 5, C('#fff4cf')), [5.4, 4.6, 4])
      ])),
      lights: [
        { pos: [-5.4, 4.6, -4], color: '#ffe9b8', intensity: 1.1, radius: 9 },
        { pos: [5.4, 4.6, 4], color: '#ffe9b8', intensity: 1.0, radius: 9 },
        { pos: [-3.5, 2.8, -4], color: '#ff9ab0', intensity: .55, radius: 6 },
        { pos: [2.2, 2.8, -4], color: '#8fd8ff', intensity: .5, radius: 6 }
      ],
      fog: { color: '#1a222c', near: 8, far: 34 },
      sky: { top: '#141a24', bottom: '#28323f' },
      indoor: false
    };
  }

  /* ==================== 阳台天台 ==================== */
  function balcony(rng) {
    var floorC = C('#8a7a68'), rail = C('#4a4238');
    var city = [];
    // 远景楼群
    for (var i = 0; i < 12; i++) {
      var h = 2 + ((i * 7) % 9) * .8;
      city.push(at(G.box(1.6, h, 1.6, G.shade(C('#4a4560'), .85 + (i % 3) * .1)),
        [-11 + i * 1.9, h / 2, -14 - (i % 3) * 2]));
    }
    var pots = [], cloth = [];
    for (var p = 0; p < 4; p++) {
      var px = -4.5 + p * 3;
      pots.push(at(G.cylinder(.28, .22, .4, 8, C('#a86b4a')), [px, 0, 2.6]));
      pots.push(at(G.blob(.42, 1, .4, rng, C('#4e8f52')), [px, .62, 2.6]));
    }
    // 晾衣绳 + 衣服
    cloth.push(at(G.box(6.4, .03, .03, C('#b0a89c')), [0, 2.5, 1.2]));
    [[-2.2, '#e8734f'], [-.6, '#6fc8ff'], [1, '#f0d060'], [2.4, '#8fe89a']].forEach(function (c, i) {
      cloth.push(at(G.box(.7, .9, .05, C(c[1])), [c[0], 2.05, 1.2]));
    });
    var rails = [];
    for (var r = 0; r < 12; r++) rails.push(at(G.box(.06, 1.1, .06, rail), [-5.5 + r * 1, .55, 4]));
    rails.push(at(G.box(11, .08, .08, rail), [0, 1.12, 4]));
    return {
      solid: bake([
        at(G.box(11, .2, 9, floorC), [0, -.1, 0]),
        at(G.box(11, 3.2, .2, C('#cfc4b4')), [0, 1.6, -4.4])
      ].concat(city, pots, cloth, rails).concat([
        at(G.box(1.4, .8, .5, C('#6b4f3a')), [3.4, .4, -3.6]),   // 躺椅
        at(G.box(1.4, .12, .5, C('#c9b79a')), [3.4, .84, -3.6])
      ])),
      water: G.empty(),
      glow: bake([at(G.sphere(.4, 10, 6, C('#ffb867')), [-7, 1.2, -20])]),
      lights: [
        { pos: [-7, 1.4, -20], color: '#ffb867', intensity: 1.3, radius: 40 },
        { pos: [0, 4, 0], color: '#fff0d8', intensity: .5, radius: 10 }
      ],
      fog: { color: '#f0c9a0', near: 14, far: 52 },
      sky: { top: '#5a7fb5', bottom: '#f5d8a8' },
      indoor: false
    };
  }

  /* ==================== 注册 ==================== */
  var EXTRA = [
    { id: 'bedroom', name: '卧室', tags: ['室内', '生活', '私密', '安静'], build: bedroom },
    { id: 'market', name: '菜市场', tags: ['市井', '生活', '日常', '热闹'], build: market },
    { id: 'metro', name: '地铁站台', tags: ['城市', '通勤', '室内'], build: metro },
    { id: 'campus', name: '校园', tags: ['户外', '年轻', '操场'], build: campus },
    { id: 'rainstreet', name: '雨中街道', tags: ['夜间', '城市', '情绪'], build: rainstreet },
    { id: 'balcony', name: '阳台天台', tags: ['黄昏', '生活', '安静'], build: balcony }
  ];

  EXTRA.forEach(function (p) { FS.world.PLACES.push(p); });
  FS.world.EXTRA = EXTRA;

  // 保持 placeIds() 反映最新数量（它每次都从 PLACES 现算，无需额外处理）
  FS.world.placeById = (function (orig) {
    return function (id) {
      for (var i = 0; i < FS.world.PLACES.length; i++) {
        if (FS.world.PLACES[i].id === id) return FS.world.PLACES[i];
      }
      return null;
    };
  })(FS.world.placeById);

  FS.buildPlace2 = {
    bedroom: bedroom, market: market, metro: metro,
    campus: campus, rainstreet: rainstreet, balcony: balcony
  };
})(typeof window !== 'undefined' ? window : this);
