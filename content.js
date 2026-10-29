(() => {
  'use strict';
  if (!window.PLIE_CONTENT_CONFIG?.enabled) return;
  const categories = {notice:'공지사항',class:'수업 이야기',event:'행사 · 발표회',competition:'대회 소식'};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = value => typeof value === 'string' && /^\/(?!\/)[A-Za-z0-9_./-]+$/.test(value) ? value : '';
  const koreanDate = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
  function publicationTime(value) {
    if (typeof value !== 'string') return Number.NEGATIVE_INFINITY;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
    if (!match) return Number.NEGATIVE_INFINITY;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const days = [31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
    if (month < 1 || month > 12 || day < 1 || day > days[month-1]) return Number.NEGATIVE_INFINITY;
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
  }
  function originalPublication(post, catalog) {
    const history = catalog.publicationHistory;
    const recorded = history && Object.prototype.hasOwnProperty.call(history, post.id) ? history[post.id]?.publishedAt : '';
    if (Number.isFinite(publicationTime(recorded))) return recorded;
    return Number.isFinite(publicationTime(post.publishedAt)) ? post.publishedAt : '';
  }
  function calendarDate(value) {
    const time = publicationTime(value);
    if (!Number.isFinite(time)) return '';
    const parts = Object.fromEntries(koreanDate.formatToParts(new Date(time)).map(part => [part.type,part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function newestPublication(a, b) {
    const aTime = publicationTime(a.publishedAt), bTime = publicationTime(b.publishedAt);
    return (aTime === bTime ? 0 : aTime < bTime ? 1 : -1) || String(a.id || '').localeCompare(String(b.id || ''));
  }
  async function json(url) {
    const response = await fetch(url, {cache:'no-cache'});
    if (!response.ok) throw new Error('소식을 불러오지 못했습니다.');
    return response.json();
  }
  function legacyPosts(catalog, feed) {
    const migrated = new Set(feed.migratedArchives || []);
    const published = new Set(feed.posts.map(p => p.legacyKey).filter(Boolean));
    return (catalog.albums || []).filter(a => !migrated.has(a.key) && !published.has(a.key)).map(a => {
      const cover = a.media[a.coverId];
      return {...a, legacyKey:a.key, url:a.legacyUrl, photoCount:a.blocks.filter(b => b.type === 'image').length,
        media:{[a.coverId]:{url:'/'+cover.sourcePath,thumbnail:'/'+cover.thumbnailPath}}};
    });
  }
  function card(post) {
    const asset = post.media?.[post.coverId];
    const image = safeUrl(asset?.thumbnail || asset?.poster || asset?.url);
    const url = safeUrl(post.url);
    if (!url) return '';
    const gallery = post.displayMode === 'gallery';
    const date = calendarDate(post.publishedAt);
    return `<article class="journal-card"><a href="${esc(url)}" class="journal-photo" aria-label="${esc(post.title)}">${image ? `<img src="${esc(image)}" alt="${esc(post.title)}" loading="lazy" decoding="async">` : '<span>plié.</span>'}${gallery ? '<span class="journal-kind">사진첩</span>' : ''}</a><div class="journal-copy"><div class="journal-meta"><span>${categories[post.category] || '플리에 소식'}</span>${date ? `<time datetime="${esc(date)}" title="최초 게시일">${esc(date.replaceAll('-','.'))}</time>` : '<span>행사 기록</span>'}</div><h2><a href="${esc(url)}">${esc(post.title)}</a></h2><p>${esc(post.excerpt)}</p><a class="journal-read" href="${esc(url)}">${gallery ? '사진첩 보기' : '이야기 읽기'} ↗</a></div></article>`;
  }
  async function start() {
    try {
      const [feed, catalog] = await Promise.all([
        json(window.PLIE_CONTENT_CONFIG.feed || '/api/public/posts'),
        json('/content/legacy-albums.json').catch(() => ({albums:[]}))
      ]);
      if (!Array.isArray(feed.posts)) throw new Error('Invalid feed');
      const posts = [...feed.posts, ...legacyPosts(catalog, feed)]
        .map(post => ({...post,publishedAt:originalPublication(post,catalog)}))
        .sort(newestPublication);
      document.querySelectorAll('[data-cms-section]').forEach(section => {
        const home = section.dataset.cmsSection === 'home';
        if (home && !posts.length) return;
        section.hidden = false;
        const grid = section.querySelector('[data-cms-grid]');
        const filter = section.querySelector('[data-cms-filter]');
        const search = section.querySelector('[data-cms-search]');
        const format = section.querySelector('[data-cms-format]');
        const count = section.querySelector('[data-cms-count]');
        let category = 'all';
        const draw = () => {
          let visible = posts.filter(p => (category === 'all' || p.category === category)
            && (!format || format.value === 'all' || (p.displayMode || 'story') === format.value)
            && (!search || `${p.title} ${p.excerpt}`.toLowerCase().includes(search.value.trim().toLowerCase())));
          if (home) visible = visible.slice(0,3);
          if (count) count.textContent = `${visible.length}개의 소식`;
          grid.innerHTML = visible.length ? visible.map(card).join('') : '<p class="journal-empty">조건에 맞는 소식이 없습니다.</p>';
        };
        if (filter) filter.querySelectorAll('button').forEach(button => button.onclick = () => {
          category = button.dataset.category;
          filter.querySelectorAll('button').forEach(b => {
            b.classList.toggle('active', b === button);
            b.setAttribute('aria-pressed', String(b === button));
          });
          draw();
        });
        if (search) search.oninput = draw;
        if (format) format.onchange = draw;
        draw();
      });
    } catch {
      document.querySelectorAll('[data-cms-section="news"]').forEach(section => {
        section.hidden = false;
        section.querySelector('[data-cms-grid]').innerHTML = '<p class="journal-empty" role="status">소식을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.</p>';
      });
    }
  }
  start();
})();
