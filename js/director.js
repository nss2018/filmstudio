/* director.js —— 导演层：把文案变成可渲染的分镜脚本
 *
 * 一句话：**文案 → (地点 / 角色 / 动作 / 镜头 / 光线) → storyboard**，渲染器只负责照着画。
 *
 * 两条通道（结果结构完全一样，UI 可以无缝切换）：
 *   ① 本地（默认，零 Key 不联网）：关键词词典 + 曲式模板 + 种子 PRNG。
 *      同文案同种子 = 同一部片子；换种子 = 另一部片子（地点/角色/动作/镜头/配色都变）。
 *   ② LLM：让模型直接出分镜（把地点/角色/镜头的合法值都列给它），再经 sanitize 白名单校验。
 *      模型给错值、漏字段、编造地点，一律按本地规则补回，**不让脏数据进渲染层**。
 *
 * 导演的判断力（这是"像那么回事"的关键，纯随机做不到）：
 *   · 鱼/蝴蝶/鸟不该出现在室内 → 换地点或换角色
 *   · 室内活动范围小、室外大；狗在室内只坐不跑
 *   · 整片保留一个主角，避免每段换人导致叙事断裂
 *   · 曲线式：建立 → 推近 → 横移/环绕 → 拉远，镜头类型按段位分配而不是乱抽
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});
  var C = FS.camera;

  /* ==================== 词典 ==================== */

  /** 地点关键词 → place id（先命中先赢；都没命中走 seed 落表） */
  var PLACE_WORDS = {
    cafe: ['咖啡', '拿铁', '杯', '吧台', '烘焙', '甜点', '小店', '咖啡馆', '馆'],
    // '通勤'/'车' 归 metro：留在 street 会和地铁站抢命中（同权重时随机，
    // 「地铁通勤」会判成街道）。'街/马路/路/城市/大楼/霓虹' 才是街道的专属词。
    street: ['街', '马路', '路', '城市', '大楼', '霓虹', '都市', '广场'],
    park: ['公园', '树', '草地', '长椅', '散步', '林荫', '花', '草坪', '林'],
    seaside: ['海', '浪', '沙滩', '海边', '礁石', '椰', '日落', '黄昏', '潮', '港'],
    study: ['书', '读', '学习', '教室', '黑板', '知识', '图书馆', '写字', '阅读', '讲义'],
    lab: ['实验', '试剂', '数据', '屏幕', '研究', '分析', '样本', '试管', '观测', '实验室'],
    kitchen: ['厨', '做饭', '吃', '餐桌', '锅', '菜', '厨房', '汤', '灶'],
    // 「夜」这种单字太宽（夜晚氛围 ≠ 夜市），地点词表里只留「夜市」这种具体词；
    // 「夜」留给下面的 MOOD_WORDS 判断氛围。
    nightmarket: ['夜市', '摊', '市集', '灯笼', '热闹', '小吃', '摆摊'],
    bedroom: ['卧室', '床', '睡觉', '被窝', '枕', '起床', '卧室里'],
    market: ['菜市场', '菜场', '买菜', '摊主', '讨价', '菜筐', '果摊', '菜市场里'],
    metro: ['地铁', '站台', '地铁站', '车厢', '候车', '闸机', '通勤'],
    campus: ['校园', '学校', '操场', '教室', '操场', '同学', '校园里', '上课'],
    rainstreet: ['下雨', '雨天', '雨夜', '雨巷', '撑伞', '湿漉', '雨天街'],
    balcony: ['阳台', '天台', '晒太阳', '晾衣', '楼下', '阳台上'],
    // ---- 第二批生活场景（world3.js）----
    // 「沙发/电视/地毯/回家」：客厅的生活感全在这几个词上。不收单字「家」，
    // 那会和「家国/大家」这类抽象词撞。
    livingroom: ['客厅', '沙发', '电视', '地毯', '家里', '回家', '居家', '落地灯', '客厅里', '待在家'],
    // 「显示器/工位/加班」归办公室；「屏幕/数据」留给 lab，别混。
    office: ['办公室', '办公', '工位', '加班', '上班', '电脑', '显示器', '写字楼', '打卡', '会议室', '报表'],
    bakery: ['面包', '烤箱', '蛋糕', '早餐', '早点', '出炉', '麦香', '面包房', '烤炉', '面包香', '甜面包'],
    hospital: ['医院', '病房', '病床', '输液', '吊瓶', '生病', '挂号', '护士', '康复', '陪护', '体检'],
    farmfield: ['麦田', '田埂', '田野', '稻田', '稻草人', '谷仓', '丰收', '麦浪', '农舍', '耕地', '种地'],
    busstop: ['公交站', '公交', '巴士', '等车', '站牌', '候车亭', '公交车', '末班车', '车站']   // 「站台/候车」已归 metro，这里不抢
  };

  /** 角色关键词 → cast id */
  var CAST_WORDS = {
    person: ['人', '他', '她', '我们', '你', '学生', '老师', '朋友', '孩子', '主角', '观众', '生活'],
    cat: ['猫', '喵', '小猫'],
    dog: ['狗', '汪', '小狗', '犬'],
    bird: ['鸟', '飞', '雀', '燕子', '鸥', '鸽'],
    fish: ['鱼', '游', '鳞', '缸', ' aquatic'],
    rabbit: ['兔', '跳', '绒'],
    butterfly: ['蝶', '蝴蝶', '翅膀', '花粉']
  };

  /** 每个角色能做的动作（不给它做不到的动作） */
  var ACTIONS = {
    person: ['stand', 'walk', 'sit', 'wave'],
    cat: ['sit', 'walk', 'greet'],
    dog: ['run', 'sit', 'wag'],
    bird: ['perch', 'fly'],
    fish: ['swim'],
    rabbit: ['hop', 'sit'],
    butterfly: ['fly']
  };

  /** 角色只能在这些地方待着（不在列表里 = 该角色不该出现在此场景） */
  var HABITAT = {
    fish: ['seaside', 'park'],                                  // 水生：只在水边
    butterfly: ['park', 'seaside', 'street', 'cafe', 'market', 'balcony', 'campus', 'farmfield'],
    bird: ['park', 'seaside', 'street', 'campus', 'balcony', 'farmfield', 'busstop', 'livingroom'],
    cat: ['cafe', 'street', 'park', 'kitchen', 'study', 'nightmarket', 'bedroom', 'balcony', 'market',
          'livingroom', 'office', 'bakery'],
    dog: ['park', 'street', 'seaside', 'cafe', 'nightmarket', 'rainstreet', 'campus', 'market', 'balcony',
          'livingroom', 'farmfield', 'busstop'],
    rabbit: ['park', 'street', 'seaside', 'balcony', 'campus', 'farmfield'],
    person: ['cafe', 'street', 'park', 'seaside', 'study', 'lab', 'kitchen', 'nightmarket',
             'bedroom', 'market', 'metro', 'campus', 'rainstreet', 'balcony',
             'livingroom', 'office', 'bakery', 'hospital', 'farmfield', 'busstop']
  };

  /** 情绪关键词 → 光线/氛围 */
  var MOOD_WORDS = {
    night: ['夜', '晚', '黑暗', '星光', '月亮', '凌晨', '霓虹'],
    warm: ['温暖', '暖', '柔和', '黄昏', '夕阳', '亲密', '怀旧', '香'],
    cold: ['冷', '理性', '数据', '实验', '精密', '孤独', '科技', '算法'],
    bright: ['明亮', '清晨', '阳光', '清晨', '正午', '轻快', '清新']
  };

  /** 各地点的「站位 / 坐位」知识（导演专用：角色该站哪、该坐哪） */
  var SPOTS = {
    cafe: { sit: [[1.6, 0.35], [1.6, 2.05], [3.6, -0.75], [3.6, -2.45]], stand: [[-1.2, -2.6], [2.2, -1.4], [0.2, 1.4]] },
    street: { sit: [], stand: [[-4.2, -5], [-4.2, 1], [4.2, -2], [4.2, 6]] },
    park: { sit: [[0.9, 3.3]], stand: [[-3, 0], [2, -2], [5, 2], [-1, -5]] },
    seaside: { sit: [], stand: [[-2, 8], [2, 9], [4, 6], [-5, 7]] },
    study: { sit: [[0, -1.15]], stand: [[-2.4, -2.6], [1.6, -2.4]] },
    lab: { sit: [], stand: [[-.6, -1.5], [1.2, -1.6], [-1.8, -.8]] },
    kitchen: { sit: [[1.2, -0.35], [1.2, 1.55]], stand: [[-2.4, -3], [0.4, -2.6]] },
    nightmarket: { sit: [], stand: [[-1.6, -9], [-1.4, -2.8], [-1.8, 3.4], [-1.5, 9.6]] },
    bedroom: { sit: [[-2.2, 1.2]], stand: [[0.4, 1.4], [-1.6, 2.4], [2.2, -2.2]] },
    market: { sit: [], stand: [[0.2, 1.4], [2.4, 1.6], [-1.8, 0.4], [3.6, -1.2]] },
    metro: { sit: [], stand: [[-3.2, -1.6], [-1.4, -2.2], [2.2, -1.4], [3.8, 0.4]] },
    campus: { sit: [], stand: [[-4.5, 3.4], [2.5, 4.2], [6, 2], [-6, 1]] },
    rainstreet: { sit: [], stand: [[-4.4, -3], [4.4, 2], [-3.4, 4], [2.6, -5]] },
    balcony: { sit: [[3.4, -3.4]], stand: [[-2, 1.4], [1.4, 2], [-3.6, -1]] },
    // ---- 第二批（world3.js）：坐位贴着沙发/工位/陪客椅/长椅摆，别飘在墙里 ----
    livingroom: { sit: [[-1.2, 2.6], [-0.4, 3.4]], stand: [[2.4, 2.6], [-3.2, -1.4], [1.6, -3.4]] },
    office: { sit: [[-2.6, .2], [0, .3], [2.6, .1]], stand: [[-4.4, 2], [4.2, 2.6], [0, 3.2]] },
    bakery: { sit: [], stand: [[-2.4, 3], [0, 3.4], [2.4, 2.8], [0, -1.6]] },
    hospital: { sit: [[1.6, 2.6]], stand: [[-3.4, -2.4], [-1.4, 1.6], [3, -1]] },
    farmfield: { sit: [], stand: [[0, 5.4], [-4, 3], [4, 4], [1.6, -1.2]] },
    busstop: { sit: [[-0.3, 2.6]], stand: [[-2.6, 3.2], [2.2, 3.4], [0, 4.6]] }
  };

  /** 曲式：不同段数配不同镜头节奏 */
  var SHOT_PLAN = {
    3: ['establish', 'push', 'pullout'],
    4: ['establish', 'push', 'track', 'pullout'],
    5: ['establish', 'push', 'track', 'orbit', 'pullout']
  };

  /** 每种氛围的光线乘数与色调（渲染器直接用） */
  var GRADE = {
    day: { lightMul: 1.12, fogMul: 1.0, tint: [1.02, 1.02, 1.0], label: '白天' },
    dusk: { lightMul: 0.85, fogMul: 1.12, tint: [1.12, 0.98, 0.88], label: '黄昏' },
    night: { lightMul: 0.55, fogMul: 0.88, tint: [0.82, 0.88, 1.12], label: '夜晚' },
    cold: { lightMul: 0.95, fogMul: 0.95, tint: [0.94, 1.0, 1.08], label: '冷调' },
    warm: { lightMul: 1.0, fogMul: 1.05, tint: [1.1, 1.0, 0.9], label: '暖调' }
  };

  /* ==================== 种子随机（与 factory.js 同一套） ==================== */

  function fnv(s) {
    var h = 2166136261 >>> 0;
    s = String(s);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function mkRng(seed) {
    var f = mulberry32(typeof seed === 'number' ? seed >>> 0 : fnv(seed));
    return {
      seed: seed,
      f: f,
      next: f,
      int: function (n) { return Math.floor(f() * n); },
      range: function (a, b) { return a + f() * (b - a); },
      chance: function (p) { return f() < p; },
      pick: function (arr) { return arr[Math.floor(f() * arr.length)]; }
    };
  }

  /* ==================== 文本解析 ==================== */

  /** 整段文本里找词典命中项；返回 {place:[{id,w}], cast:[{id,w}], mood:[...]}
   *  w = 命中词长度当权重：「实验室」比「夜」具体，所以要压过它 ——
   *  不加权的话「实验室的夜」会被判成夜市（'夜' 也命中 nightmarket），这就离谱了。 */
  function readText(texts) {
    var all = (Array.isArray(texts) ? texts.join(' ') : String(texts)).toLowerCase();
    function hit(dict) {
      var out = [];
      Object.keys(dict).forEach(function (k) {
        var best = 0;
        for (var i = 0; i < dict[k].length; i++) {
          if (all.indexOf(dict[k][i]) >= 0 && dict[k][i].length > best) best = dict[k][i].length;
        }
        if (best) out.push({ id: k, w: best });
      });
      out.sort(function (a, b) { return b.w - a.w; });   // 具体的在前
      return out;
    }
    return { place: hit(PLACE_WORDS), cast: hit(CAST_WORDS), mood: hit(MOOD_WORDS) };
  }

  /** 从加权命中里挑：只在「最高权重并列」时随机。
   *  「实验室的夜」里 lab 权重 2（实验）、nightmarket 权重 1（夜）→ 必须判 lab，
   *  给弱词 50% 机会的话「实验室的发现」会变成夜市片。 */
  function pickByWeight(list, r) {
    if (!list || !list.length) return null;
    var max = list[0].w;
    var top = list.filter(function (x) { return x.w === max; });
    return r.pick(top).id;
  }

  /* ==================== 合理性约束 ==================== */

  function placeIndoor(id) {
    var p = FS.world.placeById(id);
    // ⚠️ 这个列表是硬编码的，新加室内地点忘了登记 → 角色在屋里还能「跑/飞」，
    //    机位也不收紧，会穿墙。world3.js 新增的 4 个室内场景必须同步进来。
    return !!(p && ['cafe', 'study', 'lab', 'kitchen', 'bedroom', 'metro',
                    'livingroom', 'office', 'bakery', 'hospital'].indexOf(id) >= 0);
  }

  /** 这个角色能不能出现在这个地点；不能的话给一个替代方案 */
  function reconcile(castId, placeId, r) {
    var hab = HABITAT[castId] || [];
    if (hab.indexOf(placeId) >= 0) return { cast: castId, place: placeId, changed: null };
    // 先换角色（保留地点更常用 —— 片子已经在这个地方了）
    var altCast = Object.keys(HABITAT).filter(function (k) {
      return HABITAT[k].indexOf(placeId) >= 0 && k !== castId;
    });
    if (altCast.length) return { cast: r.pick(altCast), place: placeId, changed: 'cast' };
    // 换地点
    var altPlace = hab.length ? hab[0] : 'street';
    return { cast: castId, place: altPlace, changed: 'place' };
  }

  /** 角色在给定动作下的合法集合（室内不能跑、不能飞） */
  function legalActions(castId, placeId) {
    var list = (ACTIONS[castId] || ['stand']).slice();
    if (placeIndoor(placeId)) {
      list = list.filter(function (a) { return ['run', 'fly', 'hop', 'swim'].indexOf(a) < 0; });
    }
    return list.length ? list : ['stand'];
  }

  /* ==================== 镜头 ==================== */

  /* ==================== 机位安全表（对齐 world.js 的墙距 / 雾距，改了那边要同步） ====================
     CAM_R   室内房间可用半径 = 墙距 - 0.6 余量。室内机位按它收紧，否则穿墙后整帧只剩墙面和雾。
     CAM_BOX 走廊型地点（街道两侧是楼、夜市两侧是墙）：机位钳进路廊 |x|≤x, |z|≤z，不能按圆钳。
     CAM_DIST 走廊地点的机位距离（夜市雾 near 只有 8，按 8.5 拉机位必糊雾）。 */
  var CAM_R = { cafe: 4.8, study: 4.3, lab: 4.8, kitchen: 3.8 };
  var CAM_BOX = { street: { x: 4.5, z: 16 }, nightmarket: { x: 4.8, z: 16 } };
  var CAM_DIST = { nightmarket: 5.2 };

  function shotFor(kind, r, indoor, focus, place) {
    var maxR = CAM_R[place] || 4.8;
    var box = !indoor ? (CAM_BOX[place] || null) : null;
    // 室内：注视点（mid）最多离房间中心 ~2.2m（build 里钳过），机位再远就穿墙——
    // 过去室内也按 4.2m 给机位，厨房（墙距 4.4m）直接穿出去，画面只剩墙面和雾。
    var dist = indoor ? Math.max(1.4, maxR - 2.2) : (CAM_DIST[place] || 8.5);
    var cap = indoor ? dist : (CAM_DIST[place] || 13.5);   // 机位离注视点的水平距离上限
    var height = indoor ? 1.75 : 2.4;
    var f = focus || [0, 1.2, 0];
    // 走廊地点：注视点收到路中线和廊中部——orbit 半径 4.2 会从注视点向外伸，
    // 注视点太靠边（演员走位可到 z≈±14）机位照样出廊，所以 x、z 都要收。
    if (box) f = [Math.max(-2, Math.min(2, f[0])), f[1], Math.max(4.3 - box.z, Math.min(box.z - 4.3, f[2]))];
    var ang = r.range(0, Math.PI * 2);
    var ca = Math.cos(ang), sa = Math.sin(ang);
    var s;
    switch (kind) {
      case 'establish':
        // ⚠️ camera.js 的 orbit 约定：from/to = [角度°, 半径, 高度]，不是 xyz！
        // 过去把 15~60 当 x 坐标传，被当成角度，碰巧半径 = dist*1.5 还能看；现在按约定正经生成。
        // 走廊地点绕「路轴」转（target.x 归零），半径收到路宽内，不然机位扫进两侧楼体里。
        var er, orbitT;
        if (box) { er = 4.2; orbitT = [0, f[1], f[2]]; }
        else if (indoor) { er = Math.min(dist * 1.5, cap); orbitT = f.slice(); }
        else { er = dist * 1.5; orbitT = f.slice(); }
        s = { type: 'orbit', from: [r.range(0, 360), er, height + r.range(0, 1.2)], to: [r.range(0, 360), er * 0.9, height], target: orbitT, fov: 46, ease: 'inOutCubic' };
        break;
      case 'push':
        s = { type: 'dolly_in', from: [f[0] + ca * dist, height, f[2] + sa * dist], to: [f[0] + ca * dist * 0.42, height * 0.92, f[2] + sa * dist * 0.42], target: f.slice(), fov: 44, fovTo: 36, ease: 'inOutCubic' };
        break;
      case 'track':
        if (box) {
          // follow 会绕注视点全角扫（运行时 ±17°、恒距 dist），走廊两侧就是楼/墙，眼位必穿帮——
          // 改成「横移 + 视线沿路轴」：眼位整段锁在廊内，观看感受仍是横向跟踪。
          s = { type: 'pan', from: [f[0] - 1.8, height, f[2]], to: [f[0] + 1.8, height, f[2]], fov: 42, ease: 'inOutQuad' };
        } else {
          // dist 显式传给 follow：注视点两侧走弧线时保持原观看距离，别退到 max(4,|to-from|) 把主体拍远了
          s = { type: indoor ? 'pan' : 'follow', from: [f[0] - ca * dist, height, f[2] - sa * dist], to: [f[0] + ca * dist, height, f[2] + sa * dist], target: f.slice(), dist: dist, fov: 42, ease: 'inOutQuad' };
        }
        break;
      case 'orbit':
        if (box) {
          // push_orbit 保持眼距绕注视点转 ±15°，注视点靠边时眼位照样扫进楼体——
          // 改绕「路轴心」（target.x=0）的 orbit，半径 4.2 < 廊半宽，几何上保证不出廊。
          s = { type: 'orbit', from: [r.range(0, 360), 4.2, height], to: [r.range(0, 360), 3.4, height + .8], target: [0, f[1], f[2]], fov: 40, ease: 'inOutCubic', handheld: .6 };
        } else {
          s = { type: 'push_orbit', from: [f[0] + ca * dist, height, f[2] + sa * dist], to: [f[0] + ca * dist * 0.55, height * 1.05, f[2] + sa * dist * 0.55], target: f.slice(), fov: 40, ease: 'inOutCubic', handheld: .6 };
        }
        break;
      case 'pullout':
      default:
        s = { type: 'crane', from: [f[0] + ca * dist * 0.5, height * 0.85, f[2] + sa * dist * 0.5], to: [f[0] + ca * dist * 1.9, height + (indoor ? .5 : 3.2), f[2] + sa * dist * 1.9], target: f.slice(), fov: 38, fovTo: 50, ease: 'inOutCubic' };
        break;
    }
    s.handheld = s.handheld === undefined ? (indoor ? .35 : .8) : s.handheld;
    s.breath = indoor ? .5 : 1;
    // 机位安全钳：from/to 到注视点的水平距离不许超 cap（orbit 是 [角度,半径,高度] 语义，半径单独限）
    if (s.type === 'orbit') {
      if (indoor) {
        var lim = Math.max(1.2, maxR - 2.2);
        if (s.from[1] > lim) s.from[1] = lim;
        if (s.to[1] > lim) s.to[1] = lim;
      }
    } else {
      [s.from, s.to].forEach(function (p) {
        var dx = p[0] - f[0], dz = p[2] - f[2], m = Math.hypot(dx, dz);
        if (m > cap) { p[0] = f[0] + dx * cap / m; p[2] = f[2] + dz * cap / m; }
        if (box) {
          // 路廊钳：楼体/墙在两侧，机位的 x、z 分别钳进廊内
          if (p[0] > box.x) p[0] = box.x; else if (p[0] < -box.x) p[0] = -box.x;
          if (p[2] > box.z) p[2] = box.z; else if (p[2] < -box.z) p[2] = -box.z;
        } else if (indoor) {
          // 房间钳：墙在四周，机位到房间中心的水平距离也不许超 maxR
          var m0 = Math.hypot(p[0], p[2]);
          if (m0 > maxR) { p[0] *= maxR / m0; p[2] *= maxR / m0; }
        }
      });
    }
    return s;
  }

  /* ==================== 本地分镜生成 ==================== */

  /**
   * opts = { title, scenes:[{title,text}], bpm, beats, seed, keepPlace }
   * 返回 storyboard（渲染器直接吃）
   */
  function build(opts) {
    opts = opts || {};
    var scenes = (opts.scenes && opts.scenes.length) ? opts.scenes : [{ title: opts.title || '未命名', text: '' }];
    var texts = scenes.map(function (s) { return (s.title || '') + ' ' + (s.text || ''); });
    var seed = (opts.seed === undefined || opts.seed === null || opts.seed === '')
      ? fnv((opts.title || '') + '|' + texts.join('|'))
      : opts.seed;
    var r = mkRng(seed);

    var read = readText(texts);
    var PLACE_IDS = FS.world.placeIds();

    // ① 主地点：文案命中优先（按词的具体程度加权），否则 seed 落表
    var hitPlace = pickByWeight(read.place, r);
    var mainPlace = opts.keepPlace || hitPlace || PLACE_IDS[seed % PLACE_IDS.length];
    // ② 主角：文案命中优先；再没有就放个人（生活片总得有人）
    var hitCast = pickByWeight(read.cast, r);
    var hero = hitCast || 'person';
    var rc = reconcile(hero, mainPlace, r);
    hero = rc.cast; mainPlace = rc.place;
    // ③ 配角：命中里剩下的，或按 seed 挑一个同场景的
    var support = read.cast.filter(function (c) { return c.id !== hero && (HABITAT[c.id] || []).indexOf(mainPlace) >= 0; })
      .map(function (c) { return c.id; });
    if (!support.length && r.chance(.55)) {
      var pool = Object.keys(HABITAT).filter(function (c) { return c !== hero && HABITAT[c].indexOf(mainPlace) >= 0; });
      if (pool.length) support = [r.pick(pool)];
    }
    // ④ 氛围
    var mood = read.mood.length ? read.mood[0].id : (placeIndoor(mainPlace) ? 'warm' : 'day');
    var plan = SHOT_PLAN[scenes.length] || SHOT_PLAN[4];
    var bpm = opts.bpm || 84;
    var beats = opts.beats || 8;
    var spb = 60 / bpm;

    var shots = [];
    for (var i = 0; i < scenes.length; i++) {
      // 换地点：只允许切到「相关地点」，且 30% 概率（避免整片乱跳）
      var place = mainPlace;
      if (i > 0 && r.chance(.3)) {
        var rel = RELATED[mainPlace] || [];
        if (rel.length) place = r.pick(rel);
      }
      var indoor = placeIndoor(place);
      var spots = SPOTS[place] || { sit: [], stand: [[0, 0]] };

      // 本段出场：主角必有；配角 60% 概率出场
      var inCast = [hero];
      if (support.length && r.chance(.6)) inCast.push(support[0]);

      var actors = inCast.map(function (cid, k) {
        var legal = legalActions(cid, place);
        var action = cid === hero
          ? (k === 0 && plan[i] === 'establish' ? 'stand' : r.pick(legal))
          : r.pick(legal);
        if (cid === 'person' && i === scenes.length - 1) action = r.chance(.5) ? 'wave' : 'stand';
        if (cid === hero && i === 0) action = 'stand';
        return { id: cid, action: action, variant: cid === 'person' ? ['a', 'b', 'c'][fnv(seed + cid) % 3] : 'a' };
      });
      // 至少一个主角在动，别全站桩
      if (actors[0].action === 'stand' && i > 0 && r.chance(.6)) {
        actors[0].action = legalActions(hero, place).filter(function (a) { return a !== 'stand'; })[0] || 'stand';
      }

      // 走位：sit 用场景给的坐位，其余在活动区里挑
      var cast = actors.map(function (ac, k) {
        var sit = ac.action === 'sit' && spots.sit.length;
        var list = sit ? spots.sit : (spots.stand.length ? spots.stand : [[0, 0]]);
        var base = list[(fnv(seed + 'p' + i + ac.id) + k) % list.length];
        var roam = indoor ? 1.1 : 4.2;
        var from = [base[0] + r.range(-.4, .4), 0, base[1] + r.range(-.4, .4)];
        var to = from.slice();
        if (ac.action === 'walk' || ac.action === 'run' || ac.action === 'hop') {
          // ⚠️ 括号不能省：`a + b * c ? x : y` 会先算 (a+b*c) 再三元，结果变成 0/1 而不是坐标
          to = [from[0] + r.range(-roam, roam), 0,
                from[2] + (r.chance(.5) ? 1 : r.range(-roam, roam))];
        } else if (ac.action === 'swim' || ac.action === 'fly') {
          from = [r.range(-4, 4), 0, r.range(-3, 3)];
          to = [from[0] + r.range(-5, 5), 0, from[2] + r.range(-4, 4)];
        }
        // 走廊地点两侧是楼/墙，走位（含飞行入场点）别拐进建筑里
        var bc = CAM_BOX[place];
        if (bc) {
          var limX = bc.x - .6;
          if (from[0] > limX) from[0] = limX; else if (from[0] < -limX) from[0] = -limX;
          if (to[0] > limX) to[0] = limX; else if (to[0] < -limX) to[0] = -limX;
        }
        return {
          id: ac.id, variant: ac.variant, action: ac.action,
          // ⚠️ 站位是 [x, 0, z]，z 必须取 from[2]；写 from[1] 会把所有角色压到 z=0 那条线上
          from: [r3(from[0]), 0, r3(from[2])], to: [r3(to[0]), 0, r3(to[2])],
          // 坐着/站着不动的人也要参与构图，给个注视点高度
          eye: ac.id === 'person' ? 1.45 : (ac.id === 'dog' ? .8 : .4)
        };
      });

      // 镜头对准演员中点
      var mid = [0, 0, 0];
      cast.forEach(function (c) { mid[0] += (c.from[0] + c.to[0]) / 2 / cast.length; mid[2] += (c.from[2] + c.to[2]) / 2 / cast.length; });
      mid[1] = cast[0] ? cast[0].eye : 1.2;
      // 室内镜头别贴着墙，站位往里收
      if (indoor) { mid[0] = r.range(-1.4, 1.4); mid[2] = r.range(-1.2, 1.6); }

      shots.push({
        index: i,
        title: scenes[i].title || '',
        text: scenes[i].text || '',
        place: place,
        indoor: indoor,
        cast: cast,
        shot: shotFor(plan[i] || 'push', r, indoor, mid, place),
        grade: Object.assign({}, GRADE[mood] || GRADE.day, { mood: mood }),
        durationBeats: beats,
        durationSec: r3(beats * spb)
      });
    }

    var total = shots.reduce(function (a, s) { return a + s.durationSec; }, 0);
    return {
      seed: seed,
      title: opts.title || shots[0].title || '未命名',
      bpm: bpm, beats: beats,
      hero: hero, support: support,
      place: mainPlace, mood: mood,
      shots: shots,
      totalSec: r3(total),
      source: 'local'
    };
  }

  /** 概念上"相关"的地点：换地方但不跳到另一个世界 */
  var RELATED = {
    cafe: ['street', 'kitchen', 'park'],
    street: ['nightmarket', 'park', 'cafe'],
    park: ['seaside', 'street', 'street'],
    seaside: ['park', 'seaside'],
    study: ['lab', 'cafe'],
    lab: ['study'],
    kitchen: ['cafe', 'nightmarket'],
    nightmarket: ['street', 'cafe'],
    bedroom: ['balcony', 'study'],
    market: ['street', 'nightmarket'],
    metro: ['street', 'rainstreet'],
    campus: ['park', 'street'],
    rainstreet: ['street', 'nightmarket', 'balcony'],
    balcony: ['bedroom', 'seaside', 'park'],
    // ---- 第二批（world3.js）----
    livingroom: ['bedroom', 'kitchen', 'balcony'],
    office: ['cafe', 'metro', 'street'],
    bakery: ['kitchen', 'market', 'street'],
    hospital: ['street', 'busstop', 'balcony'],
    farmfield: ['park', 'seaside', 'balcony'],
    busstop: ['metro', 'street', 'rainstreet']
  };

  function r3(x) { return Math.round(x * 1000) / 1000; }

  /* ==================== 分镜脚本的校验补全 ==================== */

  /**
   * 把 LLM 返回的分镜并进 storyboard。
   * 规则：模型只允许「改」不该「造」——地点/角色/动作/镜头必须在白名单里，
   *      不合法的直接退回本地推断值；段落数按原文案对齐，多退少补。
   */
  function mergeLLM(sb, raw) {
    if (!raw || !Array.isArray(raw.shots)) return sb;
    var r = mkRng((sb.seed ^ fnv(JSON.stringify(raw))) >>> 0);
    var out = JSON.parse(JSON.stringify(sb));
    var n = Math.min(out.shots.length, raw.shots.length);
    for (var i = 0; i < n; i++) {
      var s = out.shots[i], m = raw.shots[i] || {};
      if (m.place && FS.world.placeById(m.place)) s.place = m.place;
      s.indoor = placeIndoor(s.place);
      if (typeof m.note === 'string' && m.note) s.note = m.note.slice(0, 40);
      // ⚠️ 这里查 SHOT_KIND 而不是 SHOT_TYPES：SHOT_TYPES 是「给模型看的说法」白名单，
      //    SHOT_KIND 才是「导演说法 → 渲染层镜头」的映射。曾经拿 SHOT_TYPES 当门禁，
      //    于是模型给 crane / wide / follow / pan 一律被外层挡掉、原样保留本地镜头，
      //    看起来"没报错"，其实是悄悄没采纳模型的意思。
      var kind = typeof m.shotType === 'string' ? SHOT_KIND[m.shotType.trim().toLowerCase()] : null;
      if (kind && C.EASE) {
        var mid = s.cast.length ? [s.cast[0].from[0], s.cast[0].eye, s.cast[0].from[2]] : [0, 1.2, 0];
        s.shot = shotFor(kind, r, s.indoor, mid);
      }
      if (Array.isArray(m.cast) && m.cast.length) {
        var legal = m.cast.filter(function (c) { return !!FS.cast.castById(c) && (HABITAT[c] || []).indexOf(s.place) >= 0; });
        if (legal.length) {
          s.cast = legal.slice(0, 3).map(function (c) {
            var fixed = reconcile(c, s.place, r);
            var acts = legalActions(fixed.cast, s.place);
            return {
              id: fixed.cast, variant: c === 'person' ? ['a', 'b', 'c'][r.int(3)] : 'a',
              action: acts[r.int(acts.length)],
              from: [0, 0, 0], to: [0, 0, 0], eye: c === 'person' ? 1.45 : .4
            };
          });
          // 走位仍然用本地点的站位知识重算，别信模型给的坐标
          var sp = SPOTS[s.place] || { sit: [], stand: [[0, 0]] };
          s.cast.forEach(function (c) {
            var list = c.action === 'sit' && sp.sit.length ? sp.sit : sp.stand;
            var b = list[r.int(list.length)];
            c.from = [b[0] + r.range(-.4, .4), 0, b[1] + r.range(-.4, .4)];
            c.to = c.action === 'walk' || c.action === 'run' ? [c.from[0] + r.range(-3, 3), 0, c.from[2] + r.range(-3, 3)] : c.from.slice();
          });
        }
      }
      if (m.mood && GRADE[m.mood]) s.grade = Object.assign({}, GRADE[m.mood], { mood: m.mood });
    }
    out.source = 'llm';
    out.llmMerged = n;
    return out;
  }

  var SHOT_TYPES = ['establish', 'push', 'track', 'orbit', 'pullout'];
  /* 模型给的是「导演说法」（establish / push / pullout），渲染层认的是另一套
   * （orbit / dolly_in / pan / follow / push_orbit / crane），靠这张表对齐。
   * ⚠️ 必须铺开映射：否则模型顺着影视语感写 crane（想拉远收尾）会落空，
   *    被 `|| 'push'` 兜底成推近——一段该收尾的镜头变成怼脸，观众看不懂。 */
  var SHOT_KIND = {
    establish: 'establish', wide: 'establish', wideshot: 'establish', longshot: 'establish', 'wide-shot': 'establish',
    push: 'push', pushin: 'push', push_in: 'push', dolly: 'push', dollyin: 'push', dolly_in: 'push',
    in: 'push', close: 'push', closeup: 'push', close_up: 'push', 推近: 'push',
    track: 'track', tracking: 'track', tracking_shot: 'track', follow: 'track', followcam: 'track',
    pan: 'track', panning: 'track', moving: 'track', 横移: 'track',
    orbit: 'orbit', circling: 'orbit', ring: 'orbit', 环绕: 'orbit',
    pullout: 'pullout', pullback: 'pullback', pull_back: 'pullout', pullbackshot: 'pullout',
    crane: 'pullout', craneup: 'pullout', out: 'pullout', 拉远: 'pullout', 收尾: 'pullout'
  };

  /* ==================== LLM 通道 ==================== */

  function llmPrompt(opts, sb) {
    var places = FS.world.PLACES.map(function (p) { return p.id + '(' + p.name + ':' + p.tags.join('/') + ')'; }).join('、');
    var casts = FS.cast.CASTS.map(function (c) {
      // ACTIONS[id] 是数组，Object.keys 会得到 "0,1,2" —— 直接 join 才对
      return c.id + '(' + c.name + ':' + (ACTIONS[c.id] || []).join('/') + ')';
    }).join('、');
    var draft = sb ? ('机器初稿：主地点 ' + sb.place + '，主角 ' + sb.hero +
      (sb.support && sb.support.length ? '，配角 ' + sb.support.join('/') : '') +
      '，氛围 ' + sb.mood + '，每段镜头 ' + (sb.shots || []).map(function (s) {
        return s.shot.type;
      }).join('→') + '。') : '';
    return [
      '你是生活类短片的分镜导演。下面已有文案和一份机器推的初稿，你要做的是**在初稿基础上调整**，让它更有生活气、更连贯。',
      '片名：' + (opts.title || '未命名'),
      '段落文案：',
      scenesText(opts.scenes),
      draft,
      '',
      '可选地点（place id 必须是这些之一）：' + places,
      '可选角色（cast id 必须是这些之一）：' + casts,
      '可选镜头（shotType）：establish(建立全景) / push(推近) / track(横移跟拍) / orbit(环绕) / pullout(拉远收尾)',
      '可选氛围（mood）：day / dusk / night / warm / cold',
      '每段角色能做的动作必须在它的动作表里；鱼、蝴蝶、鸟不能出现在室内。',
      '',
      '硬性要求：',
      '1) 只输出一个 JSON 对象，不要 markdown、不要解释。',
      '2) 格式 {"shots":[{"place":"cafe","shotType":"push","mood":"warm","cast":["person","cat"],"note":"这段想表达什么"}]}',
      '3) shots 数量与文案段落数一致（' + ((opts.scenes || []).length || 4) + ' 段），顺序一一对应。',
      '4) 镜头要有节奏：第 1 段多用 establish，最后一段用 pullout。',
      '5) note 一句话，不超过 20 字。',
      ''
    ].join('\n');
  }

  /* ==================== 一键成片（全自动） ====================
   * 原来要三步：填「主题 + 具象例子」→ 生成文案 → 按文案生成分镜。
   * 联网时这三步都能省——让模型在一个来回里把
   * 「主题 / 具象例子 / 片名 / 每段字幕 / 每段分镜」全吐出来，本地只做白名单校验。
   *
   * 不只是少点两次：模型同时看得见「自己刚写的字幕」和「要画的画面」，
   * 分镜才不会跟字幕拧着（以前是两次请求，第二个请求看不见第一个的产出）。
   */

  /* 中文地名 → place id。
   * ⚠️ 必须存在的理由：world 里登记的 name 是繁体（咖啡館/公園/海邊），
   * 而模型（豆包等）几乎一律回简体，直接丢给白名单会被当成非法值顶掉。 */
  var PLACE_ALIAS = {
    // 模型最爱说日常叫法（便利店/面馆/大排档），都得能落回 id，否则会被白名单顶掉
    cafe: '咖啡馆,咖啡廳,咖啡店,cafe,咖啡,咖啡館,便利店,便利商店,小卖部,小賣部,杂货店,雜貨店,奶茶店,饮品店,甜品店',
    street: '街道,街上,马路,馬路,大街,路上,街,street',
    park: '公园,公園,park,公园里,散步',
    seaside: '海边,海邊,海岸,海灘,沙滩,沙灘,海滨,海濱,seaside',
    study: '书房,書房,书屋,书桌',
    lab: '实验室,實驗室,化验室,試驗室,试验室,lab',
    kitchen: '厨房,廚房,灶台,下厨,kitchen,餐馆,飯館,面馆,麵館,餐厅,餐廳,食堂,早餐店,小吃店,烘焙厨房',
    nightmarket: '夜市,夜市摊,路边摊,攤販,摊贩,nightmarket,大排档,大排檔,烧烤摊,烧烤攤',
    bedroom: '卧室,臥室,睡房,床边,床邊',
    market: '菜市场,菜市場,菜场,菜場,农贸市场,农贸市場,市场,市場,超市,菜市',
    metro: '地铁,地鐵,地铁站,地鐵站,地铁站台,metro',
    campus: '校园,校園,学校,學校,操场,操場,大学',
    rainstreet: '雨中街道,雨中,雨夜街道,雨巷,下雨的街道,rainstreet',
    balcony: '阳台,陽台,天台,露台,balcony',
    livingroom: '客厅,客廳,起居室,沙发上,livingroom',
    office: '办公室,辦公室,办公,公司,工位',
    bakery: '面包房,麵包房,面包店,烘焙店,烘焙坊,bakery',
    hospital: '医院,醫院,病房,病床,医院病房',
    farmfield: '田埂,麦田,麥田,田野,稻田,农田,農田,farmfield',
    busstop: '公交站,公交站台,车站,車站,公交,站牌,公車站,busstop'
  };

  /** 把模型给的地点名（简体/繁体/id/带"的""里""上"）解析成本地 place id；认不出返回 null
   *  ⚠️ 这里删的字符要克制：只删助词（的/里/上/过/和/而）。
   *     曾经把「中」也删了，于是「雨中街道」被削成「雨街道」→ 包含匹配落到 street，
   *     雨夜场景的片子全变普通街道。别再加「中」进这个字符类。 */
  function resolvePlace(x) {
    if (x === null || x === undefined) return null;
    var s = String(x).trim().replace(/[的里上过和而]/g, '').trim();
    if (!s) return null;
    var ids = FS.world.placeIds();
    if (ids.indexOf(s) >= 0) return s;                      // 模型直接给了 id（最理想）
    if (PLACE_ALIAS[s]) return PLACE_ALIAS[s];              // 精确别名
    // 兜底：包含匹配，取最长命中（"雨夜的街道" → 靠"街道"拿到 street，靠"雨中"拿不到就退回 street）
    var best = null, blen = 0;
    FS.world.PLACES.forEach(function (p) {
      var cands = [p.id, p.name].concat((PLACE_ALIAS[p.id] || '').split(','));
      cands.forEach(function (c) {
        if (!c) return;
        c = String(c).trim();
        if (c && s.indexOf(c) >= 0 && c.length > blen) { best = p.id; blen = c.length; }
      });
    });
    return best;
  }

  /** 一键成片的 prompt：连主题带例子带文案带分镜一次要齐 */
  function autoPrompt(o) {
    o = o || {};
    var eng = o.engine === '3d' ? '3D' : '2D';
    var picture = o.engine === '3d'
      ? '画面是 WebGL 实时渲染的低多边形 3D 生活场景（客厅、办公室、面包房、医院病房、田埂麦田、公交站、咖啡馆、公园、街道、菜市场、地铁站、校园、阳台、雨中街道、海边、夜市、厨房、卧室、书房、实验室，人物和动物在里面活动）'
      : '画面是 Canvas2D 手绘的生活插画（厨房、菜市场、雨巷、客厅、田埂、公园、海边、办公室、站台，平涂色块，有角色在动）';
    var n = o.count || 4;
    return [
      '你是一个生活类短片的编剧兼分镜导演，要交出**一整部片子**的全部内容：想主题、写例子、写字幕、出分镜。',
      '用户没给主题——请你自己选一个**普通人的、有烟火气的**主题，不要宏大、不要科普、不要广告腔。',
      '（若用户下面给了主题，就照着他给的写，别另起。）',
      '主题：' + (o.topic || '（无，请自拟）'),
      '（若用户给了具象例子，就把它用进某一句字幕里；没给就你自己写一个。）',
      '具象例子：' + (o.example || '（无，请自拟）'),
      '',
      '这是' + eng + '渲染的片子。' + picture + '，没有真人实拍，也没有旁白，只有字幕和画面。',
      '',
      '硬性要求：',
      '1) 主题要落在**一件具体的小事**上：一碗面、一把伞、一场推迟的告别、陪床的凌晨四点。',
      '   不要"坚持梦想""科技向善"这种空词——观众看不懂画面里它在说啥。',
      '2) 具象例子必须是**看得见的画面细节**：热气糊眼镜、塑料袋被风兜住、护士把枕头摆正。',
      '   不是"很温暖很感动"，是那个具体的动作。',
      '3) 字幕一共 ' + n + ' 段，每段不超过 22 字，要能一口气读完。第 1 段是开场（把人拉进来），',
      '   中间要有细节和一个小转折，最后一段收尾，别喊口号。',
      '4) 分镜的 place 必须只填给定的 id（英文），不要自造地名。',
      '   镜头节奏：第 1 段 establish，中段轮 push / track / orbit，最后一段 pullout。',
      '5) 只输出一个 JSON 对象，不要 markdown 代码块、不要解释、不要多余文字。',
      '',
      '格式：',
      '{"topic":"一句话主题","example":"一个看得见的细节","title":"片名","scenes":[{"title":"小标题","text":"字幕"}],"shots":[{"place":"cafe","shotType":"push","mood":"warm","cast":["person"],"note":"不超过20字"}]}',
      'scenes 和 shots 都是 ' + n + ' 项，一一对应。',
      '可选 place id：' + FS.world.placeIds().join(' / '),
      '可选 cast id：' + FS.cast.CASTS.map(function (c) { return c.id; }).join(' / '),
      '可选 shotType：establish / push / track / orbit / pullout',
      '可选 mood：day / dusk / night / warm / cold'
    ].join('\n');
  }

  /** 一键成片：一次联网拿回全部内容；失败/没 Key 由调用方决定怎么回落 */
  function auto(cfg, o) {
    o = o || {};
    if (!cfg || !cfg.key) return Promise.reject(new Error('没填 API Key'));
    if (!FS.script || !FS.script.callApi) return Promise.reject(new Error('文案通道没就绪'));
    return FS.script.callApi(cfg, autoPrompt(o), function (content) {
      var s = String(content).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      var a = s.indexOf('{'), b = s.lastIndexOf('}');
      if (a < 0 || b <= a) throw new Error('模型没输出 JSON');
      var j = JSON.parse(s.slice(a, b + 1));
      if (!j || !Array.isArray(j.scenes) || !j.scenes.length) throw new Error('JSON 里没有 scenes');
      // 地点名统一翻译成 id（模型多半给中文），翻译不出来的留空，由本地白名单补
      if (Array.isArray(j.shots)) {
        j.shots.forEach(function (sh) { if (sh && typeof sh.place === 'string') sh.place = resolvePlace(sh.place) || sh.place; });
      }
      if (!Array.isArray(j.shots)) j.shots = [];
      return j;
    });
  }

  function scenesText(scenes) {
    return (scenes || []).map(function (s, i) {
      return (i + 1) + '. ' + (s.title || '') + ' —— ' + (s.text || '');
    }).join('\n');
  }

  /** 让模型出分镜（可选）。失败/没 Key 都返回 null，调用方继续用本地结果。 */
  function askLLM(cfg, opts, sb) {
    if (!cfg || !cfg.key) return Promise.resolve(null);
    if (!FS.script || !FS.script.callApi) return Promise.resolve(null);
    return FS.script.callApi(cfg, llmPrompt(opts, sb), function (content) {
      var s = String(content).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      var a = s.indexOf('{'), b = s.lastIndexOf('}');
      if (a < 0 || b <= a) throw new Error('模型没输出 JSON');
      var j = JSON.parse(s.slice(a, b + 1));
      if (!j || !Array.isArray(j.shots)) throw new Error('JSON 里没有 shots 数组');
      return j;
    });
  }

  FS.director = {
    build: build,
    mergeLLM: mergeLLM,
    askLLM: askLLM,
    auto: auto,
    autoPrompt: autoPrompt,
    resolvePlace: resolvePlace,
    PLACE_ALIAS: PLACE_ALIAS,
    readText: readText,
    reconcile: reconcile,
    legalActions: legalActions,
    placeIndoor: placeIndoor,
    mkRng: mkRng,
    fnv: fnv,
    PLACE_WORDS: PLACE_WORDS,
    CAST_WORDS: CAST_WORDS,
    ACTIONS: ACTIONS,
    HABITAT: HABITAT,
    SPOTS: SPOTS,
    SHOT_PLAN: SHOT_PLAN,
    GRADE: GRADE,
    RELATED: RELATED,
    CAM_R: CAM_R,
    CAM_BOX: CAM_BOX,
    CAM_DIST: CAM_DIST
  };
})(typeof window !== 'undefined' ? window : this);
