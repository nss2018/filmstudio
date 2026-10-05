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
  /* 本站自带的 PHP 中转（ai.php）。火山方舟**明令禁止浏览器直连**——它连
   * Access-Control-Allow-Origin 都不返回（实测 /api/v3/models 是 401 且无该头），
   * 所以纯静态页直连必被 CORS 拦死，模型名填对了也没用。
   * 这个预设让 Base 指向本站 ai.php，由服务器转发，Key 仍只存在浏览器本地。 */
  var LOCAL_PROXY = 'ai.php';
  var PRESETS = [
    { id: 'local-ark', name: '火山方舟 豆包（走本站代理 · 推荐）', base: LOCAL_PROXY,
      model: '', via: 'ark.cn-beijing.volces.com' },
    { id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    { id: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { id: 'silicon', name: '硅基流动', base: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
    { id: 'moonshot', name: 'Moonshot', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
    // 火山方舟直连（留给「已经挂了 Cloudflare Worker」的场合）
    { id: 'ark', name: '火山方舟 豆包（直连 · 仅当已配代理时）', base: 'https://ark.cn-beijing.volces.com/api/v3',
      model: '' },
    { id: 'custom', name: '自定义', base: '', model: '' }
  ];

  /** Base 是不是指向本站 ai.php？是的话要改走 {host, path, payload} 那套协议。 */
  function isProxyBase(base) {
    return /\b(?:^|\/)ai\.php$/.test(String(base || '').trim());
  }
  /** 本地代理基准地址（页面可能部署在子目录，用脚本自身的 src 反推，绝不会错） */
  function proxyUrl() {
    var s = (document.currentScript && document.currentScript.src) ||
      (root.document && root.document.currentScript && root.document.currentScript.src) || '';
    if (s) { var m = s.replace(/[^/]*$/, ''); if (m) return m + LOCAL_PROXY; }
    return LOCAL_PROXY;
  }
  function proxyOrigin(via) {
    return String(via || 'ark.cn-beijing.volces.com')
      .replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }

  function PROMPT(o) {
    var mood = o.mood || '科普';
    // ⚠️ 画面描述必须跟实际渲染引擎对上。原来写死「科普 + 几何/公式/数据的抽象动画」，
    //    结果 3D 生活场景下模型以为自己在写科普片，字幕虚得跟画面没关系（「世界会多一层秩序」那种）。
    var pic = (o.engine === '2d')
      ? '画面是 Canvas2D 手绘的生活插画（厨房、菜市场、雨巷、客厅、田埂这类日常场景，平涂色块，有角色在动）'
      : '画面是 WebGL 渲染的低多边形 3D 生活场景（客厅、办公室、面包房、医院病房、田埂麦田、公交站、咖啡馆、公园、街道这类真实生活场所，人物和动物在里面活动）';
    // 生活短片用日常结构，别让模型套科普的「钩子→机制→例子→升华」
    var shape = o.count === 3 ? '开场 → 细节 → 收尾'
      : o.count === 5 ? '开场 → 日常 → 细节 → 小转折 → 收尾'
      : '开场 → 细节 → 小转折 → 收尾';
    return [
      '你是给生活类短片写字幕的编剧。',
      pic + '，没有旁白，只有字幕。',
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

  /* ---------------- 把上游的拒绝翻成人话 ----------------
   * 原来 401 只丢一句「检查 Key 和 base 地址」，等于让人盲猜。
   * 方舟这类网关其实会回 code + message（AuthenticationError / does not have permission …），
   * 不把它挖出来，用户根本分不清「Key 填错」和「模型没开通」——这俩的修法完全不一样。
   * 做成纯函数（ deniesTip / upstreamMsg ）方便直接断言。 */

  /** 按状态码给一句人话定性 */
  function denyWord(status) {
    if (status === 401) return '鉴权被拒（Key 没通过）';
    if (status === 403) return '没权限';
    if (status === 404) return '路径不存在';
    if (status === 429) return '被限流';
    if (status >= 500) return '上游报错';
    return '请求被拒';
  }

  /** 针对「谁被拒了」给具体的下一步。纯函数。 */
  function denyTip(status, base, model, txt) {
    var low = String(txt || '').toLowerCase();
    if (/InvalidAccountStatus|account status|实名|欠费|arrear|out of credit|balance/i.test(low))
      return '你的账号状态有问题（没实名 / 欠费 / 被停用），先去 console.volcengine.com 处理再调。';
    if (status === 401 || status === 403) {
      if (/volces|ark\.cn/i.test(base || '')) {
        // 方舟的两大坑：① 拿 IAM 的 AK/SK 当 API Key；② 模型没开通
        var p = ['方舟要的是「API Key 管理」里创建的 Key（sk- 开头）——不是控制台「密钥管理」里的 AccessKey/SecretKey（AKLT 开头），后者要 HMAC 签名，Bearer 不认它'];
        var m = String(model || '').trim();
        if (!m) p.push('模型框还是空的，它会拿默认值去撞墙——点「拉这个 Key 已开通的模型」，从下拉里挑一个');
        else if (/^ep-/.test(m)) p.push(/invalid|not valid|unauthorized|authentication|expired/i.test(low)
          ? '上游说的是 Key 本身不对：去「API Key 管理」确认这串 Key 还在（被删 / 过期 / 复制时缺头尾都会这样）'
          : 'Key 本身看着没问题，但这个 ep- 接入点没授权给这个 Key（或者被停用/删了），去方舟控制台「推理接入点」看一眼');
        else p.push('这次传的模型是「' + m + '」，方舟是按账号授权模型的，这个模型你的 Key 没开通——点「拉这个 Key 已开通的模型」，从下拉里挑一个（有 ep- 开头的接入点优先选它）');
        return p.join('；') + '。';
      }
      return 'Key 不对 / 过期 / 被删了，或者 base 地址给错了。';
    }
    if (status === 404) {
      // 404 有两层含义，别一律甩锅给 base：
      //   ① base / 路径不对（少了 /v1、/api/v3 这类版本段，或端点压根不存在）；
      //   ② 端点是对的，但模型在方舟这边不存在 / 这个 Key 没被授权用它
      //      —— 方舟对这种情况同样回 404（code=NotFound / ModelNotFound），很容易被误判成①。
      var isArk = /volces|ark\.cn/i.test(base || '');
      var mdl = String(model || '').trim();
      var modelHit = /model|not\s*found|notfound|does not exist|不存在|未开通|未授权|no permission/i.test(txt || '');
      if (isArk) {
        var t = ['方舟回 404：端点是 ' + (base || '')];
        t.push('模型「' + (mdl || '（空）') + '」在方舟上不存在，或这个 Key 没被授权用它——点「拉这个 Key 已开通的模型」，从下拉里挑一个（有 ep- 推理接入点优先选它）');
        if (!mdl) t.push('模型框是空的，它会拿默认值去撞墙');
        return t.join('；') + '。';
      }
      if (modelHit) return '端点能通，但模型名不对：' + (mdl || '（空）') + ' 这家查不到，换个有效的模型名。';
      return 'base 不像 OpenAI 兼容端点，应该是 https://xxx/v1 这种（方舟是 https://ark.cn-beijing.volces.com/api/v3）。';
    }
    if (status === 429) return '被限流了：等一会儿再点，或者换个便宜点的模型。';
    if (status >= 500) return '上游自己炸了，稍后再试；还不行就把上面这段原话原样发我。';
    return '';
  }

  /** 状态码 + 上游响应体 → 一整句能照着做的报错。纯函数，测试直接调。 */
  function upstreamMsg(status, txt, base, model, path) {
    var s = String(txt == null ? '' : txt).replace(/\s+/g, ' ').trim();
    var code = '', msg = '';
    try {
      var j = JSON.parse(s);
      if (j && j.error) { code = String(j.error.code || ''); msg = String(j.error.message || j.error.msg || ''); }
    } catch (e) { /* 不是 JSON 就往下捞字符串 */ }
    if (!msg) { var m = /"message"\s*:\s*"([^"]{4,200})"/.exec(s); if (m) msg = m[1]; }
    var bits = ['✗ ' + status + ' ' + (code ? code : denyWord(status))];
    if (msg) bits.push('上游原话：' + msg + (code && code.indexOf(msg) < 0 ? '（' + code + '）' : ''));
    else if (s) bits.push('上游返回：' + s.slice(0, 140));
    var tip = denyTip(status, base, model, msg || code || s);
    if (tip) bits.push(tip);
    var p = path || '/chat/completions';
    bits.push('这次实际发出去的是 ' + (base ? base : '<没填 base>') + p + (model ? '（model=' + model + '）' : ''));
    return bits.join(' —— ');
  }

  /** 通用 LLM 通道：自带 base 补全、90s 超时、401/404/CORS 的人话报错。
   *  导演层（分镜脚本）也走这个，所以 CORS 那套提示只需要维护一份。 */
  function callApi(cfg, promptStr, parseFn) {
    if (!cfg || !(String(cfg.key || '').trim())) return Promise['reject'](new Error('先填 API Key'));
    var key = String(cfg.key).trim();            // 手机粘贴常带空格/换行，别让它们变成分离出去的废字符
    var rawBase = String(cfg.base || '').replace(/\/+$/, '').trim();
    // ★ Base 指向本站 ai.php → 走代理协议（服务器转发，绕开浏览器 CORS）
    if (isProxyBase(rawBase)) {
      var ctrl0 = (root.AbortController ? new root.AbortController() : null);
      var timer0 = setTimeout(function () { if (ctrl0) ctrl0.abort(); }, 90000);
      return fetch(proxyUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: proxyOrigin(cfg.via || 'ark.cn-beijing.volces.com'),
          path: '/chat/completions',
          key: key,
          payload: {
            model: cfg.model || 'doubao-seed-1-6-251015',
            temperature: 0.9,
            messages: [{ role: 'user', content: promptStr }]
          }
        }),
        signal: ctrl0 ? ctrl0.signal : undefined
      }).then(function (res) {
        return res.text().then(function (txt) {
          clearTimeout(timer0);
          var upBase = 'https://' + proxyOrigin(cfg.via) + '/api/v3';
          if (res.status >= 400) throw new Error(upstreamMsg(res.status, txt, upBase, cfg.model));
          var j = null;
          try { j = JSON.parse(txt); } catch (err) { /* 下面 extractContent 再兜一次 */ }
          if (j && j.error) throw new Error((j.error.message || j.error.code || '上游报错'));
          return parseFn(extractContent(txt));
        });
      })['catch'](function (err) {
        clearTimeout(timer0);
        var m = err && err.message ? err.message : String(err);
        if (/Failed to fetch|NetworkError|Load failed|aborted/i.test(m))
          throw new Error('连不上本站的 ai.php 代理——它跟站点一起部署在 /filmstudio/ai.php，' +
            '先确认这个文件在（浏览器直接打开 https://' + (root.location ? root.location.host : '') + '/filmstudio/ai.php?models=1 看看返不返 JSON）');
        throw err;
      });
    }
    var base = rawBase;
    if (!base) base = 'https://api.deepseek.com/v1';
    if (!/\/v\d+$/.test(base)) base += '/v1';       // 容错：没写版本段自动补
    var ctrl = (root.AbortController ? new root.AbortController() : null);
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 90000);

    return fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: cfg.model || (/volces|ark\.cn/i.test(base) ? 'doubao-seed-1-6-251015' : 'deepseek-chat'),
        temperature: 0.9,
        messages: [{ role: 'user', content: promptStr }]
      }),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.text().then(function (txt) {
        if (res.status === 401 || res.status === 403) throw new Error(upstreamMsg(res.status, txt, base, cfg.model));
        if (res.status === 404) throw new Error(upstreamMsg(res.status, txt, base, cfg.model));
        if (res.status >= 400) throw new Error(upstreamMsg(res.status, txt, base, cfg.model));
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

  /* ---------------- 模型清单：这个 Key 到底能调哪些模型 ----------------
   * 各家 OpenAI 兼容端点都有 GET /models，方舟是 /api/v3/models。
   * 目的很实在：别让用户去控制台一个个抄模型名，填完 Key 直接列出来给他选。
   */

  /** 模型名 → 人话备注（下拉里显示这个，填进请求的是 option 的 value） */
  var MODEL_TAGS = [
    [/^ep-/, '自建接入点（控制台建的应用）'],
    [/seed-?2[.\-_]?0/, '豆包 Seed 2.0 · 最新旗舰（推理/长文）'],
    [/seed-?1[.\-_]?6|seed-?1[.\-_]?5/, '豆包 Seed 1.6/1.5 · 视觉理解'],
    [/doubao-?lite|doubao-lite/i, '豆包 Lite · 便宜快'],
    [/doubao-?pro|doubao-pro/i, '豆包 Pro · 均衡'],
    [/doubao/i, '豆包'],
    [/deepseek-?r1|deepseek-reasoner/i, 'DeepSeek R1 · 推理'],
    [/deepseek/i, 'DeepSeek'],
    [/kimi|moonshot/i, 'Kimi'],
    [/glm-/i, 'GLM · 智谱'],
    [/qwen/i, '通义千问 Qwen'],
    [/gpt-?4o/i, 'GPT-4o'],
    [/gpt-?4/i, 'GPT-4'],
    [/^o[13]/i, 'o 系列推理'],
    [/claude/i, 'Claude'],
    [/gemini/i, 'Gemini'],
    [/ernie|wenxin/i, '文心一言']
  ];
  function modelLabel(id) {
    for (var i = 0; i < MODEL_TAGS.length; i++) if (MODEL_TAGS[i][0].test(id)) return MODEL_TAGS[i][1];
    return id;
  }

  /** 补全 base 到「带版本段」的形式（跟 callApi 一个规矩） */
  function normalizeBase(base) {
    var b = String(base || '').replace(/\/+$/, '');
    if (!b) return '';
    if (!/\/v\d+$/.test(b)) b += '/v1';
    return b;
  }

  /** 把 /models 的响应体解析成 [{id,label}]。抽成纯函数好测。 */
  function parseModelList(txt) {
    var j = null;
    try { j = JSON.parse(txt); } catch (e) { /* 再兜一次 */ }
    if (!j && txt) {
      var m = /\{[\s\S]*\}/.exec(String(txt));
      if (m) { try { j = JSON.parse(m[0]); } catch (e2) {} }
    }
    if (j && j.error) throw new Error(j.error.message || j.error.code || '上游报错');
    if (!j) throw new Error('上游返回了非 JSON：' + String(txt).slice(0, 120));
    var arr = Array.isArray(j) ? j
      : Array.isArray(j.data) ? j.data
      : Array.isArray(j.models) ? j.models : null;
    if (!arr) throw new Error('模型清单格式不认识（没找到 data 数组）');
    var out = [], seen = {};
    arr.forEach(function (x) {
      var id = typeof x === 'string' ? x
        : (x && typeof x === 'object') ? (x.id || x.name || x.model || x.model_id) : '';
      if (typeof id !== 'string') return;
      id = id.trim();
      if (!id || seen[id]) return;
      seen[id] = 1;
      out.push({ id: id, label: modelLabel(id) });
    });
    if (!out.length) throw new Error('模型清单是空的——这个 Key 好像没开通任何模型');
    return out;
  }

  /** 拉模型清单。返回 Promise<[{id,label}]>；401/404/CORS 都给人话。 */
  function listModels(cfg) {
    if (!cfg || !(String(cfg.key || '').trim())) return Promise['reject'](new Error('先填 API Key'));
    var key = String(cfg.key).trim();
    var rawBase = String(cfg.base || '').replace(/\/+$/, '').trim();
    var ctrl = (root.AbortController ? new root.AbortController() : null);
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 30000);
    function fin() { clearTimeout(timer); }
    // ★ 代理模式：列模型也走服务器（这是拿到「你这个 Key 到底能调什么」的唯一可靠办法）
    if (isProxyBase(rawBase)) {
      var upB = 'https://' + proxyOrigin(cfg.via) + '/api/v3';
      return fetch(proxyUrl() + '?models=1&host=' + encodeURIComponent(proxyOrigin(cfg.via)) +
        '&key=' + encodeURIComponent(key), { signal: ctrl ? ctrl.signal : undefined })
        .then(function (res) {
          return res.text().then(function (txt) {
            if (res.status >= 400) throw new Error(upstreamMsg(res.status, txt, upB, '', '/models'));
            return parseModelList(txt);
          });
        })['catch'](function (err) {
          var m = err && err.message ? err.message : String(err);
          if (/Failed to fetch|NetworkError|Load failed|aborted/i.test(m))
            throw new Error('连不上本站的 ai.php 代理，确认 /filmstudio/ai.php 这个文件在服务器上');
          throw err;
        })['finally'](fin);
    }
    var base = normalizeBase(rawBase);
    if (!base) return Promise['reject'](new Error('Base 地址还是空的'));
    return fetch(base + '/models', {
      headers: { 'Authorization': 'Bearer ' + key },
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
        if (res.status >= 400) throw new Error(upstreamMsg(res.status, '', base, '', '/models'));
      return res.text().then(parseModelList);
    })['catch'](function (err) {
      var msg = err && err.message ? err.message : String(err);
      if (/Failed to fetch|NetworkError|CORS|Load failed|aborted/i.test(msg))
        throw new Error('直连被浏览器拦了（CORS）或超时——这个服务不给跨域列模型。' +
          '最简单的解法：把服务商选成「火山方舟 豆包（走本站代理 · 推荐）」，Base 会变成 ai.php，由服务器转发。');
      throw err;
    })['finally'](fin);
  }

  /* 清单只存本机，7 天一过重新拉（模型上线很勤，别让缓存骗人） */
  var MODEL_CACHE_KEY = 'fs.script.models';
  var MODEL_TTL = 7 * 864e5;
  function readModelCache(base) {
    try {
      var LS = root.localStorage; if (!LS || !base) return null;
      var all = JSON.parse(LS.getItem(MODEL_CACHE_KEY) || '{}') || {};
      var hit = all[normalizeBase(base)];
      if (!hit || !hit.ts || Date.now() - hit.ts > MODEL_TTL || !Array.isArray(hit.list)) return null;
      return hit.list;
    } catch (e) { return null; }
  }
  function writeModelCache(base, list) {
    try {
      var LS = root.localStorage; if (!LS || !base) return;
      var all = {};
      try { all = JSON.parse(LS.getItem(MODEL_CACHE_KEY) || '{}') || {}; } catch (e) {}
      all[normalizeBase(base)] = { ts: Date.now(), list: list };
      LS.setItem(MODEL_CACHE_KEY, JSON.stringify(all));
    } catch (e) { /* 隐私模式写不进去就算了 */ }
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
    upstreamMsg: upstreamMsg, denyTip: denyTip, denyWord: denyWord,
    listModels: listModels, parseModelList: parseModelList,
    readModelCache: readModelCache, writeModelCache: writeModelCache,
    normalizeBase: normalizeBase,
    advice: advice, PRESETS: PRESETS, MOODS: MOODS,
    isProxyBase: isProxyBase, proxyUrl: proxyUrl, proxyOrigin: proxyOrigin, LOCAL_PROXY: LOCAL_PROXY,
    loadCfg: loadCfg, saveCfg: saveCfg,
    // 给测试用
    _rng: rng, _fnv: fnv
  };
})(window);
