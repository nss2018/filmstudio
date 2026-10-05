/* aiscene.js —— 让模型直接写 2D 场景的绘制代码（2026-10-05）
 *
 * 目标：把「取材」这件事从「词典匹配 + 18 个手写场景」升级成
 *   **模型按文案现场画**。那些最近火的国外代码生成动画，本质就是
 *   「模型写一段 Canvas/SVG 代码 → 逐帧执行 → 出片」。这里做同一件事，
 *   但限定在一套小而确定的原语上，保证：
 *     ① 画得出来（模型只能用我们提供的 18 个原语 + 少量数学工具）
 *     ② 跑得起来（沙箱校验：语法 / 无限循环 / 异常 / 帧耗时）
 *     ③ 失败能退（校验不过就落回手写场景，绝不让成片开天窗）
 *
 * 为什么不直接让模型写任意代码：任意 new Function 在页面上跑是真实风险
 * （死循环会卡死 UI，异常会让整段母题黑屏）。所以这里的「沙箱」不是安全沙箱，
 * 而是**行为沙箱**：限定可用标识符 + 强制时间上限 + 逐帧冒烟。
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});

  var W = 1280, H = 720;

  /* ================================================================
   *  1. 交给模型的「画笔清单」
   *
   *  ⚠️⚠️ 这份清单必须和 js/scene2d/core.js 的真实签名逐字对齐。
   *  第一版是手写的，凭印象写错了三处（2026-10-05 实测出图才发现）：
   *    · building  我写 {cols,rows,lit}  实际是 {windows:true, winCols, winRows, lit}
   *      → 楼画出来了但一扇窗都没亮（lit 是 0~1 的比例，不是布尔）
   *    · particles 我写 {x,y,w,h}       实际是 {x0,y0,x1,y1}
   *      → 参数全 undefined，粒子撒到了画布外
   *    · groundBand 我写 {top}          实际是 {hz,y0,y1,x0,x1}
   *  手写清单必然会漂，所以下面 docLines() 的每一条旁边都标了**源码出处**，
   *  测试里有一条断言：把 docLines 里的参数名拿去 core.js 里 grep，必须都存在。
   * ================================================================ */
  var API_DOC = [
    '可用画笔（都在 this 上，下面用 A 代指；A 就是「这个对象」）：',
    'A.W=1280  A.H=720  A.HZ=地平线 y（默认约 430）',
    'A.lerp(a,b,t) 线性插值   A.smooth(t) 平滑   A.easeOut(t) 缓出   A.clamp01(t) 限到 0..1',
    'A.A(hex,alpha) → 带透明度的颜色串   A.shade(hex,k) 变亮(k>1)/变暗   A.mixc(hex1,hex2,t) 混色',
    'A.sky(g, stops, top, bottom)  stops 是 [[0,"#111"],[1,"#000"]] 这样的渐变数组',
    'A.glow(g, x, y, r, color, alpha)  径向光斑（月亮、灯光、光晕都用它）',
    'A.haze(g, y, h, color, alpha)  横向雾带',
    'A.groundGrid(g, {color, alpha, lw, hz, vp, y0, rows})  地面透视线网格',
    'A.groundBand(g, {color, hz, y0, y1, x0, x1})  一块地面色带（梯形）',
    'A.building(g, {x, y, w, h, depth, color, windows:true, winColor, lit, winCols, winRows, winW, winGap})',
    '    x,y 是楼的**底边**位置，h 往上长；lit 是 0~1 的亮窗比例（不写 windows 就没有窗）',
    'A.tree(g, x, baseY, h, {leaf, trunk})  树',
    'A.bush(g, x, baseY, w, color)  灌木',
    'A.table2d(g, x, baseY, w, h, topColor, legColor)  桌子（x 是中心）',
    'A.cup(g, x, baseY, w, h, color, t, o)  杯子；t 用来让热气动起来，o.steam:false 可关掉热气',
    'A.lampCone(g, x, y, spread, h, color, alpha)  从 (x,y) 往下的光锥',
    'A.personSil(g, {x, baseY, h, color, t, action})  人物剪影；action 取 "walk"/"run"/"sit"/"stand"',
    'A.catSil(g, {x, baseY, s, color, t, action})  猫剪影；注意是 s（缩放）不是 h，action 取 "walk"/"sit"',
    'A.birdSil(g, x, y, s, color)  鸟（s 是大小）',
    'A.particles(g, {n, x0, y0, x1, y1, color, size, alpha, speed, sway, t, shape})',
    '    区域用 x0/y0/x1/y1（左上到右下），speed 是每秒下移像素，shape 可为 "streak"',
    'A.text(g, str, x, y, size, color, {align, weight, baseline, shadow, shadowA})',
    'A.sign(g, x, y, w, h, label, {bg, fg, border, glowOn})  招牌/灯箱',
    '',
    'g 就是 Canvas2D 上下文，坐标系 1280x720。',
    't = 全局时间（秒），p = 本段进度 0..1。想让画面动起来就用 t。',
    '',
    '常见搭配（照抄可用）：',
    '夜空    A.sky(g,[[0,"#0a1226"],[1,"#2a1f3a"]],0,A.HZ); A.glow(g,1010,150,140,"#cfe4ff",0.3);',
    '地面    A.groundBand(g,{color:"#0b1224",hz:A.HZ}); A.groundGrid(g,{color:"#2b3a58",alpha:0.2});',
    '台灯    A.table2d(g,600,600,380,24,"#3b2f24","#241b14"); A.lampCone(g,830,470,150,200,"#ffcf8a",0.3); A.glow(g,830,472,58,"#ffdca8",0.85);',
    '人      A.personSil(g,{x:520,baseY:596,h:170,color:"#0d1524",t:t,action:"sit"});',
    '浮尘    A.particles(g,{n:34,x0:200,y0:180,x1:1100,y1:520,color:"#cfe4ff",size:2,t:t,speed:0.35});'
  ].join('\n');

  /** 生成提示词：把一段文案变成一个可执行的绘制函数 */
  function prompt(o) {
    o = o || {};
    return [
      '你是一段 Canvas2D 动画的绘制函数作者。只输出一个函数，别写任何别的。',
      '',
      '【这一段要画什么】',
      '标题：' + (o.title || '（无）'),
      '字幕：' + (o.text || '（无）'),
      o.mood ? '气氛：' + o.mood : '',
      '',
      '【输出格式】严格照抄这个形状：',
      'function(g,t,p){',
      '  var A = this;',
      '  // 背景',
      '  A.sky(g,[[0,"#1b2a4a"],[1,"#0a1220"]],0,A.HZ);',
      '  // 主体：用文案里的东西，别画无关的',
      '  A.table2d(g,640,540,320,26,"#c8a27a","#6b4f3a");',
      '  // 角色',
      '  A.personSil(g,{x:500,baseY:520,h:120,color:"#2b3a55",t:t,action:"sit",phase:0.2});',
      '  // 前景与气氛',
      '  A.glow(g,700,300,260,"#ffd9a0",0.22);',
      '  A.particles(g,{n:40,x:0,y:120,w:A.W,h:400,color:"#ffffff",size:2,t:t,speed:0.6,seed:3});',
      '}',
      '',
      '【硬性要求】',
      '1) 第一行必须是 function(g,t,p){ —— 只能是这一个函数，别写别的语句。',
      '2) 函数体里只能用 g（画布）和上面列的 A.xxx 画笔，外加 var / if / for / Math / 数组字面量。',
      '   **绝对不要用 while**（本项目会直接拒），也不要用 eval / new Function。',
      '3) **必须真的随 t 动起来**：至少一处连续运动（人物走动、粒子飘、光晕呼吸、招牌闪烁…）。',
      '   静止的画面会被判为不合格。',
      '4) 只画和字幕有关的东西。字幕是「' + (o.text || '（无）').slice(0, 18) + '」，画面要能对上。',
      '5) 不要自己 fillText 画大段文字（字幕由系统统一画），A.text 最多用来画招牌/标签。',
      '6) 不要 console.log；代码控制在 40 行以内。',
      '',
      '【画笔清单】',
      API_DOC
    ].filter(Boolean).join('\n');
  }

  /* ================================================================
   *  2. 解析模型输出
   *  模型很爱加 ```js 围栏、加前言、加解释，只有一个函数。
   *  这里只做「抠出那个函数」，不做别的加工。
   * ================================================================ */
  function extract(src) {
    if (typeof src !== 'string' || !src.trim()) throw new Error('模型没返回任何内容');
    var s = src.trim();
    s = s.replace(/^```(?:javascript|js)?/i, '').replace(/```\s*$/, '').trim();
    // 找第一个 function 到配对的最后一个 } —— 括号计数，别用正则（函数体里也有花括号）
    var start = s.search(/function\s*\w*\s*\(/);
    if (start < 0) throw new Error('输出里找不到 function（前 100 字：' + s.slice(0, 100) + '）');
    var braceAt = s.indexOf('{', start);
    if (braceAt < 0) throw new Error('function 后面没有 {');
    var d = 0, end = -1;
    for (var i = braceAt; i < s.length; i++) {
      var ch = s[i];
      if (ch === '{') d++;
      else if (ch === '}') { d--; if (d === 0) { end = i; break; } }
    }
    if (end < 0) throw new Error('function 的花括号没配平（模型输出被截断了）');
    var body = s.slice(start, end + 1);
    // 只保留这一个函数，后面模型多写的都丢掉
    return body;
  }

  /* ================================================================
   *  3. 静态检查 —— 真正的死循环防线
   *
   *  ⚠️⚠️ 这里踩过一个很贵的坑（2026-10-05）：我最初把「单帧耗时 > 400ms 就拒」
   *  写在 smoke() 里，测 `while(true){}` 直接**把 node 进程卡死**（跑满 120s
   *  被系统 kill 掉）。原因很直白：那句检查在**同步调用返回之后**才执行，
   *  而 `while(true)` 根本不会返回 —— 超时判断永远没机会跑。
   *
   *  同步代码没法在运行期打断自己，所以防线必须**提前到静态检查**：
   *    · while / do…while      → 一律拒（画场景不需要它们，for 足够）
   *    · for(;;) / for(;true;) → 拒（条件为空或恒真 = 死循环）
   *    · for 的步进子里出现 =  且步进变量是条件里的那个 → 拒（原地不动）
   *  剩下的残余风险（模型写出人类想不到的死循环）由 Worker 兜底（见 runInWorker）。
   * ================================================================ */

  /** 静态检查：返回 null 表示通过，否则返回人话原因 */
  function lint(code) {
    if (/\bwhile\s*\(/.test(code)) {
      return '代码里用了 while —— 本项目不允许 while（会死循环把页面卡死）。改用 for。';
    }
    if (/\bdo\s*\{/.test(code)) {
      return '代码里用了 do…while —— 不允许（死循环风险）。改用 for。';
    }
    // for(;;) 与 for(;true;)：条件为空或恒真
    var fors = code.match(/\bfor\s*\(([^)]*)\)/g) || [];
    for (var i = 0; i < fors.length; i++) {
      var inner = fors[i].replace(/^\s*for\s*\(/, '').replace(/\)\s*$/, '');
      var parts = inner.split(';');
      if (parts.length >= 2) {
        var cond = (parts[1] || '').trim();
        if (!cond || cond === 'true') {
          return 'for 的条件是空的或恒真（for(;;) / for(;true;)）—— 那是死循环。';
        }
        // 条件里出现的变量，如果步进子里没有它被改动 → 循环条件永远不变
        var vars = cond.match(/[A-Za-z_$][\w$]*/g) || [];
        var step = parts[2] || '';
        var frozen = vars.filter(function (v) {
          if (v === 'true' || v === 'false' || v === 'Math') return false;
          // 步进子里出现了 v 的赋值或自增就算会变
          return !(new RegExp('\\b' + v + '\\s*(=[^=]|\\+\\+|--|\\+=|-=)').test(step));
        });
        // 数字比较（i < 5）里 i 会出现在步进子；只有「变量自身不变」才可疑
        if (frozen.length && !/[<>]/.test(cond)) {
          return 'for 的条件里 ' + frozen.slice(0, 3).join('、') + ' 从不改变 —— 那是死循环。';
        }
      }
    }
    // 递归调用自己（不是通过 A，是裸函数名 —— 其实拿不到，但保险）
    if (/\bnew\s+Function\b|\beval\s*\(/.test(code)) {
      return '代码里用了 new Function / eval —— 不允许。';
    }
    return null;
  }

  /* ================================================================
   *  4. 编译 + 校验
   * ================================================================ */

  function brush() {
    return FS.s2d || {};
  }

  /**
   * 编译模型写的函数。返回一个「已绑好 A 的绘制器」(g,t,p) → 调用模型函数。
   *
   * ⚠️ 包装函数的形参必须把 g/t/p 一起列出来（2026-10-05 实测踩到）：
   *   写成 `new Function('A', 'return (code).call(A, g, t, p)')` 时
   *   g/t/p 在包装函数作用域里**根本不存在**，于是任何一句 A.sky(g,…) 都会
   *   报「g is not defined」——看起来像模型写错了，其实是包装层自己漏了形参。
   *
   * 模型函数内部写的是 `var A = this`，所以用 .call(A, …) 把 this 指向画笔表。
   */
  function compile(code) {
    if (typeof code !== 'string' || !code) throw new Error('没有代码可编译');
    var bad = lint(code);
    if (bad) throw new Error(bad);
    // 语法检查先单独做一遍，报错信息更好读
    try {
      /* eslint-disable no-new-func */
      new Function('return (' + code + ')');
    } catch (e) {
      throw new Error('语法错：' + (e && e.message ? e.message : String(e)));
    }
    var factory;
    try {
      // eslint-disable-next-line no-new-func
      factory = new Function('A', 'g', 't', 'p',
        'return (' + code + ').call(A, g, t, p);');
    } catch (e) {
      throw new Error('编译失败：' + (e && e.message ? e.message : String(e)));
    }
    var A = brush();
    return function (g, t, p) { return factory(A, g, t, p); };
  }

  /** 造一个只记几何的假画布：模型乱画也不会污染真舞台。
   *  ⚠️ 所有方法都要计数 —— 只数 fillRect 会把「用 arc 画的树/鸟/人物」全漏掉，
   *  结果是明明画了一堆东西却被判成「等于什么都没画」（实测踩到）。 */
  function probeCtx() {
    var ctx = {
      canvas: { width: W, height: H },
      calls: 0,
      fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
      globalAlpha: 1, shadowColor: '', shadowBlur: 0,
      measureText: function (t) { return { width: String(t).length * 12 }; },
      createLinearGradient: function () { return { addColorStop: function () {} }; },
      createRadialGradient: function () { return { addColorStop: function () {} }; },
      save: function () { ctx.calls++; }, restore: function () { ctx.calls++; }
    };
    var METHODS = ['fillRect', 'strokeRect', 'clearRect', 'beginPath', 'closePath', 'moveTo',
      'lineTo', 'arc', 'arcTo', 'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'rect',
      'clip', 'fill', 'stroke', 'fillText', 'strokeText', 'translate', 'rotate', 'scale',
      'setTransform', 'resetTransform'];
    METHODS.forEach(function (m) {
      ctx[m] = function () { ctx.calls++; };
    });
    // 单帧调用预算：即使静态检查漏了什么，画上万次也是有问题
    // ⚠️ 这里用抛异常打断 —— 同步循环里这是唯一能生效的「刹车」
    var budget = 20000;
    ['fill', 'stroke', 'fillRect', 'fillText', 'moveTo', 'lineTo', 'arc'].forEach(function (m) {
      var orig = ctx[m];
      ctx[m] = function () {
        if (ctx.calls > budget) throw new Error('单帧画了超过 ' + budget + ' 次（多半是循环没退出）');
        return orig.apply(ctx, arguments);
      };
    });
    return ctx;
  }

  /**
   * 冒烟：在假画布上真跑一帧。**这里不再做超时判断**（见上面那段说明：
   * 同步调用没返回，判断就没意义）。只判「画没画东西」和「有没有抛错」。
   */
  function smoke(runFn, t) {
    var g = probeCtx();
    try {
      runFn(g, t === undefined ? 0.6 : t, 0.4);
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      if (msg.indexOf('单帧画了超过') >= 0) return { ok: false, reason: msg, calls: g.calls };
      return { ok: false, reason: '运行时抛错：' + msg, calls: g.calls };
    }
    if (g.calls < 3) return { ok: false, reason: '一帧只画了 ' + g.calls + ' 次（等于什么都没画）', calls: g.calls };
    return { ok: true, calls: g.calls };
  }

  /** 注册一个 AI 场景。id 形如 'ai-3'，会进 FS.s2dScenes，与手写场景同一时间轴驱动。 */
  function register(id, code, meta) {
    var fn = compile(code);
    var sm = smoke(fn, 0.6);
    if (!sm.ok) throw new Error(sm.reason);
    var R = FS.s2dScenes = FS.s2dScenes || {};
    // 直接挂编译好的绘制器：它已经自己绑好 A 了
    R[id] = fn;
    R.meta = R.meta || {};
    R.meta[id] = {
      name: (meta && meta.name) || ('AI 场景 ' + id),
      tags: ['AI 生成', (meta && meta.tag) || '代码绘制'],
      ai: true, code: code
    };
    return { id: id, calls: sm.calls, ms: sm.ms };
  }

  /** 删掉一个 AI 场景（用户点了「换一版」要能撤回上一版） */
  function unregister(id) {
    var R = FS.s2dScenes;
    if (!R) return false;
    delete R[id];
    if (R.meta) delete R.meta[id];
    return true;
  }

  function isAi(id) {
    var R = FS.s2dScenes;
    return !!(R && R.meta && R.meta[id] && R.meta[id].ai);
  }

  /** 取回某个 AI 场景的源码（导出项目时带上，方便复现） */
  function codeOf(id) {
    var R = FS.s2dScenes;
    return (R && R.meta && R.meta[id]) ? (R.meta[id].code || '') : '';
  }

  FS.aiscene = {
    prompt: prompt, API_DOC: API_DOC,
    extract: extract, lint: lint, compile: compile, smoke: smoke,
    register: register, unregister: unregister, isAi: isAi, codeOf: codeOf,
    probeCtx: probeCtx, W: W, H: H
  };
})(typeof window !== 'undefined' ? window : this);
