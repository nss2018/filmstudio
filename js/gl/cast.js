/* cast.js —— 人物 / 动物：关节层级 + 程序化动画（纯数据，不依赖 GL）
 *
 * 一个角色 = 一串部件（body/head/limbs/tail…），每部件有自己的 pivot（旋转中心）与
 * 基础变换。动作 = 「静态姿态（覆盖 pos）」+「随时间摆动（叠加 rot）」。
 * 全部由 t 算出，**不用随机数** → 同一条分镜每次渲染完全一致，视频才可复现。
 *
 * 造型走低多边形：几个基本体拼一起，靠剪影和动作认人/认动物，不追求解剖。
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});
  var G = FS.geom;
  var C = G.color;

  function P(id, geo, pos, col, opt) {
    var o = { id: id, geo: geo, pos: pos || [0, 0, 0], rot: [0, 0, 0], pivot: [0, 0, 0], anim: {} };
    if (opt) for (var k in opt) o[k] = opt[k];
    return o;
  }

  /* ==================== 角色库 ==================== */

  var CASTS = [
    /* ---------------- 人 ---------------- */
    {
      id: 'person', name: '人', kind: 'human', height: 1.72,
      variants: {
        a: { skin: '#e8b98c', hair: '#3a2a22', top: '#4f7fb0', bottom: '#3a4250' },
        b: { skin: '#d9a06a', hair: '#1f1a18', top: '#c0683f', bottom: '#4a4a55' },
        c: { skin: '#f0cfae', hair: '#8a5a2a', top: '#5aa06a', bottom: '#2f3a45' }
      },
      build: function (v, rng) {
        var skin = C(v.skin), hair = C(v.hair), top = C(v.top), bottom = C(v.bottom);
        return [
          P('body', G.box(.42, .58, .24, top), [0, 1.12, 0]),
          P('bodyLow', G.box(.38, .22, .22, bottom), [0, .74, 0]),
          P('head', G.sphere(.155, 10, 7, skin), [0, 1.58, 0.01], null, { pivot: [0, 1.5, 0] }),
          P('hair', G.sphere(.163, 10, 6, hair), [0, 1.63, -.01]),
          P('armL', G.cylinder(.055, .05, .5, 6, top), [-.26, 1.36, 0], null,
            { pivot: [-.26, 1.4, 0], anim: { walk: { axis: 'x', amp: .55, speed: 5.5, phase: Math.PI } } }),
          P('armR', G.cylinder(.055, .05, .5, 6, top), [.26, 1.36, 0], null,
            { pivot: [.26, 1.4, 0], anim: { walk: { axis: 'x', amp: .55, speed: 5.5, phase: 0 }, wave: { axis: 'z', amp: .9, speed: 6, phase: 0 } } }),
          P('handL', G.sphere(.06, 6, 4, skin), [-.26, .87, 0], null, { follow: 'armL' }),
          P('handR', G.sphere(.06, 6, 4, skin), [.26, .87, 0], null, { follow: 'armR' }),
          P('legL', G.cylinder(.075, .065, .72, 6, bottom), [-.1, .74, 0], null,
            { pivot: [-.1, .76, 0], anim: { walk: { axis: 'x', amp: .62, speed: 5.5, phase: 0 } } }),
          P('legR', G.cylinder(.075, .065, .72, 6, bottom), [.1, .74, 0], null,
            { pivot: [.1, .76, 0], anim: { walk: { axis: 'x', amp: .62, speed: 5.5, phase: Math.PI } } })
        ];
      },
      poses: {
        stand: {},
        walk: {},
        sit: { body: [0, .72, 0], bodyLow: [0, .34, 0], head: [0, 1.18, .01], hair: [0, 1.23, -.01],
               armL: [-.26, .96, 0], armR: [.26, .96, 0], handL: [-.26, .47, 0], handR: [.26, .47, 0],
               legL: [-.1, .42, .12], legR: [.1, .42, .12], legLrot: [1.35, 0, 0], legRrot: [1.35, 0, 0] },
        wave: { armRrot: [0, 0, -2.2] }
      },
      idle: { type: 'breathe', amp: .012, speed: 1.6 }
    },

    /* ---------------- 猫 ---------------- */
    {
      id: 'cat', name: '猫', kind: 'animal', height: .34,
      build: function (v, rng) {
        var fur = C(v.fur || '#d9a05b'), dark = C(v.dark || '#b87f3c'), pink = C(v.pink || '#e8a0a8');
        return [
          P('body', G.blob(.22, 1, .12, rng, fur), [0, .22, 0], null, { pivot: [0, .22, 0] }),
          P('head', G.sphere(.115, 9, 6, fur), [0, .34, .16], null,
            { pivot: [0, .32, .13], anim: { greet: { axis: 'x', amp: .35, speed: 3, phase: 0 } } }),
          P('earL', G.cone(.045, .09, 5, fur), [-.06, .42, .15]),
          P('earR', G.cone(.045, .09, 5, fur), [.06, .42, .15]),
          P('snout', G.sphere(.04, 6, 4, pink), [0, .31, .26]),
          P('tail', G.cylinder(.022, .018, .3, 5, dark), [0, .3, -.18], null,
            { pivot: [0, .3, -.18], anim: { sit: { axis: 'y', amp: .9, speed: 1.4, phase: 0 }, greet: { axis: 'z', amp: .6, speed: 5, phase: 0 } } }),
          P('legFL', G.cylinder(.03, .028, .2, 5, dark), [-.09, .12, .11], null, { pivot: [-.09, .2, .11], anim: { walk: { axis: 'x', amp: .55, speed: 9, phase: 0 } } }),
          P('legFR', G.cylinder(.03, .028, .2, 5, dark), [.09, .12, .11], null, { pivot: [.09, .2, .11], anim: { walk: { axis: 'x', amp: .55, speed: 9, phase: Math.PI } } }),
          P('legBL', G.cylinder(.03, .028, .2, 5, dark), [-.09, .12, -.11], null, { pivot: [-.09, .2, -.11], anim: { walk: { axis: 'x', amp: .55, speed: 9, phase: Math.PI } } }),
          P('legBR', G.cylinder(.03, .028, .2, 5, dark), [.09, .12, -.11], null, { pivot: [.09, .2, -.11], anim: { walk: { axis: 'x', amp: .55, speed: 9, phase: 0 } } })
        ];
      },
      poses: { stand: {}, walk: {}, sit: { body: [0, .2, -.02], head: [0, .32, .16], legFL: [-.09, .06, .12], legFR: [.09, .06, .12], legBL: [-.09, .06, -.06], legBR: [.09, .06, -.06] }, greet: {} },
      idle: { type: 'breathe', amp: .008, speed: 2.2 }
    },

    /* ---------------- 狗 ---------------- */
    {
      id: 'dog', name: '狗', kind: 'animal', height: .55,
      build: function (v, rng) {
        var fur = C(v.fur || '#b5793f'), dark = C(v.dark || '#8a5a2a');
        return [
          P('body', G.blob(.26, 1, .1, rng, fur), [0, .34, 0], null, { pivot: [0, .34, 0], anim: { run: { axis: 'x', amp: .1, speed: 8, phase: 0 } } }),
          P('head', G.sphere(.15, 9, 6, fur), [0, .5, .28], null,
            { pivot: [0, .48, .24], anim: { wag: { axis: 'y', amp: .3, speed: 7, phase: 0 } } }),
          P('snout', G.box(.11, .09, .14, dark), [0, .45, .42]),
          P('earL', G.box(.05, .11, .04, dark), [-.1, .58, .26], null, { rot: [0, 0, .3] }),
          P('earR', G.box(.05, .11, .04, dark), [.1, .58, .26], null, { rot: [0, 0, -.3] }),
          P('tail', G.cylinder(.026, .018, .28, 5, fur), [0, .46, -.26], null,
            { pivot: [0, .46, -.26], anim: { wag: { axis: 'x', amp: .8, speed: 9, phase: 0 }, run: { axis: 'x', amp: .5, speed: 8, phase: 0 } } }),
          P('legFL', G.cylinder(.04, .035, .3, 5, fur), [-.13, .18, .16], null, { pivot: [-.13, .3, .16], anim: { run: { axis: 'x', amp: .7, speed: 10, phase: 0 } } }),
          P('legFR', G.cylinder(.04, .035, .3, 5, fur), [.13, .18, .16], null, { pivot: [.13, .3, .16], anim: { run: { axis: 'x', amp: .7, speed: 10, phase: Math.PI } } }),
          P('legBL', G.cylinder(.04, .035, .3, 5, fur), [-.13, .18, -.16], null, { pivot: [-.13, .3, -.16], anim: { run: { axis: 'x', amp: .7, speed: 10, phase: Math.PI } } }),
          P('legBR', G.cylinder(.04, .035, .3, 5, fur), [.13, .18, -.16], null, { pivot: [.13, .3, -.16], anim: { run: { axis: 'x', amp: .7, speed: 10, phase: 0 } } })
        ];
      },
      poses: {
        stand: {}, run: {},
        sit: { body: [0, .28, -.04], head: [0, .44, .26], tail: [0, .38, -.22],
               legFL: [-.13, .1, .2], legFR: [.13, .1, .2], legBL: [-.13, .1, .02], legBR: [.13, .1, .02] },
        wag: { tailrot: [-.4, 0, 0] }
      },
      idle: { type: 'breathe', amp: .014, speed: 2 }
    },

    /* ---------------- 鸟 ---------------- */
    {
      id: 'bird', name: '鳥', kind: 'animal', height: .22,
      build: function (v, rng) {
        var body = C(v.fur || '#4a90c8'), wing = C(v.dark || '#2f6a9a'), beak = C(v.beak || '#e8b84a');
        return [
          P('body', G.blob(.13, 1, .1, rng, body), [0, 0, 0], null, { pivot: [0, 0, 0] }),
          P('head', G.sphere(.085, 8, 6, body), [0, .09, .11]),
          P('beak', G.cone(.035, .1, 5, beak), [0, .08, .18], null, { rot: [1.5708, 0, 0] }),
          P('wingL', G.box(.26, .02, .12, wing), [-.16, .02, 0], null,
            { pivot: [0, .02, 0], anim: { fly: { axis: 'z', amp: .95, speed: 13, phase: 0 } } }),
          P('wingR', G.box(.26, .02, .12, wing), [.16, .02, 0], null,
            { pivot: [0, .02, 0], anim: { fly: { axis: 'z', amp: .95, speed: 13, phase: Math.PI } } }),
          P('tail', G.box(.05, .02, .16, wing), [0, .02, -.16], null, { rot: [.3, 0, 0] })
        ];
      },
      poses: { perch: {}, fly: {} },
      idle: { type: 'breathe', amp: .006, speed: 3 }
    },

    /* ---------------- 鱼 ---------------- */
    {
      id: 'fish', name: '魚', kind: 'animal', height: .2,
      build: function (v, rng) {
        var body = C(v.fur || '#ef8a4a'), fin = C(v.dark || '#d96a2a');
        return [
          P('body', G.sphere(.14, 9, 6, body), [0, 0, 0], null, { scale: [.55, .8, 1.25] }),
          P('tail', G.cone(.09, .12, 4, fin), [0, 0, -.19], null,
            { rot: [-1.5708, 0, 0], pivot: [0, 0, -.16], anim: { swim: { axis: 'y', amp: .6, speed: 7, phase: 0 } } }),
          P('finTop', G.box(.02, .07, .12, fin), [0, .11, -.02]),
          P('eye', G.sphere(.022, 5, 3, C('#1a1a1a')), [.055, .03, .09])
        ];
      },
      poses: { swim: {} },
      idle: { type: 'breathe', amp: .01, speed: 2.4 }
    },

    /* ---------------- 兔 ---------------- */
    {
      id: 'rabbit', name: '兔', kind: 'animal', height: .28,
      build: function (v, rng) {
        var fur = C(v.fur || '#e8e0d4'), inner = C(v.dark || '#e0b0b8');
        return [
          P('body', G.blob(.19, 1, .1, rng, fur), [0, .18, 0], null, { pivot: [0, .18, 0] }),
          P('head', G.sphere(.115, 9, 6, fur), [0, .3, .13], null,
            { pivot: [0, .28, .1], anim: { sit: { axis: 'x', amp: .2, speed: 1.2, phase: 0 } } }),
          P('earL', G.box(.05, .2, .03, fur), [-.05, .44, .11], null, { rot: [0, 0, .18] }),
          P('earR', G.box(.05, .2, .03, fur), [.05, .44, .11], null, { rot: [0, 0, -.18] }),
          P('tail', G.sphere(.055, 6, 4, inner), [0, .2, -.18]),
          P('legFL', G.cylinder(.035, .03, .16, 5, fur), [-.1, .1, .1], null, { pivot: [-.1, .16, .1], anim: { hop: { axis: 'x', amp: .8, speed: 6, phase: 0 } } }),
          P('legFR', G.cylinder(.035, .03, .16, 5, fur), [.1, .1, .1], null, { pivot: [.1, .16, .1], anim: { hop: { axis: 'x', amp: .8, speed: 6, phase: Math.PI } } })
        ];
      },
      poses: { stand: {}, sit: { body: [0, .16, -.02], head: [0, .28, .13] }, hop: {} },
      idle: { type: 'breathe', amp: .01, speed: 2.6 }
    },

    /* ---------------- 蝴蝶 ---------------- */
    {
      id: 'butterfly', name: '蝴蝶', kind: 'animal', height: .12,
      build: function (v, rng) {
        var wing = C(v.fur || '#8fd8e8'), body = C(v.dark || '#3a3a44');
        return [
          P('body', G.cylinder(.012, .008, .12, 5, body), [0, -.06, 0], null, { rot: [1.5708, 0, 0] }),
          P('wingL', G.box(.16, .005, .12, wing), [-.09, .01, 0], null,
            { pivot: [0, .01, 0], anim: { fly: { axis: 'z', amp: 1.05, speed: 17, phase: 0 } } }),
          P('wingR', G.box(.16, .005, .12, wing), [.09, .01, 0], null,
            { pivot: [0, .01, 0], anim: { fly: { axis: 'z', amp: 1.05, speed: 17, phase: Math.PI } } })
        ];
      },
      poses: { fly: {} },
      idle: { type: 'breathe', amp: .004, speed: 4 }
    }
  ];

  /* ==================== 求值 ==================== */

  function castById(id) {
    for (var i = 0; i < CASTS.length; i++) if (CASTS[i].id === id) return CASTS[i];
    return null;
  }

  /** 造一个角色实例：返回烘焙好的部件几何 + 骨架描述（几何只做一次，动画只算变换） */
  function instantiate(id, rng, variantKey) {
    var def = castById(id);
    if (!def) return null;
    var variants = def.variants || { a: {} };
    var vk = variantKey || 'a';
    var v = variants[vk] || variants[Object.keys(variants)[0]] || {};
    var r = rng || Math.random;
    var parts = def.build(v, r).map(function (p) {
      return {
        id: p.id, geo: p.geo, pos0: p.pos.slice(), rot0: p.rot.slice(),
        pivot: p.pivot, scale: p.scale || null, anim: p.anim, follow: p.follow
      };
    });
    return { id: def.id, name: def.name, kind: def.kind, height: def.height, variant: vk, parts: parts, def: def };
  }

  /**
   * 算出某一帧的部件变换。
   * inst = instantiate 的结果；action = 'stand'|'walk'|'sit'|'run'|'fly'|'swim'|'hop'|'greet'|'wave'|'perch'|'wag'
   * t = 秒；out = {x,y,z, yaw} 角色整体位姿（由导演给的路径求值）
   * 返回 [{id, pos:[3], rot:[3], scale}] —— 渲染器直接套模型矩阵
   */
  function pose(inst, action, t, out, speed) {
    var def = inst.def;
    var poses = def.poses || {};
    // 没配这个动作就退到最接近的：优先 stand，其次第一个
    var act = poses[action] ? action : (poses.stand ? 'stand' : Object.keys(poses)[0]);
    var P0 = poses[act] || {};
    var spd = speed === undefined ? 1 : speed;
    var res = [];

    for (var i = 0; i < inst.parts.length; i++) {
      var p = inst.parts[i];
      var pos = p.pos0.slice();
      var rot = p.rot0.slice();

      // 姿态覆盖：pose 里 `legL` 改位置，`legLrot` 改旋转
      if (P0[p.id]) { pos = P0[p.id].slice(); }
      if (P0[p.id + 'rot']) { rot = P0[p.id + 'rot'].slice(); }

      // 动画叠加
      var an = (p.anim && (p.anim[action] || p.anim.walk || p.anim.fly)) || null;
      if (an) {
        var s = Math.sin(t * an.speed * spd + (an.phase || 0)) * an.amp;
        var ax = an.axis || 'x';
        if (ax === 'x') rot[0] += s;
        else if (ax === 'y') rot[1] += s;
        else if (ax === 'z') rot[2] += s;
      }
      res.push({ id: p.id, pos: pos, rot: rot, scale: p.scale, pivot: p.pivot, geo: p.geo });
    }

    // 整体：呼吸/上下浮 + 走路时身体上下 bob
    var idle = def.idle || { amp: .01, speed: 1.5 };
    var bob = Math.sin(t * idle.speed) * idle.amp;
    var act2 = act;
    if (act2 === 'walk' || act2 === 'run') bob += Math.abs(Math.sin(t * (act2 === 'run' ? 10 : 5.5))) * .035;
    if (act2 === 'hop') bob = Math.abs(Math.sin(t * 3)) * .18;      // 兔子跳是抛物线
    if (act2 === 'fly') bob = Math.sin(t * 1.8) * .12;
    if (act2 === 'swim') bob = Math.sin(t * 2.2) * .05;
    for (var k = 0; k < res.length; k++) {
      res[k].pos[1] += bob;
      res[k].yaw = 0;
    }

    // 整体位姿（导演给的路径）
    res.world = {
      x: out ? out.x : 0, y: (out ? out.y : 0) + (act2 === 'fly' ? 1.4 : 0), z: out ? out.z : 0,
      yaw: out ? out.yaw : 0,
      bounce: bob
    };
    return res;
  }

  FS.cast = {
    CASTS: CASTS,
    castById: castById,
    castIds: function () { return CASTS.map(function (c) { return c.id; }); },
    instantiate: instantiate,
    pose: pose
  };
})(typeof window !== 'undefined' ? window : this);
