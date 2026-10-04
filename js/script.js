/* script.js —— 文案助手：本地模板生成 + 可选 LLM 通道
 *
 * 两种玩法，都不依赖后端：
 *   local()  零 key 零网络。按「主题 + 风格 + 段数」用句式库拼出片名和每段字幕，
 *            种子取自主题本身（同一主题每次生成都一样，方便你反复微调）。
 *   llm()    OpenAI 兼容的 /chat/completions，DeepSeek / OpenAI / 硅基流动 / 自建都行。
 *            想让浏览器直连报 CORS 时，拿 workers/proxy.js 挂一个 CF Worker 当自动代理。
 *            凭据只存本机 localStorage，不发到本站任何服务器。
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});

  var MOODS = ['科普', '热血', '俏皮', '诗性'];
  var MOOD_KEY = { '科普': 'sci', '热血': 'hot', '俏皮': 'fun', '诗性': 'poem' };

  /* ---------------- 确定性随机 ---------------- */
  function fnv(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; } return h; }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }

  /* ---------------- 句式库 ----------------
   * 槽位只有两个：{t} 主题、{e} 具象例子（没填 {e} 的模板用 noE 组，免得句子悬空）
   * 刻意不塞「想象一匹马」这种会语义崩掉的填充物。 */
  var LINES = {
    sci: {
      hook: [
        '{t}从哪来？别急着下定义，先看一眼它长什么样。',
        '{t}听起来抽象，其实它每天都在你眼皮底下发生。',
        '关于{t}，最常听错的那一句，是「它离我们很远」。'
      ],
      mech: [
        '{t}的关键不在「是什么」，而在「怎么做」——先动手，再命名。',
        '把它拆到最小，只剩几条规矩在那儿撑着。',
        '{t}真正的力气，是给了「操作」一个合法的位置。'
      ],
      example: [
        '{e}：做一次不算什么，做两次，它自己回来了。',
        '{e}这个例子里，{t}的条件一条都没浪费。',
        '拿{e}试一下，你会看见同一个结构换了张脸。'
      ],
      exampleNoE: [
        '拿一个最普通的动作试一遍，做两次，它自己回来了。',
        '这个例子里，{t}的条件一条都没浪费。',
        '随便挑一个动作试一下，你会看见同一个结构换了张脸。'
      ],
      rise: [
        '于是{t}不再是一门课，而是一套描述结构的语言。',
        '看懂{t}以后，那一类问题会自己让路。',
        '结构一旦清楚，剩下的就只是命名。'
      ]
    },
    hot: {
      hook: [
        '{t}，被低估太久的一种东西。',
        '别急着否定{t}，先看看它能扛多重。',
        '就是一种秩序，{t}把它推到了极限。'
      ],
      mech: [
        '{t}的狠劲儿在重复：一次不说明什么，一万次就成了规律。',
        '把规则收紧到只剩一条，{t}才开始真正发力。',
        '{t}不解释，它直接给出可以被检验的动作。'
      ],
      example: [
        '{e}——转过去，回不来；再转一次，它还在原地。',
        '看{e}：同样的手法，结果每次都一样硬。',
        '{e}这个瞬间，{t}把所有退路都堵死了。'
      ],
      exampleNoE: [
        '转过去，回不来；再转一次，它还在原地。',
        '同样的手法，结果每次都一样硬。',
        '这一瞬间，{t}把所有退路都堵死了。'
      ],
      rise: [
        '这就是{t}：把秩序写进规则里的那股劲。',
        '{t}不浪漫，但它可靠——可靠本身就是天赋。',
        '理解它之后，你会开始在所有东西里认出它。'
      ]
    },
    fun: {
      hook: [
        '关于{t}，先说个冷知识。',
        '{t}没你想的那么端着，它挺接地气。',
        '先别背定义，我们聊点好玩的。'
      ],
      mech: [
        '别被名词吓跑，其实就三步：动手、记下来、再动一次。',
        '{t}的全部套路，就是「换个数接着算」。',
        '搞清楚{t}只需要记住一句话，剩下的自己会补。'
      ],
      example: [
        '{e}：转一圈，发现没变？那不是 bug，是特性。',
        '{e}这类东西，才是{t}最可爱的部分。',
        '{e}——你看，它自己就把规则演示了一遍。'
      ],
      exampleNoE: [
        '转一圈，发现没变？那不是 bug，是特性。',
        '这类不起眼的东西，才是{t}最可爱的部分。',
        '它自己就把规则演示了一遍，不用你解释。'
      ],
      rise: [
        '所以{t}不是高岭之花，是帮你偷懒的小抄。',
        '学会{t}之后，你会发现别人说话都在绕弯。',
        '记住这个：结构对了，剩下的都好说。'
      ]
    },
    poem: {
    hook: [
      '有些{t}，得先看见它的形状。',
      '{t}不是答案，是一段留下来的过程。',
      '在开始之前，{t}已经在那儿了。'
    ],
    mech: [
      '它不动声色，把散落的东西排成了队。',
      '{t}把「变」和「不变」放在了一起，谁也不吵。',
      '所有的动作都被收进同一个圈里，安静地转。'
    ],
    example: [
      '{e}：你转过去的时候，它同时也转过来了。',
      '{e}这一下，{t}就站在了最清楚的地方。',
      '看{e}，它把自己重复了一遍，也不觉得累。'
    ],
    exampleNoE: [
      '你转过去的时候，它也同时转过来了。',
      '这一下，{t}就站在了最清楚的地方。',
      '它把自己重复了一遍，也不觉得累。'
    ],
    rise: [
      '这样想，{t}就有了温度。',
      '看懂它之后，世界会多一层不明显的秩序。',
      '留下来的不是结论，是看的方式。'
    ]
  },
};

  // 4 段结构：钩子 / 机制 / 例子 / 升华
  var SHAPES = {
    3: ['hook', 'mech', 'rise'],
    4: ['hook', 'mech', 'example', 'rise'],
    5: ['hook', 'mech', 'example', 'mech', 'rise']
  };

  var TITLES = [
    '{t}：结构之美', '{t}，从一次动手开始', '看见{t}的那一眼',
    '{t}并不遥远', '把{t}拆开看看', '{t}的秩序', '关于{t}的三个追问'
  ];

  function fill(s, t, e) { return s.replace(/\{t\}/g, t).replace(/\{e\}/g, e || '它'); }

  /** 本地生成文案。opts: {topic, example, mood, count} */
  function local(opts) {
    opts = opts || {};
    var t = (opts.topic || '').trim() || '这件事';
    var e = (opts.example || '').trim();
    var mood = MOOD_KEY[opts.mood] || 'sci';
    var count = parseInt(opts.count, 10) === 5 ? 5 : parseInt(opts.count, 10) === 3 ? 3 : 4;
    var lines = LINES[mood] || LINES.sci;
    // 种子只吃「主题+风格+段数」，同一个主题每次点生成都长得一样，改一个字才换一批
    var r = rng(fnv(t) ^ (mood.length * 7919) ^ (count * 104729));

    var shape = SHAPES[count] || SHAPES[4];
    var scenes = [];
    for (var i = 0; i < count; i++) {
      var slot = shape[i] || 'rise';
      var pool;
      if (slot === 'example') pool = e ? lines.example : lines.exampleNoE;
      else pool = lines[slot] || lines.mech;
      scenes.push({ title: '', text: fill(pick(r, pool), t, e) });
    }

    // 小标题：从字幕里抽一个短片段（不动原文，避免语义被截断）
    scenes.forEach(function (sc, i) {
      var txt = sc.text.replace(/[，。：？！\s]/g, '');
      sc.title = (txt.length > 8 ? txt.slice(0, 8) : txt) || ('第' + (i + 1) + '步');
    });

    return {
      title: fill(pick(r, TITLES), t, e),
      scenes: scenes,
      advice: advice(scenes, opts.bpm)
    };
  }

  /** 按字数给「每段拍数」和「每秒字数」提建议 */
  function advice(scenes, bpm) {
    var b = bpm || 84;
    var lens = scenes.map(function (s) { return (s.text || '').length; });
    var maxLen = Math.max.apply(null, lens.concat([1]));
    var needSec = maxLen / 5.2;                       // 中文口播/看字幕约 5 字每秒留白
    var beats = Math.max(4, Math.round(needSec * b / 60 / 2) * 2);
    return { beats: beats, spb: +(60 / b).toFixed(3), longest: maxLen, ok: maxLen <= 30 };
  }

  /* ---------------- LLM 通道 ---------------- */
  var PRESETS = [
    { id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    { id: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { id: 'silicon', name: '硅基流动', base: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
    { id: 'moonshot', name: 'Moonshot', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
    { id: 'custom', name: '自定义', base: '', model: '' }
  ];

  function PROMPT(o) {
    var mood = o.mood || '科普';
    var shape = o.count === 3 ? '钩子 → 机制 → 升华' : o.count === 5 ? '钩子 → 概念 → 推演 → 例子 → 升华' : '钩子 → 机制 → 例子 → 升华';
    return [
      '你是给科普短片写字幕的编剧，画面是几何/公式/数据的抽象动画，没有旁白，只有字幕。',
      '主题：' + (o.topic || '（未给）'),
      o.example ? '可以先用的具象例子：' + o.example + '（不强制，能自然用上最好）' : '',
      '风格：' + mood + '（克制准确 / 有劲儿 / 口语俏皮 / 留白诗意，任选其一）',
      '要写 ' + (o.count || 4) + ' 段，顺序按这个结构走：' + shape + '。',
      '',
      '硬性要求：',
      '1) 只输出一个 JSON 对象，不要 markdown、不要解释、不要多余文字。',
      '2) 格式 {"title":"片名，不超过14字","scenes":[{"title":"小标题，不超过10字","text":"字幕，不超过28字"}]}',
      '3) 每段字幕口语化，一句说清一件事；不堆术语、不打官腔、不写「首先其次最后」。',
      '4) 字幕长了观众来不及看，宁可短。',
      ''
    ].filter(Boolean).join('\n');
  }

  /** 容错解析模型输出：抠掉 ```json 围栏、affe 前缀后缀、直接找第一个 { 到最后一个 } */
  function parse(text) {
    if (typeof text !== 'string') throw new Error('模型返回的不是文本');
    var s = text.trim();
    s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('模型没输出 JSON（前 80 字：' + s.slice(0, 80) + '）');
    s = s.slice(a, b + 1);
    var obj = JSON.parse(s);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('JSON 顶层不是对象');
    if (!Array.isArray(obj.scenes) || !obj.scenes.length) throw new Error('JSON 里 scenes 不像个数组');
    obj.scenes = obj.scenes.map(function (x) {
      return { title: String((x && x.title) || '').slice(0, 24), text: String((x && x.text) || '').slice(0, 60) };
    }).filter(function (x) { return x.title || x.text; });
    if (!obj.scenes.length) throw new Error('scenes 里没有有效段落');
    obj.title = String(obj.title || '未命名').slice(0, 30);
    return obj;
  }

  /** 从一次 /chat/completions 响应里取出 content（网关有的会包一层文本） */
  function extractContent(txt) {
    var j = null;
    try { j = JSON.parse(txt); } catch (err) { /* 有些网关会包一层文本，往下再试 */ }
    if (!j && txt) {
      var m = /\{[\s\S]*\}/.exec(txt);
      if (m) { try { j = JSON.parse(m[0]); } catch (err) {} }
    }
    if (!j) throw new Error('上游返回了非 JSON：' + String(txt).slice(0, 120));
    var content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!content) throw new Error('上游没返回 choices[0].message.content');
    return content;
  }

  /** 通用 LLM 通道：自带 base 补全、90s 超时、401/404/CORS 的人话报错。
   *  导演层（分镜脚本）也走这个，所以 CORS 那套提示只需要维护一份。 */
  function callApi(cfg, promptStr, parseFn) {
    if (!cfg || !cfg.key) return Promise['reject'](new Error('先填 API Key'));
    var base = (cfg.base || '').replace(/\/+$/, '');
    if (!base) base = 'https://api.deepseek.com/v1';
    if (!/\/v\d+$/.test(base)) base += '/v1';       // 容错：没写版本段自动补
    var ctrl = (root.AbortController ? new root.AbortController() : null);
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 90000);

    return fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
      body: JSON.stringify({
        model: cfg.model || 'deepseek-chat',
        temperature: 0.9,
        messages: [{ role: 'user', content: promptStr }]
      }),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.text().then(function (txt) {
        if (res.status === 401 || res.status === 403) throw new Error('Key 被拒（' + res.status + '）—— 检查 Key 和 base 地址');
        if (res.status === 404) throw new Error('404 —— base 地址不像 OpenAI 兼容端点，应该是 https://xxx/v1 这种');
        var j = null;
        try { j = JSON.parse(txt); } catch (err) { /* 下面 extractContent 再兜一次 */ }
        if (j && j.error) throw new Error((j.error.message || j.error.code || '上游报错'));
        return parseFn(extractContent(txt));
      });
    })['catch'](function (err) {
      var msg = err && err.message ? err.message : String(err);
      if (/Failed to fetch|NetworkError|CORS|Load failed|aborted/i.test(msg))
        throw new Error('直连被浏览器拦了（CORS）或超时。两个办法：① 换支持跨域的服务；② 用仓库里的 workers/proxy.js 挂个 Cloudflare Worker 当自动代理。');
      throw err;
    })['finally'](function () { clearTimeout(timer); });
  }

  /** 拉一次 LLM 生成文案。opts: {base, key, model, topic, example, mood, count} */
  function llm(opts) {
    return callApi(opts, PROMPT(opts), function (content) {
      var out = parse(content);
      out.advice = advice(out.scenes, opts.bpm);
      return out;
    });
  }

  /* ---------------- 本地凭据（只存本机） ---------------- */
  var CFG_KEY = 'fs.script.cfg';
  function loadCfg() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(CFG_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveCfg(c) {
    try { if (root.localStorage) root.localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) {}
    return c;
  }

  /* ---------------- 统一入口 ---------------- */
  /** mode: 'local' | 'llm'。回调返回文案对象或抛错 */
  function generate(mode, opts, onProgress) {
    if (mode === 'llm') {
      if (onProgress) onProgress('正在生成…');
      return llm(opts);
    }
    if (onProgress) onProgress('本地生成中…');
    var out = local(opts);
    if (onProgress) onProgress('搞定');
    return Promise.resolve(out);
  }

  FS.script = {
    local: local, llm: llm, generate: generate, parse: parse, PROMPT: PROMPT,
    callApi: callApi, extractContent: extractContent,
    advice: advice, PRESETS: PRESETS, MOODS: MOODS,
    loadCfg: loadCfg, saveCfg: saveCfg,
    // 给测试用
    _rng: rng, _fnv: fnv
  };
})(window);
