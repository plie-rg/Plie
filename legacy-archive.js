(() => {
  'use strict';
  const archive = document.querySelector('[data-legacy-archive]');
  const status = document.querySelector('[data-archive-status]');
  if (!archive || !status) return;
  async function start() {
    try {
      const response = await fetch(window.PLIE_CONTENT_CONFIG?.feed || '/content/posts.json', {cache:'no-cache'});
      if (!response.ok) throw new Error('Feed unavailable');
      const feed = await response.json();
      if (!Array.isArray(feed.posts)) throw new Error('Invalid feed');
      const key = archive.dataset.legacyArchive;
      const post = feed.posts.find(p => p.legacyKey === key);
      if (post && /^\/news\/[a-f0-9]{32}\.html$/.test(post.url)) {
        location.replace(post.url);
      } else if ((feed.migratedArchives || []).includes(key)) {
        status.querySelector('p').textContent = '현재 공개 중인 사진첩이 아닙니다.';
      } else {
        status.hidden = true;
        archive.hidden = false;
      }
    } catch {
      status.querySelector('p').textContent = '사진첩을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.';
    }
  }
  start();
})();
