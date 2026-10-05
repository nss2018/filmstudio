/* scene2d/pick.js —— 2D 生活场景的「按文案自动选景」
 *
 * 与 3D 导演层共用同一份地点词典（FS.director.PLACE_WORDS），不重复维护：
 *   1) 先用词典按「词越长越具体」加权命中（和 3D 完全一样的判断）
 *   2) 命中的 place id 若有对应的 2D 场景就直接用
 *   3) 2D 独有的场景（雨巷）做别名映射
 *   4) 全都没命中 → 按 seed 落表（稳定可复现）
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});

  /** 2D 场景名 → 3D place id（用于共用词典）
   *  同名的一并登记（livingroom/office/...），这样 pickScene 顺延时
   *  会先走 TO_2D 反查到真实 2D 场景，而不是被 FALLBACK 抢走。 */
  var TO_3D = {
    rainy: 'rainstreet',         // 2D 叫雨巷，3D 叫雨中街道
    livingroom: 'livingroom', office: 'office', bakery: 'bakery',
    hospital: 'hospital', farmfield: 'farmfield', busstop: 'busstop'
  };
  /** 3D 有、2D 没有的地点 → 语义最接近的 2D 场景（顺延时用）
   *  kitchen(厨房)     2D 没画，退到 cafe（室内暖色生活，同一类）
   *  lab(实验室)       2D 没画，退到 study（安静室内，有台灯）
   *  livingroom(客厅)  屋里暖光 + 沙发，cafe 最像
   *  bakery(面包房)    食物 + 暖光，还是 cafe
   *  office(办公室)    都市室内，study 有书桌台灯
   *  hospital(病房)    安静室内冷光，study
   *  farmfield(田埂)   户外自然，park
   *  busstop(公交站)   城市户外街景，street
   *  ⚠️ 只有「3D 有、2D 也真画不出来」的地点才该进这张表（kitchen / lab）。
   *     world3.js 那 6 个生活场景 2D 已补画（scenes3.js），必须登记进 TO_3D
   *     而不是留在这里 —— FALLBACK 优先级低于 TO_2D，留着反而不会生效。
   */
  var FALLBACK = {
    kitchen: 'cafe', lab: 'study'
  };

  /** 3D place id → 2D 场景名 */
  var TO_2D = {};
  Object.keys(TO_3D).forEach(function (k) { TO_2D[TO_3D[k]] = k; });

  function pickScene(text, seed) {
    var R = FS.s2dScenes;
    if (!R) return 'cafe';
    var has = {};
    Object.keys(R).forEach(function (k) { if (typeof R[k] === 'function') has[k] = true; });

    // ① 2D 独有/更具体的别名优先。
    //    「下雨撑伞走在街头」里 3D 词典会命中 street（'街'），但 2D 有更贴的 rainstreet（雨巷），
    //    所以先查 2D 别名表再查共享词典。
    var t0 = String(text || '').toLowerCase();
    var ALIAS = [
      ['rainy', ['下雨', '雨天', '雨夜', '雨巷', '撑伞', '伞', '潮湿', '湿漉', '阴天']],
      ['metro', ['地铁', '站台', '车厢', '候车', '闸机', '通勤']],
      ['market', ['菜市场', '菜场', '买菜', '菜筐', '果摊', '讨价', '还价']],
      ['balcony', ['阳台', '天台', '晾衣', '晒太阳', '楼下']],
      ['campus', ['校园', '学校', '操场', '教室', '上课', '同学']],
      ['bedroom', ['卧室', '被窝', '睡觉', '起床', '躺在床上']],
      ['nightmarket', ['夜市', '摊位', '灯笼', '小吃', '夜市']],
      ['seaside', ['海边', '沙滩', '海浪', '大海', '礁石', '椰子']],
      ['park', ['公园', '草地', '长椅', '林荫', '草坪']],
      ['study', ['书房', '书架', '阅读', '学习', '看书']],
      ['cafe', ['咖啡', '拿铁', '吧台', '烘焙']],
      ['street', ['街道', '马路', '大楼', '霓虹', '都市']],
      // ---- 第二批生活场景（scenes3.js 已补画 2D 版）----
      ['livingroom', ['客厅', '沙发', '电视', '地毯', '家里', '回家', '居家', '落地灯']],
      ['office', ['办公室', '办公', '工位', '加班', '上班', '写字楼', '会议室', '打卡']],
      ['bakery', ['面包', '烤箱', '蛋糕', '早点', '早餐', '麦香', '面包房', '出炉']],
      ['hospital', ['医院', '病房', '病床', '输液', '吊瓶', '生病', '陪护', '挂号']],
      ['farmfield', ['麦田', '田埂', '田野', '稻田', '稻草人', '谷仓', '丰收', '麦浪']],
      ['busstop', ['公交站', '公交车', '公交', '等车', '站牌', '巴士', '末班车', '车站']]
    ];
    for (var a = 0; a < ALIAS.length; a++) {
      for (var b = 0; b < ALIAS[a][1].length; b++) {
        if (t0.indexOf(ALIAS[a][1][b]) >= 0 && has[ALIAS[a][0]]) return ALIAS[a][0];
      }
    }

    // ② 复用 3D 导演层的加权词典（与 3D 完全一致的判断）
    if (FS.director && FS.director.readText && FS.director.PLACE_WORDS) {
      var read = FS.director.readText([text || '']);
      if (read.place && read.place.length) {
        // ⚠️ 要「顺延」而不是只取最高权重那批：2D 只有 12 个场景，3D 有 14 个地点，
        //    文案命中 kitchen(3D 有) / lab(3D 有) 时 2D 画不出来，得退到下一个画得出的场景。
        for (var i = 0; i < read.place.length; i++) {
          var id2d = TO_2D[read.place[i].id] || FALLBACK[read.place[i].id] || read.place[i].id;
          if (has[id2d]) return id2d;
        }
      }
    }

    // ③ 兜底别名（第一轮没命中时用短词再试一次）
    // ③ 落表：稳定可复现
    var ids = Object.keys(R).filter(function (k) { return has[k]; });
    return ids[(FS.director ? FS.director.fnv(text || 'x') : ids.length) % ids.length];
  }

  /** 为整部片子选场景：每段一个（可手动覆盖）
   *  ⚠️ 以前是「每段各自 pickScene」，seed 只差 1，所以文案没命中地点词时
   *     整部片子会反复落在同 1~2 个场景上（实测 5 段 → cafe→balcony→metro→cafe→balcony，
   *     两个场景各出现两次，剪出来像卡带）。
   *     现在：① 命中词典的段照旧尊重文案；② 落表兜底的段改为「在没用过的场景里轮转」，
   *     实在用完了（场景数 < 段数）才允许复用。 */
  function pickScenes(scenes, seed) {
    var used = {};
    var ids = FS.s2dScenes
      ? Object.keys(FS.s2dScenes).filter(function (k) { return typeof FS.s2dScenes[k] === 'function'; })
      : [];
    return (scenes || []).map(function (sc, i) {
      var txt = (sc.title || '') + ' ' + (sc.text || '');
      var id = pickScene(txt, (seed || 0) + i);
      // 这个场景本段是「文案明确要求」的吗？重了就换一个，而不是硬重复
      if (used[id] && ids.length > Object.keys(used).length) {
        var free = ids.filter(function (k) { return !used[k]; });
        // 优先在候选里选语义最接近的（用 pickScene 再挑一次，排除已用）
        var alt = free.filter(function (k) { return pickScene(txt, (seed || 0) + i + k.length) === k; });
        id = (alt[0] || free[(i) % free.length]);
      }
      used[id] = (used[id] || 0) + 1;
      return id;
    });
  }

  FS.s2dPick = { pickScene: pickScene, pickScenes: pickScenes, TO_3D: TO_3D, TO_2D: TO_2D };
})(typeof window !== 'undefined' ? window : this);
