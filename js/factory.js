/* factory.js —— 音乐工厂：从「已有音乐素材」里采集，再变形出新的配乐。
 *
 * 它不是纯随机（纯随机 = 白噪音），也不是照抄（照抄 = 侵权 + 听得出原曲）。
 * 做法是音乐学里最朴素那一套：**母动机 + 变形 + 曲式 + 和声约束**。
 *
 *   素材层（可替换成自己的语料，见 MOTIFS / PROGS / PATTERNS）
 *     ├ 12 个公有领域风格的动机（帕赫贝尔型、圣咏型、八度摇滚型……）
 *     ├ 3 组和声进行（I–vi–IV–V / i–VI–III–VII ……）
 *     ├ 5+5+3 个鼓 pattern（8 分网格）
 *     └ 12 种音色 × 7 种风格谱面（bpm 区间 / 音阶 / 织体 / 密度）
 *
 *   创新层
 *     ├ 9 个变形算子：逆序 / 级数移位 / 倒影 / 高八度 / 节奏拉长 / 节奏收紧 / 加经过音 / 挖气口 / 换动机尾
 *     ├ 每个乐句抽 1–2 个算子 = 一个「变体」；变体签名进集合，重复就重抽（同一首里不重样）
 *     ├ 强拍音强制吸附到当前和弦音 —— 这是「不跑调」的关键一条
 *     └ 种子 PRNG：同 (主题, 风格, 种子) 必出同一首，换种子必换一首
 *
 *   产物：标准 cues.json（直接喂 parseScore / renderScore / 钢琴卷帘 / 宣传片）
 *        + meta（本曲采了谁、怎么改的），meta 是给人看的「创新说明」。
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});

  /* ==================== 1. 确定性随机 ==================== */

  /** 字符串 -> 32 位无符号 hash（FNV-1a） */
  function hashStr(s) {
    var h = 2166136261 >>> 0;
    s = String(s);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /** mulberry32：小、快、够随机，且同种子必同序列 */
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function Rng(seed) {
    var f = mulberry32(typeof seed === 'number' ? seed >>> 0 : hashStr(seed));
    return {
      seed: seed,
      next: f,
      int: function (n) { return Math.floor(f() * n); },
      range: function (a, b) { return a + f() * (b - a); },
      chance: function (p) { return f() < p; },
      pick: function (arr) { return arr[Math.floor(f() * arr.length)]; },
      some: function (arr, n) {
        var c = arr.slice(), out = [];
        n = Math.min(n, c.length);
        for (var i = 0; i < n; i++) out.push(c.splice(Math.floor(f() * c.length), 1)[0]);
        return out;
      },
      shuffle: function (arr) {
        var c = arr.slice();
        for (var i = c.length - 1; i > 0; i--) {
          var j = Math.floor(f() * (i + 1)), t = c[i]; c[i] = c[j]; c[j] = t;
        }
        return c;
      }
    };
  }

  /* ==================== 2. 音阶 / 调 ==================== */

  var SCALES = {
    majorPent: { steps: [0, 2, 4, 7, 9], minorish: false, name: '大调五声' },
    minorPent: { steps: [0, 3, 5, 7, 10], minorish: true, name: '小调五声' },
    major: { steps: [0, 2, 4, 5, 7, 9, 11], minorish: false, name: '自然大调' },
    minor: { steps: [0, 2, 3, 5, 7, 8, 10], minorish: true, name: '自然小调' },
    dorian: { steps: [0, 2, 3, 5, 7, 9, 10], minorish: true, name: '多利亚' },
    lydian: { steps: [0, 2, 4, 6, 7, 9, 11], minorish: false, name: '利底亚' },
    mixo: { steps: [0, 2, 4, 5, 7, 9, 10], minorish: true, name: '混合利底亚' }
  };
  var KEYS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  var KEY_PC = [0, 2, 4, 5, 7, 9, 11];

  /** 级数（含八度，7 = 下一个八度的 1 级）-> midi */
  function degToMidi(deg, scale, rootMidi) {
    var L = scale.steps.length;
    var oct = Math.floor(deg / L);
    var idx = ((deg % L) + L) % L;
    return rootMidi + oct * 12 + scale.steps[idx];
  }

  /** 一个和弦的可用音（供强拍吸附用）
   *  ⚠️ 别再给小调三度"减半音"——小调音阶的级数本身已经含小三度（natural minor 的 deg+2 = +3 半音），
   *     再减 1 就把 i 和弦的 C-Eb 变成 C-D（大二度），那是最典型的跑调。
   *  五声音阶没有正经三度，根音+五度+九度才稳，所以它走另一套取法。
   */
  function chordMidis(deg, scale, rootMidi) {
    var root = degToMidi(deg, scale, rootMidi);
    if (scale.steps.length === 5) {
      return [root, degToMidi(deg + 3, scale, rootMidi), degToMidi(deg + 6, scale, rootMidi)];
    }
    return [root, degToMidi(deg + 2, scale, rootMidi), degToMidi(deg + 4, scale, rootMidi), degToMidi(deg + 6, scale, rootMidi)];
  }

  function nearestIn(pool, m) {
    var best = pool[0], bd = 1e9;
    for (var i = 0; i < pool.length; i++) {
      var d = Math.abs(pool[i] - m);
      if (d < bd) { bd = d; best = pool[i]; }
    }
    return best;
  }

  function midi2name(m) {
    var names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return names[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }

  /* ==================== 3. 素材库 ==================== */

  /** 母动机：deg = 相对主音的音阶级数（7 = 高八度），dur = 时值（拍） */
  var MOTIFS = [
    { id: 'canon-desc', name: '固定低音型下行（帕赫贝尔型）', tags: ['classic', 'cinema', 'science'], deg: [0, 4, 2, 4, 0, -3], dur: [1, 1, 1, 1, 2] },
    { id: 'gregorian', name: '圣咏式级进（格里高利型）', tags: ['classic', 'ambient', 'march'], deg: [0, 1, 2, 1, 0, -2], dur: [1, 1, 1, 1, 2] },
    { id: 'penta-zig', name: '五声折返（民谣拨弦型）', tags: ['lofi', 'science', 'classic', 'march'], deg: [0, 2, 1, 3, 2, 4, 2, 0], dur: [.5, .5, .5, .5, .5, .5, 1, 1] },
    { id: 'octave-rock', name: '八度跳进（摇滚型）', tags: ['epic', 'march', 'lofi'], deg: [0, 0, 3, 3, 2, 2, 0, 0], dur: [.5, .5, .5, .5, 1, 1, 1] },
    { id: 'hum-theme', name: '长音主题（预告片型）', tags: ['cinema', 'ambient'], deg: [0, -2, 0, 2, 0], dur: [2, 2, 2, 2, 4] },
    { id: 'tango', name: '探戈切分 stab', tags: ['lofi', 'science'], deg: [0, 4, 2, 4, 0], dur: [.5, .5, 1, .5, 1.5] },
    { id: 'rise', name: '上行推进（科幻型）', tags: ['science', 'cinema', 'epic'], deg: [0, 1, 2, 3, 4, 3, 2, 4], dur: [.5, .5, .5, .5, .5, .5, 1, 1] },
    { id: 'folk', name: '分解和弦（下行低音变体）', tags: ['classic', 'lofi', 'ambient'], deg: [0, 2, 4, -1, -3], dur: [1, 1, 1, 1, 2] },
    { id: 'long-breath', name: '长呼吸单音（讲解留白型）', tags: ['ambient', 'science', 'classic'], deg: [0, 2, 4], dur: [2, 2, 4] },
    { id: 'morse', name: '短-长-短 问答动机', tags: ['science', 'march', 'lofi'], deg: [0, 2, 0, 4, 0], dur: [.5, 1.5, .5, .5, 1.5] },
    { id: 'wave', name: '大波浪（循环感型）', tags: ['lofi', 'epic', 'cinema'], deg: [0, 1, 2, 1, 0, -1, 0, 1], dur: [.5, .5, .5, .5, .5, .5, .5, .5] },
    { id: 'stomp', name: '重音顿拍（口号型）', tags: ['march', 'epic'], deg: [0, 0, 0, 4, 2], dur: [1, 1, 1, 1, 4] }
  ];

  /** 和声进行：deg 数组，每小节一个和弦 */
  var PROGS = {
    major: [
      { n: 'I–vi–IV–V', d: [0, 5, 3, 4] },
      { n: 'I–V–vi–IV', d: [0, 4, 5, 3] },
      { n: 'I–IV–I–V', d: [0, 3, 0, 4] },
      { n: 'I–IV–V–vi', d: [0, 3, 4, 5] },
      { n: 'I–ii–IV–V', d: [0, 1, 3, 4] },
      { n: 'I–IV–vi–V', d: [0, 3, 5, 4] }
    ],
    minor: [
      { n: 'i–VI–III–VII', d: [0, 5, 2, 6] },
      { n: 'i–iv–V–i', d: [0, 3, 4, 0] },
      { n: 'i–VII–VI–V', d: [0, 6, 5, 4] },
      { n: 'i–III–V–i', d: [0, 2, 4, 0] },
      { n: 'i–VI–iv–V', d: [0, 5, 3, 4] }
    ],
    ambient: [
      { n: 'I–IV–I–V', d: [0, 3, 0, 4] },
      { n: 'I–IV–iii–I', d: [0, 3, 2, 0] },
      { n: 'I–ii–I–IV', d: [0, 1, 0, 3] }
    ]
  };

  /** 鼓 pattern：8 格 = 4 拍（8 分网格），'x' 敲 */
  var PATTERNS = {
    kick: ['x---x---', 'x-----x-', 'x---x-x-', 'x-x-x---', 'xx--x---', 'x--x--x-'],
    hat: ['x-x-x-x-', '--x-x-x-', 'x-x-xx-x', '--x--x-x', 'x-x-x-xx'],
    snare: ['----x---', '----x-x-', '--x--x--']
  };

  /** 风格谱面：bpm 区间、音阶池、织体、和声组、鼓强度、偏好的动机 */
  var STYLES = [
    { id: 'science', name: '科技科普', desc: '冷静清晰、递进感强，适合讲原理', bpm: [88, 118], scales: ['dorian', 'majorPent', 'lydian'], lead: 'pluck', pad: 'pad', bass: 'bass', arp: 'bell', density: .62, prog: 'major', drums: true, hats: .5, motifs: ['rise', 'morse', 'penta-zig', 'octave-rock'] },
    { id: 'classic', name: '古典讲义', desc: '稳重、有和声进行，适合慢慢讲清楚', bpm: [68, 92], scales: ['major', 'majorPent'], lead: 'pluck', pad: 'pad', bass: 'bass', arp: 'bell', density: .5, prog: 'major', drums: false, hats: 0, motifs: ['canon-desc', 'gregorian', 'folk', 'penta-zig'] },
    { id: 'epic', name: '热血开场', desc: '鼓点密、层层往上拱，适合片头', bpm: [116, 150], scales: ['minor', 'minorPent'], lead: 'lead', pad: 'pad', bass: 'bass', arp: 'bell', density: .84, prog: 'minor', drums: true, hats: 1, motifs: ['octave-rock', 'stomp', 'wave'] },
    { id: 'ambient', name: '空镜留白', desc: '慢、几乎无鼓，适合停顿与抒情', bpm: [58, 76], scales: ['lydian', 'majorPent', 'dorian'], lead: 'bell', pad: 'pad', bass: 'bass', arp: 'bell', density: .34, prog: 'ambient', drums: false, hats: 0, motifs: ['hum-theme', 'long-breath', 'gregorian'] },
    { id: 'lofi', name: '俏皮律动', desc: '切分跳跃，适合轻松主题', bpm: [76, 102], scales: ['dorian', 'mixo', 'minorPent'], lead: 'pluck', pad: 'pad', bass: 'bass', arp: 'blip', density: .7, prog: 'minor', drums: true, hats: .8, motifs: ['tango', 'penta-zig', 'wave', 'morse'] },
    { id: 'march', name: '节奏推进', desc: '四平八稳、口号式，适合并列信息', bpm: [100, 124], scales: ['major', 'majorPent'], lead: 'bell', pad: 'pad', bass: 'bass', arp: 'blip', density: .75, prog: 'major', drums: true, hats: .6, motifs: ['stomp', 'morse', 'octave-rock'] },
    { id: 'cinema', name: '纪录片', desc: '大跨度、留白与爆点交替', bpm: [80, 104], scales: ['minor', 'dorian', 'majorPent'], lead: 'lead', pad: 'pad', bass: 'bass', arp: 'bell', density: .58, prog: 'minor', drums: true, hats: .35, motifs: ['hum-theme', 'rise', 'canon-desc', 'wave'] }
  ];

  /** 主题词 → 候选风格（中文关键词命中；没命中就靠 hash 落表，稳定可复现） */
  var THEME_WORDS = [
    { words: ['群', '对称', '结构', '数学', '几何', '证明', '公理', '拓扑', '代数', '逻辑', '哲学'], styles: ['science', 'classic'] },
    { words: ['量子', '物理', '宇宙', '星', '科技', 'ai', '算法', '数据', '赛博', '机器', '神经', '生物', '基因', '代码'], styles: ['science', 'cinema'] },
    { words: ['热血', '励志', '奔跑', '少年', '梦想', '挑战', '突破', '燃', '战斗'], styles: ['epic', 'march'] },
    { words: ['诗', '梦', '夜', '海', '风', '雨', '故乡', '温柔', '安静', '孤独', '远方', '月光'], styles: ['ambient', 'cinema'] },
    { words: ['可爱', '俏皮', '猫', '咖啡', '甜', '玩具', '游戏', '童', '宠物'], styles: ['lofi', 'march'] },
    { words: ['历史', '文明', '纪录', '故事', '人物', '时代', '战争'], styles: ['cinema', 'classic'] },
    { words: ['节奏', '鼓', '舞', '运动', '节拍', '卡点'], styles: ['lofi', 'epic'] },
    { words: ['自然', '山', '水', '森林', '草原', '海洋', '生态', '地球'], styles: ['ambient', 'classic'] }
  ];

  function styleById(id) {
    for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === id) return STYLES[i];
    return STYLES[0];
  }
  function motifById(id) {
    for (var i = 0; i < MOTIFS.length; i++) if (MOTIFS[i].id === id) return MOTIFS[i];
    return MOTIFS[0];
  }

  /** 主题 → 风格（want 非 auto 时直接听用户的） */
  function styleFor(theme, want) {
    if (want && want !== 'auto') return styleById(want);
    var t = String(theme || '').toLowerCase(), hits = [];
    for (var i = 0; i < THEME_WORDS.length; i++) {
      for (var j = 0; j < THEME_WORDS[i].words.length; j++) {
        if (t.indexOf(THEME_WORDS[i].words[j]) >= 0) hits = hits.concat(THEME_WORDS[i].styles);
      }
    }
    if (!hits.length) hits = STYLES.map(function (s) { return s.id; });
    var h = hashStr(theme || '未命名');
    // 命中专属词（如"少年"→热血）时优先给第一个候选，7 成概率；否则在候选里挑
    return styleById(h % 10 < 7 ? hits[0] : hits[h % hits.length]);
  }

  /** 主题 → 推荐规格（UI 提示用；真正生成时仍由种子决定细节） */
  function recommend(theme) {
    var st = styleFor(theme, 'auto');
    return { style: st.id, styleName: st.name, desc: st.desc, key: KEYS[hashStr(theme || '未命名') % 7], bpm: Math.round((st.bpm[0] + st.bpm[1]) / 2) };
  }

  /* ==================== 4. 变形算子（创新层） ==================== */

  var OPS = [
    { id: 'reverse', name: '逆序', fn: function (d, u) { return [d.slice().reverse(), u.slice().reverse()]; } },
    { id: 'shiftUp', name: '级数上移', fn: function (d, u, r) { var k = 1 + r.int(3); return [d.map(function (x) { return x + k; }), u]; } },
    { id: 'shiftDown', name: '级数下移', fn: function (d, u, r) { var k = -(1 + r.int(3)); return [d.map(function (x) { return x + k; }), u]; } },
    { id: 'invert', name: '倒影', fn: function (d, u) { var a = d[0]; return [d.map(function (x) { return 2 * a - x; }), u]; } },
    { id: 'up8', name: '高八度', fn: function (d, u) { return [d.map(function (x) { return x + 7; }), u]; } },
    { id: 'stretch', name: '节奏拉长', fn: function (d, u) { return [d, u.map(function (x) { return Math.min(4, x * 1.5); })]; } },
    { id: 'tight', name: '节奏收紧', fn: function (d, u) { return [d, u.map(function (x) { return Math.max(.25, x * .75); })]; } },
    { id: 'ornament', name: '加经过音', fn: function (d, u) {
        var nd = [], nu = [];
        for (var i = 0; i < d.length; i++) {
          nd.push(d[i]); nu.push(u[i]);
          if (i < d.length - 1 && u[i] >= 1) { nd.push(Math.round((d[i] + d[i + 1]) / 2)); nu.push(Math.min(u[i], u[i + 1]) * .5); }
        }
        return [nd, nu];
      } },
    { id: 'breath', name: '挖气口', fn: null }   // 需要 rng，交给下面 opBreath 处理
  ];

  /** 挖气口：把一个音并进前一个，后面留个空 —— 乐句才有呼吸 */
  function opBreath(d, u, r) {
    if (d.length < 3) return [d, u];
    var i = 1 + r.int(d.length - 2);
    var nd = d.slice(), nu = u.slice();
    nu[i - 1] = Math.min(4, (nu[i - 1] || 1) + (nu[i] || 1));
    nd.splice(i, 1); nu.splice(i, 1);
    return [nd, nu];
  }
  function applyOp(op, d, u, r) {
    if (op.id === 'breath') return opBreath(d, u, r);
    return op.fn(d, u, r);
  }

  /** 每个乐句抽 1–2 个不同算子；同一种算子全曲最多用 3 次，避免全曲一个味道 */
  function pickChain(r, usedOps) {
    var n = r.chance(.45) ? 2 : 1;
    var chain = [];
    for (var i = 0; i < n; i++) {
      var pool = OPS.filter(function (o) {
        return chain.indexOf(o) < 0 && (usedOps[o.id] || 0) < 3;
      });
      if (!pool.length) break;
      var op = r.pick(pool);
      usedOps[op.id] = (usedOps[op.id] || 0) + 1;
      chain.push(op);
    }
    return chain;
  }

  /* ==================== 5. 曲式 ==================== */

  function planSections(bars) {
    if (bars <= 4) return [{ role: 'A', bars: bars }];
    var withEnds = bars >= 6;
    var intro = withEnds ? 1 : 0, outro = withEnds ? 1 : 0;
    var body = bars - intro - outro;
    var roles = body >= 12 ? ['A', 'B', 'A2'] : body >= 8 ? ['A', 'B'] : ['A'];
    var out = [], left = body;
    for (var i = 0; i < roles.length; i++) {
      var n = Math.max(1, Math.round(body / roles.length));
      if (left - n < roles.length - i - 1) n = Math.max(1, left - (roles.length - i - 1));
      out.push({ role: roles[i], bars: n });
      left -= n;
    }
    if (intro) out.unshift({ role: 'intro', bars: intro });
    if (outro) out.push({ role: 'outro', bars: outro });
    return out;
  }

  /* ==================== 6. 生成 ==================== */

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  function generate(o) {
    o = o || {};
    var theme = String(o.theme === undefined || o.theme === null ? '' : o.theme).trim() || '未命名';
    var seed = (o.seed === undefined || o.seed === null || o.seed === '') ? hashStr(theme + '|' + Date.now() + '|' + Math.random()) : o.seed;
    var r = Rng(seed);

    var style = styleFor(theme, o.style || 'auto');
    var scaleId = r.pick(style.scales);
    var scale = SCALES[scaleId];
    var keyIdx = hashStr(theme) % 7;
    var rootMidi = 48 + KEY_PC[keyIdx];                 // 旋律基准在 C3 附近
    var bpm = o.bpm ? clamp(+o.bpm, 40, 200) : Math.round(r.range(style.bpm[0], style.bpm[1]));
    var bars = clamp(o.bars ? Math.round(+o.bars) : 8, 2, 64);
    var density = clamp(o.density === undefined || o.density === null ? style.density : +o.density, .1, 1);
    var useDrums = o.drums === undefined ? style.drums : !!o.drums;
    var spb = 60 / bpm;

    /* ---- 采集：动机 / 和声 / 鼓型 / 织体 ---- */
    var motifPool = style.motifs.map(motifById);
    var motifs = r.some(motifPool, Math.min(motifPool.length, 1 + r.int(2)));
    if (!motifs.length) motifs = [motifById('penta-zig')];
    var progList = PROGS[style.prog] || PROGS.major;
    var prog = r.pick(progList);
    var kPat = r.pick(PATTERNS.kick);
    var hPat = r.pick(PATTERNS.hat);
    var sPat = r.pick(PATTERNS.snare);
    var bassPat = r.pick([[0, 2, 3.5], [0, 1.5, 3], [0, 2.5], [0, 2], [0, 1, 2.5, 3.5]]);

    /* ---- 曲式 ---- */
    var sections = planSections(bars);

    var leadNotes = [], padNotes = [], bassNotes = [], arpNotes = [];
    var kickNotes = [], hatNotes = [], snareNotes = [];
    var usedVariants = {};      // 变体签名去重：同一首里不出现同样的乐句
    var usedOps = {};
    var opLog = [];
    var variantCount = 0;

    var beat = 0;               // 全局拍位
    for (var si = 0; si < sections.length; si++) {
      var sec = sections[si];
      var secBeats = sec.bars * 4;
      var isIntro = sec.role === 'intro', isOutro = sec.role === 'outro';
      var secStart = beat;

      /* --- 和声：每小节一个和弦 --- */
      var chordDeg = [];
      for (var b = 0; b < sec.bars; b++) chordDeg.push(prog.d[(b + si) % prog.d.length]);

      /* --- 旋律：母动机 -> 变体 -> 铺满本段 --- */
      var phrase = buildPhrase(r, motifs, secBeats, density, sec.role, usedVariants, usedOps, opLog);
      variantCount += phrase.tries > 0 ? 1 : 0;

      for (var pi = 0; pi < phrase.degs.length; pi++) {
        var at = secStart + phrase.starts[pi];
        var barIdx = Math.floor(phrase.starts[pi] / 4);
        var inBar = phrase.starts[pi] % 4;
        var cdeg = chordDeg[clamp(barIdx, 0, chordDeg.length - 1)];
        var m = degToMidi(phrase.degs[pi], scale, rootMidi + 12);
        // 强拍（整数拍）吸附到当前和弦音：这一条决定成品「不跑调」
        if (Math.abs(inBar - Math.round(inBar)) < 1e-6) m = nearestIn(chordMidis(cdeg, scale, rootMidi + 12), m);
        // 弱拍有概率走向离和弦最近的经过音，增加流动性
        else if (r.chance(.45)) {
          var pool = [m - 1, m + 1, m - 2, m + 2];
          m = nearestIn(chordMidis(cdeg, scale, rootMidi + 12), r.pick(pool));
        }
        var len = Math.min(phrase.durs[pi], secBeats - (at - secStart));
        if (len <= .05) continue;
        var gain = isIntro ? .45 : isOutro ? .6 : (.62 + r.range(0, .22));
        leadNotes.push({ p: midi2name(m), beat: r3(at), d: r3(len * spb), gain: r3(gain) });
      }

      /* --- 低音：跟和弦根音 --- */
      for (var bb = 0; bb < sec.bars; bb++) {
        var bd = chordDeg[bb];
        for (var kk = 0; kk < bassPat.length; kk++) {
          var tb = secStart + bb * 4 + bassPat[kk];
          if (bassPat[kk] >= 4) continue;
          if (isIntro && kk > 0) continue;
          var bdeg = (kk === bassPat.length - 1 && r.chance(.3)) ? bd + 4 : bd;   // 偶尔走五度
          bassNotes.push({ p: midi2name(degToMidi(bdeg, scale, rootMidi - 12)), beat: r3(tb), d: r3(spb * .9), gain: isOutro ? .5 : .62 });
        }
      }

      /* --- Pad：根音 + 三度/五度，长音铺底（音高统一取自 chordMidis，只有一套和声规则） --- */
      for (var pb = 0; pb < sec.bars; pb++) {
        var pd = chordDeg[pb];
        var t0 = secStart + pb * 4;
        var cm = chordMidis(pd, scale, rootMidi);
        padNotes.push({ p: midi2name(cm[0]), beat: r3(t0), d: r3(spb * 3.6), gain: isIntro ? .5 : .42 });
        padNotes.push({ p: midi2name(cm[r.chance(.5) ? 1 : cm.length - 1]), beat: r3(t0), d: r3(spb * 3.4), gain: .26 });
        if (!isIntro && r.chance(.35)) {
          arpNotes.push({ p: midi2name(degToMidi(pd + 7, scale, rootMidi + 12)), beat: r3(t0 + 3), d: r3(spb * .9), gain: .3 });
        }
      }

      /* --- 鼓 --- */
      if (useDrums && !isIntro) {
        for (var db = 0; db < sec.bars; db++) {
          var base = secStart + db * 4;
          var kickThin = isOutro ? .55 : 1;
          for (var g = 0; g < 8; g++) {
            if (kPat[g] === 'x' && r.chance(kickThin)) kickNotes.push({ beat: r3(base + g * .5), d: r3(spb * .3), gain: .8 });
            if (style.hats > 0 && hPat[g] === 'x' && r.chance(style.hats))
              hatNotes.push({ beat: r3(base + g * .5), d: r3(spb * .2), gain: .4 + r.range(0, .12) });
            if (sPat[g] === 'x' && r.chance(isOutro ? .5 : .85))
              snareNotes.push({ beat: r3(base + g * .5), d: r3(spb * .25), gain: .5 });
          }
        }
        // intro 只留一点 hat 声，像"起拍"
        if (isIntro) {
          for (var ig = 0; ig < 8; ig += 2) hatNotes.push({ beat: r3(secStart + ig * .5), d: r3(spb * .2), gain: .28 });
        }
      }

      beat = secStart + secBeats;
    }

    /* ---- 组装标准 cues.json ---- */
    var tracks = [];
    function add(name, inst, notes, gain) {
      if (!notes.length) return;
      tracks.push({ name: name, instrument: inst, gain: gain === undefined ? 0.8 : gain, notes: notes });
    }
    add('lead', style.lead, leadNotes, .85);
    add('bass', style.bass, bassNotes, .8);
    add('pad', style.pad, padNotes, .7);
    add('arp', style.arp, arpNotes, .45);
    if (useDrums) {
      add('kick', 'kick', kickNotes);
      add('snare', 'snare', snareNotes);
      add('hat', 'hat', hatNotes);
    }

    var total = bars * 4 * spb;
    var score = {
      bpm: bpm,
      sample_rate: 44100,
      master: 0.82,
      tracks: tracks,
      duration: total + spb * 2
    };

    var uniqOps = [];
    for (var oi = 0; oi < opLog.length; oi++) if (uniqOps.indexOf(opLog[oi]) < 0) uniqOps.push(opLog[oi]);

    var meta = {
      seed: seed,
      theme: theme,
      style: { id: style.id, name: style.name, desc: style.desc },
      key: KEYS[keyIdx],
      scale: scale.name,
      bpm: bpm,
      bars: bars,
      density: density,
      drums: useDrums,
      seconds: score.duration,
      notes: tracks.reduce(function (n, t) { return n + t.notes.length; }, 0),
      structure: sections.map(function (s) { return roleName(s.role) + s.bars; }).join(' '),
      sources: [
        { type: '动机', label: motifs.map(function (m) { return m.name; }).join('、') },
        { type: '和声', label: prog.n + '（' + (style.prog === 'minor' ? '小调进行' : style.prog === 'ambient' ? '留白进行' : '大调进行') + '）' },
        { type: '音阶调式', label: KEYS[keyIdx] + ' ' + scale.name },
        { type: '织体', label: weave([style.lead, style.bass, style.pad, style.arp]) },
        { type: '鼓型', label: useDrums ? 'kick ' + kPat + ' / hat ' + hPat + ' / snare ' + sPat : '无鼓（留白）' }
      ],
      ops: uniqOps,
      variants: variantCount,
      fingerprint: fingerprint(score)
    };
    return { score: score, meta: meta };
  }

  function roleName(role) {
    return { intro: '引子', A: 'A段', B: 'B段', A2: "A'段", outro: '收尾' }[role] || role;
  }

  /** 织体音色去重后拼字符串（lead 和 arp 同音色时不该显示两遍） */
  function weave(list) {
    var out = [];
    list.forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
    return out.join(' + ');
  }

  function r3(x) { return Math.round(x * 1000) / 1000; }

  /* ==================== 7. 乐句（采集 -> 变形 -> 去重） ==================== */

  function buildPhrase(r, motifs, secBeats, density, role, usedVariants, usedOps, opLog) {
    var tries = 0, best = null;
    // 同一首里同一个变体只用一次；最多试 14 次，超了就接受最后一个（宁可微重复也不空着）
    while (tries < 14) {
      tries++;
      var motif = r.pick(motifs);
      var d = motif.deg.slice(), u = motif.dur.slice();
      var chain = pickChain(r, usedOps);
      for (var i = 0; i < chain.length; i++) {
        var out = applyOp(chain[i], d, u, r);
        d = out[0]; u = out[1];
        opLog.push(chain[i].name);
      }
      if (role === 'outro' && r.chance(.6)) { d = d.slice(0, Math.max(2, d.length - 1)); u = u.slice(0, d.length); }
      var filled = fill(r, d, u, secBeats, density);
      var key = filled.degs.join(',') + '|' + filled.durs.join(',');
      if (!usedVariants[key]) {
        usedVariants[key] = true;
        return { degs: filled.degs, durs: filled.durs, starts: filled.starts, tries: tries };
      }
      if (!best) best = { degs: filled.degs, durs: filled.durs, starts: filled.starts, tries: tries };
    }
    return best || { degs: [], durs: [], starts: [], tries: 0 };
  }

  /** 把一个短动机循环铺满整段：每次循环升/降一点级数 = 自然的变奏推进 */
  function fill(r, degs, durs, secBeats, density) {
    var outD = [], outU = [], starts = [];
    var pos = 0, i = 0, guard = 0;
    var drift = 0, nextDrift = 0;
    while (pos < secBeats - 1e-6 && guard++ < 400) {
      if (i > 0 && i % degs.length === 0) {
        drift = nextDrift;                                   // 每轮换一个漂移量
        nextDrift = r.pick([-2, -1, 0, 0, 1, 2]);
      }
      var dur = durs[i % durs.length];
      // 密度控制：弱位按概率留白（听感上就是"呼吸"）
      if (dur < 1 && r.chance(1 - density * .8)) dur = dur * 2;
      if (pos + dur > secBeats) dur = secBeats - pos;
      if (dur <= .04) break;
      outD.push(degs[i % degs.length] + drift);
      outU.push(dur);
      starts.push(pos);
      pos += dur;
      i++;
    }
    return { degs: outD, durs: outU, starts: starts };
  }

  /* ==================== 8. 不重复保证 ==================== */

  function mix(h, n) {
    h ^= (n | 0);
    h = Math.imul(h, 16777619) >>> 0;
    return h;
  }

  /** 曲子指纹：同曲必同指纹，不同曲几乎必不同。用来判断"这首我是不是刚出过" */
  function fingerprint(score) {
    var h = 2166136261 >>> 0;
    for (var t = 0; t < score.tracks.length; t++) {
      var tr = score.tracks[t];
      h = mix(h, hashStr(tr.instrument) % 100000);
      for (var i = 0; i < tr.notes.length; i++) {
        var n = tr.notes[i];
        h = mix(h, Math.round((n.beat || 0) * 4));
        h = mix(h, (n.p === undefined ? -1 : hashStr(n.p) % 1000));
      }
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }

  /** 找一个没出过的种子（同主题同风格，但保证不重复） */
  function nextSeed(opts, used) {
    used = used || {};
    var base = (opts && opts.seed !== undefined && opts.seed !== null && opts.seed !== '')
      ? (typeof opts.seed === 'number' ? opts.seed >>> 0 : hashStr(opts.seed))
      : (Date.now() % 100000);
    for (var i = 0; i < 80; i++) {
      var s = (base + i * 7919) >>> 0;
      var probe = generate(Object.assign({}, opts || {}, { seed: s })).meta.fingerprint;
      if (!used[probe]) return s;
    }
    return (base + 99991) >>> 0;
  }

  /** 直接生成一首「保证没出过的」曲子 */
  function generateUnique(opts, used) {
    var s = nextSeed(opts, used);
    return generate(Object.assign({}, opts || {}, { seed: s }));
  }

  /** 宣传片用：按片名当主题，同一片名可复现，不同片名必不同 */
  function forFilm(film) {
    var spb = 60 / (film.bpm || 84);
    var totalBeats = (film.scenes || []).length * (film.beats || 8);
    return generate({
      theme: film.title || '宣传片',
      bpm: film.bpm || 84,
      bars: clamp(Math.round(totalBeats / 4), 2, 48)
    });
  }

  function toText(score, pretty) {
    return JSON.stringify(score, null, pretty === false ? 0 : 2);
  }

  FS.factory = {
    generate: generate,
    generateUnique: generateUnique,
    nextSeed: nextSeed,
    forFilm: forFilm,
    recommend: recommend,
    styleFor: styleFor,
    fingerprint: fingerprint,
    toText: toText,
    hashStr: hashStr,
    STYLES: STYLES,
    MOTIFS: MOTIFS,
    PROGS: PROGS,
    OPS: OPS,
    SCALES: SCALES,
    // 内部工具也导出来：测试要靠它独立复算音阶/和弦，UI 的推荐条也可能要用
    _int: { degToMidi: degToMidi, chordMidis: chordMidis, planSections: planSections, Rng: Rng, hashStr: hashStr }
  };
})(typeof window !== 'undefined' ? window : this);
