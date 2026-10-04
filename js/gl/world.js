/* world.js —— 生活场景库（纯几何，不依赖 GL，可在 node 里测）
 *
 * 每个地点 build() 返回：
 *   { solid, water, glow, lights, fog, sky, indoor }
 *     solid/water/glow = 已烘焙合并的几何（water 带波纹 shader，glow 自发光）
 *     lights  = 点光 {pos, color, intensity, radius}
 *     fog     = 线性雾 {color, near, far}
 *     sky     = 上下渐变 {top, bottom}
 *
 * 单位 = 米，Y 向上，人 1.7 高。房屋尺度按真实比例，方便镜头与角色对上。
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});
  var G = FS.geom;
  var C = G.color;

  /** 摆一组零件到某处。g 可以是单个几何，也可以是「几何数组」（如 table()/chair() 的返回值）——
   *  传数组时整组一起平移并合并，省得到处 map。 */
  function at(g, pos, rot, scl) {
    if (Array.isArray(g)) return G.merge(g.map(function (x) { return at(x, pos, rot, scl); }));
    if (!g) return null;
    return G.xform(g, pos || [0, 0, 0], rot || [0, 0, 0], scl || [1, 1, 1]);
  }
  function bake(list) { return G.merge(list.filter(Boolean)); }

  /* 常用零件（省得每个场景重复写） */
  function table(col, h) {
    h = h || 0.75;
    return [
      at(G.box(1.2, 0.08, 1.2, C(col)), [0, h, 0]),
      at(G.cylinder(0.06, 0.05, h, 6, C('#3a3a44')), [0, 0, 0]),
      at(G.cylinder(0.28, 0.24, 0.05, 8, C('#3a3a44')), [0, 0, 0])
    ];
  }
  function chair(col) {
    return [
      at(G.box(0.5, 0.07, 0.5, C(col)), [0, 0.45, 0]),
      at(G.box(0.5, 0.55, 0.07, C(col)), [0, 0.72, -0.22]),
      at(G.box(0.07, 0.45, 0.07, C(col || '#4a4a55')), [-0.2, 0.22, -0.2]),
      at(G.box(0.07, 0.45, 0.07, C(col || '#4a4a55')), [0.2, 0.22, -0.2]),
      at(G.box(0.07, 0.45, 0.07, C(col || '#4a4a55')), [-0.2, 0.22, 0.2]),
      at(G.box(0.07, 0.45, 0.07, C(col || '#4a4a55')), [0.2, 0.22, 0.2])
    ];
  }
  /** 盆栽：盆 + 若干球（树冠），rng 让每盆不一样 */
  function plant(rng, scale, leafCol) {
    scale = scale || 1;
    var pot = C('#a86b4a'), leaf = C(leafCol || '#4e8f52');
    var out = [at(G.cylinder(0.26 * scale, 0.34 * scale, 0.4 * scale, 8, pot), [0, 0, 0])];
    var n = 2 + Math.floor(rng() * 2);
    for (var i = 0; i < n; i++) {
      out.push(at(
        G.sphere((0.28 + rng() * 0.16) * scale, 6, 4, G.shade(leaf, .85 + rng() * .4)),
        [(rng() - .5) * .3 * scale, (0.5 + rng() * .35) * scale, (rng() - .5) * .3 * scale]
      ));
    }
    return out;
  }
  /** 树：树干 + 2~3 团树冠 */
  function tree(rng, scale, leafCol) {
    scale = scale || 1;
    var out = [at(G.cylinder(.18 * scale, .12 * scale, 2.2 * scale, 6, C('#6b4f3a')), [0, 0, 0])];
    var leaf = C(leafCol || '#3f7a46');
    var n = 2 + Math.floor(rng() * 2);
    for (var i = 0; i < n; i++) {
      out.push(at(
        G.blob(.85 * scale, 1, .55, rng, G.shade(leaf, .8 + rng() * .45)),
        [(rng() - .5) * .5 * scale, (2.1 + rng() * .8) * scale, (rng() - .5) * .5 * scale]
      ));
    }
    return out;
  }
  /** 路灯 / 吊灯共用：一个杆 + 一个发光头 */
  function lampPost(h, col) {
    return [
      at(G.cylinder(.07, .05, h, 6, C('#2f3238')), [0, 0, 0]),
      at(G.sphere(.16, 8, 5, C('#fff2c4')), [0, h, 0])
    ];
  }

  /* ==================== 地点库 ==================== */

  var PLACES = [
    {
      id: 'cafe', name: '咖啡館', tags: ['室内', '生活', '温暖', '日常'],
      build: function (rng) {
        var wood = C('#7a5a3f'), wall = C('#e8ddcc'), dark = C('#3a3a44');
        var solid = bake([
          at(G.box(11, .2, 11, wood), [0, -.1, 0]),
          at(G.box(11, 3.2, .2, wall), [0, 1.6, -5.4]),
          at(G.box(.2, 3.2, 11, wall), [-5.4, 1.6, 0]),
          at(G.box(.2, 3.2, 11, wall), [5.4, 1.6, 0]),
          at(G.box(11, .2, 11, C('#efe6d6')), [0, 3.2, 0]),
          // 吧台 + 咖啡机
          at(G.box(4.4, 1.05, .8, C('#4d3b2c')), [-2.6, .52, -4.6]),
          at(G.box(4.6, .08, .95, C('#d9cbb6')), [-2.6, 1.07, -4.6]),
          at(G.box(.7, .5, .4, dark), [-3.6, 1.35, -4.5]),
          at(G.box(.5, .35, .35, C('#8a8f98')), [-2.2, 1.28, -4.5]),
          // 两组桌椅
          at(table('#c9b79a'), [1.6, 0, 1.2]),
          at(chair('#b8563f'), [1.6, 0, 0.35]),
          at(chair('#4f7d8a'), [1.6, 0, 2.05]),
          at(table('#c9b79a'), [3.6, 0, -1.6]),
          at(chair('#6a8a4f'), [3.6, 0, -2.45]),
          at(chair('#8a5fa8'), [3.6, 0, -0.75]),
          // 窗（发光面）
          at(G.box(2.6, 1.6, .08, C('#dff0ff')), [2.4, 1.7, 5.3]),
          at(G.box(.1, 1.7, .12, dark), [1.1, 1.7, 5.28]),
          at(G.box(.1, 1.7, .12, dark), [3.7, 1.7, 5.28]),
          // 吊灯（发光 + 杆）
          at(G.cylinder(.02, .02, .9, 4, dark), [1.6, 2.3, 1.2]),
          at(G.cylinder(.05, .34, .34, 8, C('#c98a3f')), [1.6, 2.05, 1.2]),
          at(G.cylinder(.02, .02, .9, 4, dark), [3.6, 2.3, -1.6]),
          at(G.cylinder(.05, .34, .34, 8, C('#c98a3f')), [3.6, 2.05, -1.6])
        ].concat(plant(rng, 1.3, '#4e8f52').map(function (p) { return at(p, [4.6, 0, 3.4]); })));
        return {
          solid: solid,
          water: G.empty(),
          glow: bake([
            at(G.sphere(.26, 8, 5, C('#ffe9b0')), [1.6, 1.95, 1.2]),
            at(G.sphere(.26, 8, 5, C('#ffe9b0')), [3.6, 1.95, -1.6]),
            at(G.box(2.4, 1.4, .04, C('#eaf6ff')), [2.4, 1.7, 5.26])
          ]),
          lights: [
            { pos: [1.6, 1.9, 1.2], color: '#ffd9a0', intensity: 1.15, radius: 6 },
            { pos: [3.6, 1.9, -1.6], color: '#ffd9a0', intensity: 1.0, radius: 6 },
            { pos: [2.4, 1.7, 5.0], color: '#cfe8ff', intensity: 0.75, radius: 7 },
            { pos: [-2.6, 1.5, -3.6], color: '#ffe2c0', intensity: 0.5, radius: 5 }
          ],
          fog: { color: '#3a2f28', near: 7, far: 26 },
          sky: { top: '#241c18', bottom: '#3d2f26' },
          indoor: true
        };
      }
    },

    {
      id: 'street', name: '街道', tags: ['城市', '生活', '白天', '通勤'],
      build: function (rng) {
        var road = C('#3c4048'), walk = C('#8f9299'), wall = C('#b9b2a6');
        var solid = bake([
          at(G.box(7, .12, 40, road), [0, 0, 0]),
          at(G.box(2.2, .16, 40, walk), [-4.6, .02, 0]),
          at(G.box(2.2, .16, 40, walk), [4.6, .02, 0]),
          at(G.box(.18, .02, 40, C('#f0e6a8')), [0, .07, 0]),
          // 两侧楼房（不同高度/色）
          at(G.box(5, 9, 6, wall), [-7.4, 4.5, -12]),
          at(G.box(5, 12, 7, C('#a89f92')), [-7.4, 6, -2]),
          at(G.box(5, 7.5, 5.5, C('#c4bcb0')), [-7.4, 3.75, 7]),
          at(G.box(5, 11, 6.5, wall), [7.4, 5.5, -9]),
          at(G.box(5, 8.5, 6, C('#b0a89c')), [7.4, 4.25, 4]),
          // 窗（发光面，暗一点当白天反射）
          at(G.box(.06, 1.1, .8, C('#cfe0ee')), [-4.9, 5.4, -2.2]),
          at(G.box(.06, 1.1, .8, C('#cfe0ee')), [-4.9, 5.4, -0.6]),
          at(G.box(.06, 1.1, .8, C('#cfe0ee')), [4.9, 6.1, -9.4]),
          at(G.box(.06, 1.1, .8, C('#cfe0ee')), [4.9, 4.6, 3.6]),
          // 停着的车（两个盒子拼一下，够用）
          at(G.box(1.7, .8, 3.6, C('#c0483f')), [-2.6, .5, -6]),
          at(G.box(1.5, .55, 1.9, C('#2f3a45')), [-2.6, 1.12, -6]),
          at(G.box(1.7, .8, 3.6, C('#3f6fb0')), [2.6, .5, 6]),
          at(G.box(1.5, .55, 1.9, C('#2f3a45')), [2.6, 1.12, 6])
        ].concat(lampPost(4.2, '#fff').map(function (p) { return at(p, [-4.3, .1, -8]); }))
          .concat(lampPost(4.2, '#fff').map(function (p) { return at(p, [4.3, .1, 2]); }))
          .concat(plant(rng, 1.1, '#4a7f4f').map(function (p) { return at(p, [-4.4, .1, 9]); }))
          .concat(tree(rng, 1.15, '#417a45').map(function (p) { return at(p, [4.5, .1, 12]); })));
        return {
          solid: solid,
          water: G.empty(),
          glow: bake([
            at(G.sphere(.17, 8, 5, C('#fff4cf')), [-4.3, 4.3, -8]),
            at(G.sphere(.17, 8, 5, C('#fff4cf')), [4.3, 4.3, 2]),
            at(G.box(.04, 1, .7, C('#cfe0ee')), [-4.92, 5.4, -2.2]),
            at(G.box(.04, 1, .7, C('#cfe0ee')), [-4.92, 5.4, -.6])
          ]),
          lights: [
            { pos: [0, 6, 0], color: '#fff4e0', intensity: 1.25, radius: 22 },
            { pos: [-4.3, 4.3, -8], color: '#ffe9b8', intensity: .5, radius: 8 },
            { pos: [4.3, 4.3, 2], color: '#ffe9b8', intensity: .5, radius: 8 }
          ],
          fog: { color: '#b9c6d4', near: 16, far: 62 },
          sky: { top: '#7fb2e5', bottom: '#dceaf6' },
          indoor: false
        };
      }
    },

    {
      id: 'park', name: '公園', tags: ['户外', '自然', '绿色', '散步'],
      build: function (rng) {
        var grass = C('#6aa35c');
        var hills = [];
        for (var i = 0; i < 5; i++) {
          var cx = (rng() - .5) * 30, cz = -12 - rng() * 16;
          hills.push(at(G.sphere(4 + rng() * 5, 7, 4, G.shade(grass, .8 + rng() * .3)), [cx, -1.5, cz]));
        }
        var solid = bake([
          at(G.plane(60, 60, 26, 26, function (x, z) {
            return Math.sin(x * .12) * .12 + Math.cos(z * .1) * .1;   // 缓坡
          }, C('#7bb06a')), [0, 0, 0])
        ].concat(hills)
          .concat(tree(rng, 1.3, '#3d7a44').map(function (p) { return at(p, [-6, 0, -4]); }))
          .concat(tree(rng, 1.1, '#468a4a').map(function (p) { return at(p, [7, 0, -9]); }))
          .concat(tree(rng, 1.5, '#356b3c').map(function (p) { return at(p, [11, 0, 5]); }))
          .concat([ // 长椅
            at(G.box(1.8, .08, .5, C('#8a6a45')), [1.2, .45, 3]),
            at(G.box(1.8, .5, .08, C('#8a6a45')), [1.2, .72, 2.78]),
            at(G.box(.1, .45, .1, C('#3a3a44')), [.4, .22, 3]),
            at(G.box(.1, .45, .1, C('#3a3a44')), [2, .22, 3])
          ]));
        return {
          solid: solid,
          water: bake([at(G.plane(9, 7, 8, 8, null, C('#4a90b8')), [-8, .06, 5])]),
          glow: G.empty(),
          lights: [{ pos: [0, 8, 0], color: '#fff8e8', intensity: 1.2, radius: 30 }],
          fog: { color: '#cfe3c8', near: 18, far: 70 },
          sky: { top: '#6fa8e0', bottom: '#e2f0e4' },
          indoor: false
        };
      }
    },

    {
      id: 'seaside', name: '海邊', tags: ['户外', '自然', '度假', '黄昏'],
      build: function (rng) {
        var sand = C('#e0cfa4');
        var solid = bake([
          at(G.plane(60, 26, 30, 14, null, C('#efdfb8')), [0, 0, 12]),
          at(G.box(60, .5, 8, C('#9a8259')), [0, -.1, 30])
        ].concat([
          at(G.blob(1.4, 1, .5, rng, C('#8a8378')), [3, .3, 9]),
          at(G.blob(2.1, 1, .6, rng, C('#7d7669')), [6.5, .2, 11.5]),
          at(G.blob(1.1, 1, .45, rng, C('#958d80')), [-4.5, .25, 8.5])
        ]).concat([
          // 椰子树：弯树干用三段
          at(G.cylinder(.22, .18, 2.4, 6, C('#7a5c3e')), [0, 0, 0]),
          at(G.cylinder(.18, .14, 2.2, 6, C('#7a5c3e')), [.25, 2.3, .1], [0, 0, -.16]),
          at(G.blob(1.3, 1, .5, rng, C('#4f9a52')), [.6, 4.5, .2]),
          at(G.blob(1, 1, .5, rng, C('#5aa85c')), [-.5, 4.3, -.4])
        ].map(function (p) { return at(p, [-8, 0, 6]); }))
          .concat([ // 沙滩遮阳伞
            at(G.cylinder(.03, .03, 2.2, 4, C('#8a8a90')), [7, 0, 6]),
            at(G.cone(1.5, .5, 8, C('#e8734f')), [7, 2.2, 6])
          ]));
        return {
          solid: solid,
          water: bake([at(G.plane(70, 40, 34, 18, function (x, z) {
            return Math.sin(x * .09) * .06;               // 静态起伏，动态靠 shader 波纹
          }, C('#2f7fa8')), [0, -.18, -14])]),
          glow: bake([at(G.sphere(.55, 10, 6, C('#ffd98a')), [-14, 5.5, -34])]),  // 落日
          lights: [
            { pos: [-14, 5.5, -34], color: '#ffb867', intensity: 1.5, radius: 40 },
            { pos: [0, 9, 0], color: '#fff0d0', intensity: .55, radius: 34 }
          ],
          fog: { color: '#f0c9a0', near: 22, far: 80 },
          sky: { top: '#4a7fb5', bottom: '#f7c98f' },
          indoor: false
        };
      }
    },

    {
      id: 'study', name: '書房', tags: ['室内', '安静', '学习', '书'],
      build: function (rng) {
        var wood = C('#6d4c33'), wall = C('#dfe6ea');
        var books = [];
        for (var r = 0; r < 4; r++) {
          for (var b = 0; b < 9; b++) {
            var hue = [0, 24, 48, 190, 210, 340][Math.floor(rng() * 6)];
            books.push(at(G.box(.16, .34, .22, G.hsl2rgb(hue, .45, .55)), [-2.9 + b * .19, .75 + r * .46, -3.1]));
          }
        }
        var solid = bake([
          at(G.box(10, .2, 10, C('#8a6a4a')), [0, -.1, 0]),
          at(G.box(10, 3.2, .2, wall), [0, 1.6, -4.9]),
          at(G.box(.2, 3.2, 10, wall), [-4.9, 1.6, 0]),
          at(G.box(10, .2, 10, C('#f2f6f8')), [0, 3.2, 0]),
          at(G.box(4.2, 2.4, .45, C('#4d3a2c')), [0, 1.2, -3.3]),
          at(G.box(2.6, .08, .5, C('#c9a06a')), [0, .78, -2.2]),
          at(G.box(.1, .78, .4, C('#3a3a44')), [-1.1, .39, -2.2]),
          at(G.box(.1, .78, .4, C('#3a3a44')), [1.1, .39, -2.2]),
          at(G.box(.5, .35, .4, C('#e8e2d4')), [0, .99, -2.2])
        ].concat(books)
          .concat(chair('#8a5a4a').map(function (p) { return at(p, [0, 0, -1.1]); }))
          .concat([ // 台灯（发光）
            at(G.cylinder(.12, .05, .35, 8, C('#2f3238')), [1.05, .82, -2.35]),
            at(G.sphere(.13, 8, 5, C('#fff0c0')), [1.05, 1.2, -2.35])
          ]));
        return {
          solid: solid,
          water: G.empty(),
          glow: bake([at(G.sphere(.11, 8, 5, C('#fff2cc')), [1.05, 1.22, -2.35])]),
          lights: [
            { pos: [1.05, 1.25, -2.35], color: '#ffe0a8', intensity: 1.1, radius: 5.5 },
            { pos: [0, 2.6, 1], color: '#dfe8f0', intensity: .45, radius: 7 }
          ],
          fog: { color: '#2f3338', near: 6, far: 22 },
          sky: { top: '#1e2228', bottom: '#2f3439' },
          indoor: true
        };
      }
    },

    {
      id: 'lab', name: '實驗室', tags: ['室内', '科技', '研究', '冷色'],
      build: function (rng) {
        var wall = C('#dfe4e8'), steel = C('#9aa4ae'), dark = C('#39414a');
        var glass = [];
        for (var i = 0; i < 5; i++) {
          glass.push(at(G.cylinder(.06, .06, .3, 8, C('#8fd8e8')), [-1.4 + i * .35, 1.0, -1.2]));
          glass.push(at(G.cylinder(.05, .05, .16, 8, C('#7ec8a0')), [-1.4 + i * .35, 1.0, -0.4]));
        }
        var solid = bake([
          at(G.box(11, .2, 11, C('#cfd6da')), [0, -.1, 0]),
          at(G.box(11, 3.4, .2, wall), [0, 1.7, -5.4]),
          at(G.box(.2, 3.4, 11, wall), [5.4, 1.7, 0]),
          at(G.box(11, .2, 11, C('#eef2f4')), [0, 3.4, 0]),
          // 长实验台
          at(G.box(7, .12, 1.2, steel), [0, .95, -2.4]),
          at(G.box(7, .9, 1.1, C('#7f8992')), [0, .45, -2.4]),
          at(G.box(7, .06, .06, dark), [0, .55, -1.88]),
          // 显微镜
          at(G.box(.3, .1, .4, dark), [1.9, 1.05, -2.4]),
          at(G.cylinder(.06, .04, .5, 6, steel), [1.9, 1.1, -2.5]),
          // 显示屏（发光）
          at(G.box(2.4, 1.4, .1, dark), [-2.4, 1.9, -5.2]),
          // 柜子
          at(G.box(2, 2.1, .6, C('#c8d0d6')), [3.6, 1.05, -4.9]),
          at(G.box(1.9, .06, .05, dark), [3.6, 1.3, -4.58]),
          at(G.box(1.9, .06, .05, dark), [3.6, 1.0, -4.58])
        ].concat(glass).concat([
          at(G.box(.5, .4, .5, C('#c0483f')), [3.4, 1.3, -2.4])
        ]));
        return {
          solid: solid,
          water: G.empty(),
          glow: bake([
            at(G.box(2.2, 1.2, .04, C('#8fe0d0')), [-2.4, 1.9, -5.14]),
            at(G.sphere(.1, 8, 5, C('#9fe8ff')), [-1.4, 1.3, -1.2]),
            at(G.sphere(.1, 8, 5, C('#9fe8ff')), [-.7, 1.3, -1.2]),
            at(G.sphere(.1, 8, 5, C('#9fe8ff')), [0, 1.3, -1.2])
          ]),
          lights: [
            { pos: [0, 3.1, 0], color: '#eef6ff', intensity: 1.1, radius: 12 },
            { pos: [-2.4, 1.9, -4.8], color: '#8fe0d0', intensity: .6, radius: 4 },
            { pos: [0, 1.4, -1.2], color: '#9fe8ff', intensity: .4, radius: 3.5 }
          ],
          fog: { color: '#39424a', near: 8, far: 28 },
          sky: { top: '#20262c', bottom: '#39424a' },
          indoor: true
        };
      }
    },

    {
      id: 'kitchen', name: '廚房', tags: ['室内', '生活', '做饭', '家'],
      build: function (rng) {
        var cab = C('#c9d2c8'), top = C('#6b6257');
        var solid = bake([
          at(G.box(9, .2, 9, C('#a09080')), [0, -.1, 0]),
          at(G.box(9, 3.1, .2, C('#e8eae4')), [0, 1.55, -4.4]),
          at(G.box(.2, 3.1, 9, C('#e8eae4')), [-4.4, 1.55, 0]),
          at(G.box(9, .2, 9, C('#f4f6f2')), [0, 3.1, 0]),
          // 橱柜 + 台面
          at(G.box(5.5, .9, .7, cab), [-1.6, .45, -3.9]),
          at(G.box(5.7, .08, .8, top), [-1.6, .93, -3.9]),
          at(G.box(5.5, .9, .7, cab), [-1.6, .45, 3.9]),
          at(G.box(5.7, .08, .8, top), [-1.6, .93, 3.9]),
          // 冰箱
          at(G.box(1.1, 2.1, .8, C('#d8dde0')), [3.4, 1.05, -3.9]),
          at(G.box(.06, .5, .05, C('#8a9096')), [2.9, 1.3, -3.5]),
          // 灶台 + 锅
          at(G.box(1.1, .05, .8, C('#4a4f55')), [.4, .99, -3.9]),
          at(G.cylinder(.28, .26, .22, 10, C('#3a3f45')), [.4, 1.01, -3.9]),
          at(G.cylinder(.26, .26, .03, 10, C('#6a7076')), [.4, 1.23, -3.9]),
          // 餐桌
          at(table('#c8b49a', .76), [1.2, 0, .6])
        ].concat(chair('#7a9a8a').map(function (p) { return at(p, [1.2, 0, -0.35]); }))
          .concat(chair('#9a8a7a').map(function (p) { return at(p, [1.2, 0, 1.55]); }))
          .concat(plant(rng, .9, '#5aa05a').map(function (p) { return at(p, [3.9, .97, -3.6]); })));
        return {
          solid: solid,
          water: G.empty(),
          glow: bake([at(G.sphere(.14, 8, 5, C('#fff4d0')), [-1.6, 2.6, -3.9])]),
          lights: [
            { pos: [-1.6, 2.5, -3.9], color: '#ffeccc', intensity: 1.1, radius: 7 },
            { pos: [1.2, 2.4, .6], color: '#fff0dc', intensity: .5, radius: 5 }
          ],
          fog: { color: '#3a3830', near: 6, far: 22 },
          sky: { top: '#282820', bottom: '#3a3830' },
          indoor: true
        };
      }
    },

    {
      id: 'nightmarket', name: '夜市', tags: ['夜间', '城市', '热闹', '摊贩'],
      build: function (rng) {
        var stall = [], glow = [], lights = [];
        var cloth = ['#c0483f', '#3f7fc0', '#c08a3f', '#5aa06a'];
        for (var i = 0; i < 4; i++) {
          var z = -9 + i * 6.2;
          var c = C(cloth[i % 4]);
          stall.push(at(G.box(2.6, .9, 1.6, C('#5a4a3a')), [-3.4, .45, z]));
          stall.push(at(G.box(2.8, .1, 1.8, c), [-3.4, 2.15, z]));
          stall.push(at(G.box(.1, 2.2, .1, C('#3a3a44')), [-4.6, 1.1, z - .7]));
          stall.push(at(G.box(.1, 2.2, .1, C('#3a3a44')), [-2.2, 1.1, z - .7]));
          stall.push(at(G.box(.1, 2.2, .1, C('#3a3a44')), [-4.6, 1.1, z + .7]));
          stall.push(at(G.box(.1, 2.2, .1, C('#3a3a44')), [-2.2, 1.1, z + .7]));
          // 摊上货物：几个小盒
          for (var k = 0; k < 4; k++) {
            stall.push(at(G.box(.3, .25, .3, C(['#e8c05a', '#c0683f', '#7ab05a'][k % 3])), [-4.2 + k * .55, 1.05, z]));
          }
          glow.push(at(G.sphere(.2, 8, 5, C('#ffd070')), [-3.4, 1.95, z]));
          glow.push(at(G.box(2.4, .45, .04, C(['#ff6f5a', '#6fc8ff', '#ffd76f', '#8fe89a'][i % 4])), [-3.4, 2.5, z + .85]));
          lights.push({ pos: [-3.4, 1.95, z], color: '#ffcf80', intensity: 1.1, radius: 5.5 });
        }
        var solid = bake([
          at(G.box(11, .14, 40, C('#4a4a50')), [0, 0, 0]),
          at(G.box(.2, 3.4, 40, C('#3c4048')), [5.4, 1.7, 0]),
          at(G.box(.2, 3.4, 40, C('#3c4048')), [-5.4, 1.7, 0])
        ].concat(stall));
        return {
          solid: solid,
          water: G.empty(),
          glow: bake(glow),
          lights: lights.concat([{ pos: [0, 5, 0], color: '#8899bb', intensity: .35, radius: 20 }]),
          fog: { color: '#2a2430', near: 8, far: 34 },
          sky: { top: '#151220', bottom: '#2a2430' },
          indoor: false
        };
      }
    }
  ];

  /* ==================== 查询 ==================== */
  function placeById(id) {
    for (var i = 0; i < PLACES.length; i++) if (PLACES[i].id === id) return PLACES[i];
    return null;
  }
  function placeIds() { return PLACES.map(function (p) { return p.id; }); }

  /** build 一次（结果是纯静态几何，可以缓存复用） */
  function buildPlace(id, rng) {
    var p = placeById(id);
    if (!p) return null;
    var r = p.build(rng || Math.random);
    r.id = p.id;
    r.name = p.name;
    r.tags = p.tags;
    return r;
  }

  FS.world = {
    PLACES: PLACES,
    placeById: placeById,
    placeIds: placeIds,
    buildPlace: buildPlace,
    parts: { table: table, chair: chair, plant: plant, tree: tree, lampPost: lampPost, at: at, bake: bake }
  };
})(typeof window !== 'undefined' ? window : this);
