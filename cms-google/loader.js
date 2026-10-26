// A small loader keeps the fixed editor code separate from HTML preprocessing.
(function () {
  try {
    window.PLIE_CMS_BOOT.stage('편집 화면 코드 복원 · v3');
    var chunks = /*CMS_EDITOR_BASE64*/;
    var binary = atob(chunks.join(''));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    var source = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    var script = document.createElement('script');
    script.textContent = source;
    document.body.appendChild(script);
  } catch (error) {
    window.PLIE_CMS_BOOT.fail('CMS-LOAD-V3');
  }
}());
