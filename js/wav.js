/* wav.js —— AudioBuffer -> 16-bit PCM wav（浏览器原生编码，不依赖库） */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});

  function writeStr(buf, off, s) {
    for (var i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i);
    return off + s.length;
  }

  /** AudioBuffer -> ArrayBuffer (RIFF/WAVE) */
  function encodeWav(buffer) {
    var ch = Math.min(buffer.numberOfChannels, 2);
    var sr = buffer.sampleRate;
    var len = buffer.length;
    var bytes = 44 + len * ch * 2;
    var buf = new ArrayBuffer(bytes);
    var v = new DataView(buf);
    var off = 0;

    off = writeStr(v, off, 'RIFF');
    v.setUint32(off, bytes - 8, true); off += 4;
    off = writeStr(v, off, 'WAVE');
    off = writeStr(v, off, 'fmt ');
    v.setUint32(off, 16, true); off += 4;
    v.setUint16(off, 1, true); off += 2;        // PCM
    v.setUint16(off, ch, true); off += 2;
    v.setUint32(off, sr, true); off += 4;
    v.setUint32(off, sr * ch * 2, true); off += 4;
    v.setUint16(off, ch * 2, true); off += 2;
    v.setUint16(off, 16, true); off += 2;
    off = writeStr(v, off, 'data');
    v.setUint32(off, len * ch * 2, true); off += 4;

    var chans = [];
    for (var c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
    for (var i = 0; i < len; i++) {
      for (var k = 0; k < ch; k++) {
        var s = chans[k][i];
        s = s < -1 ? -1 : s > 1 ? 1 : s;            // 限幅，防爆音
        v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return buf;
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'track.wav';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 400);
  }

  FS.encodeWav = encodeWav;
  FS.download = download;
})(window);
