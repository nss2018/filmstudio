<?php
// 文字转语音代理：前端配音用。GET tts.php?text=...&voice=zh-CN-YunxiNeural
// 输出 audio/mpeg；失败给 4xx/5xx，不静默兜底。
header('Access-Control-Allow-Origin: *');
header('X-Content-Type-Options: nosniff');

$text  = isset($_GET['text'])  ? trim($_GET['text'])  : '';
$voice = isset($_GET['voice']) ? $_GET['voice'] : 'zh-CN-YunxiNeural';

if ($text === '' || mb_strlen($text, 'UTF-8') > 90) {
    http_response_code(400); header('Content-Type: text/plain; charset=utf-8');
    exit('bad text (1..90 chars)');
}
if (!preg_match('/^zh-CN-(YunxiNeural|XiaoxiaoNeural|YunyangNeural)$/', $voice)) {
    http_response_code(400); header('Content-Type: text/plain; charset=utf-8');
    exit('bad voice');
}

/* ⚠️ 2026-10-05 修 500：原来用 `--write-media -`（二进制走 stdout）+ passthru。
 *   在服务器上逐个标点实测（edge-tts 7.2.8，rc 都是 0，只有 stdout 字节数不同）：
 *     普通文本 13248 / 带。句号 15120 / 带？问号 15552   →  正常
 *     带：冒号 0 / 带，逗号 0 / 带！叹号 0               →  吐不出音频 → 前端 500
 *   把 stderr 放开才看清真相：`edge_tts.exceptions.NoAudioReceived: No audio was received`
 *   —— 上游对某些标点直接不合成。**换行救不了「！」**（实测换行后仍 500）。
 *   修法四件套：
 *     ① `--write-media <文件>` 落盘再读，绕开 stdout 模式；
 *     ② 句读标点（：，；、）→ 换行（那是自然停顿，要保留）；
 *     ③ 上游不吃的感叹/问号 → **直接删**，删完句末补「。」把语调补圆；
 *     ④ 失败时把 stderr 带回前端，别再只甩一个光秃秃的 500。 */
$ttsText = $text;
// ① 句读标点 → 换行（停顿）
$ttsText = str_replace(
    array('：', '：', '，', '，', '；', '；', '、', '、'),
    "\n",
    $ttsText
);
// ② 上游会拒的：直接删（不能换行，实测换行后仍 NoAudioReceived）
$ttsText = str_replace(
    array('！', '!', '？', '?'),
    '',
    $ttsText
);
// ③ 杂项：引号括号这类 TTS 也不念，去掉更干净
$ttsText = str_replace(
    array('"', "'", '“', '”', '‘', '’', '「', '」', '『', '』',
          '（', '）', '(', ')', '【', '】', '[', ']', '…', '—', '~', '`', '#', '*'),
    '',
    $ttsText
);
$ttsText = trim(preg_replace('/[ \t]+/u', ' ', $ttsText));

$lines = array_values(array_filter(
    array_map('trim', preg_split('/\R/u', $ttsText)),
    function ($s) { return $s !== ''; }
));
if (!$lines) $lines = array('今天天气不错。');   // 全是标点的极端情况
foreach ($lines as $i => $ln) {
    if (!preg_match('/[。！？!?…]$/u', $ln)) $lines[$i] = $ln . '。';   // 补句末语调
}

$tmp = tempnam(sys_get_temp_dir(), 'tts');
$mp3 = '';
$err = '';
/* ★ 重试是必须的：实测 edge-tts 的 `NoAudioReceived` 是**间歇性**的——
 *   同一条「调国旗颜色挑角度就是差这一步」几分钟前 200（22032 字节）、
 *   之后 500（NoAudioReceived，文件 0 字节）。它连的是微软的公开 TTS 端点，
 *   偶发被拒/被限流，跟文本内容无关。所以任何一次失败都要重试，不能一发就放弃。 */
$TRIES = 4;
foreach ($lines as $i => $ln) {
    $part = $tmp . '.' . $i . '.mp3';
    $okmp3 = false;
    for ($try = 1; $try <= $TRIES; $try++) {
        @unlink($part);
        $cmd = '/usr/bin/python3.8 -m edge_tts --voice ' . escapeshellarg($voice)
             . ' --text ' . escapeshellarg($ln) . ' --write-media ' . escapeshellarg($part) . ' 2>&1';
        $out = array();
        $rc  = 0;
        exec($cmd, $out, $rc);
        if ($rc === 0 && is_file($part) && filesize($part) > 64) { $okmp3 = true; break; }
        $err = trim(implode(' ', array_slice($out, -2)));
        usleep(350000 * $try);          // 0.35s / 0.7s / 1.05s 退避
    }
    if (!$okmp3) {
        @unlink($part);
        http_response_code(500);
        header('Content-Type: text/plain; charset=utf-8');
        exit('tts failed after ' . $TRIES . ' tries' . ($err !== '' ? ': ' . $err : ''));
    }
    $mp3 .= file_get_contents($part);
    @unlink($part);
}
@unlink($tmp);

if ($mp3 === '') {
    http_response_code(500); header('Content-Type: text/plain; charset=utf-8');
    exit('tts produced nothing');
}
header('Content-Type: audio/mpeg');
header('Cache-Control: public, max-age=604800');
echo $mp3;
