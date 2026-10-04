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

// python3.8 + edge_tts 装在系统目录，apache 用户可直接跑；-o - 输出到 stdout
$cmd = '/usr/bin/python3.8 -m edge_tts --voice ' . escapeshellarg($voice)
     . ' --text ' . escapeshellarg($text) . ' --write-media - 2>/dev/null';

header('Content-Type: audio/mpeg');
header('Cache-Control: public, max-age=604800');
passthru($cmd, $rc);
if ($rc !== 0) { http_response_code(500); exit('tts failed'); }
