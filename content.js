(() => {
  'use strict';
  if (!window.PLIE_CONTENT_CONFIG?.enabled) return;
  const categories = {notice:'공지사항',class:'수업 이야기',event:'행사 · 발표회',competition:'대회 소식'};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = value => typeof value === 'string' && /^\/(?!\/)[A-Za-z0-9_./-]+$/.test(value) ? value : '';
  function eventDate(value) {
    if (typeof value !== 'string') return '';
    const match = /^([1-9]\d{3})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(value);
    if (!match) return '';
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const days = [31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
    return day <= days[month-1] ? value : '';
  }
  function datedPost(post, catalog) {
    // Only restore a verified archive date when an older CMS omitted the field.
    // An explicit empty date is the operator's choice and must stay empty.
    const archive = (catalog.albums || []).find(a => a.key === post.legacyKey && a.id === post.id);
    const date = Object.hasOwn(post, 'eventDate') ? post.eventDate : archive?.eventDate;
    return {...post, eventDate:eventDate(date)};
  }
  function chronological(a, b) {
    return b.eventDate.localeCompare(a.eventDate)
      || String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''))
      || String(a.id || '').localeCompare(String(b.id || ''));
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
    const date = post.eventDate;
    return `<article class="journal-card"><a href="${esc(url)}" class="journal-photo" aria-label="${esc(post.title)}">${image ? `<img src="${esc(image)}" alt="${esc(post.title)}" loading="lazy" decoding="async">` : '<span>plié.</span>'}${gallery ? '<span class="journal-kind">사진첩</span>' : ''}</a><div class="journal-copy"><div class="journal-meta"><span>${categories[post.category] || '플리에 소식'}</span>${date ? `<time datetime="${esc(date)}">${esc(date.replaceAll('-','.'))}</time>` : '<span>행사 날짜 미입력</span>'}</div><h2><a href="${esc(url)}">${esc(post.title)}</a></h2><p>${esc(post.excerpt)}</p><a class="journal-read" href="${esc(url)}">${gallery ? '사진첩 보기' : '이야기 읽기'} ↗</a></div></article>`;
  }
  async function start() {
    try {
      const [feed, catalog] = await Promise.all([
        json(window.PLIE_CONTENT_CONFIG.feed || '/api/public/posts'),
        json('/content/legacy-albums.json').catch(() => ({albums:[]}))
      ]);
      if (!Array.isArray(feed.posts)) throw new Error('Invalid feed');
      const posts = [...feed.posts, ...legacyPosts(catalog, feed)]
        .map(post => datedPost(post, catalog)).sort(chronological);
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
