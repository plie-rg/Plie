// Kept in a separate script so a syntax error in the editor cannot hide this notice.
(function () {
  var stage = '편집 화면 코드 시작';
  var finished = false;
  var timer;
  function fail(code) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    var root = document.getElementById('app');
    if (!root) return;
    var panel = document.createElement('main');
    panel.className = 'auth';
    var title = document.createElement('h1');
    title.textContent = '관리 화면 연결을 확인해 주세요.';
    var detail = document.createElement('p');
    detail.textContent = '멈춘 단계: ' + stage + ' · 진단 코드: ' + code;
    var help = document.createElement('p');
    help.textContent = '이 화면의 진단 코드를 알려 주세요. 글이나 사진은 변경하지 않았습니다.';
    panel.appendChild(title); panel.appendChild(detail); panel.appendChild(help);
    root.replaceChildren(panel);
  }
  window.PLIE_CMS_BOOT = {
    stage: function (value) { stage = value; },
    done: function () { finished = true; clearTimeout(timer); },
    fail: fail
  };
  window.addEventListener('error', function (event) {
    if (event.target === window) fail('CMS-JS-' + (event.lineno || 0));
  });
  window.addEventListener('unhandledrejection', function () { fail('CMS-PROMISE'); });
  timer = setTimeout(function () { fail('CMS-WAIT-30'); }, 30000);
}());
