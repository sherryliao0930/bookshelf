/* ===== 電子書櫃 主程式 ===== */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ZOOM_STEPS = [0.25, 0.4, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4];
  // 站在每層兩端的動物，一層換一組，所以每層看到的都不一樣
  const ANIMALS = ['a-rabbit', 'a-bear', 'a-chick', 'a-dog', 'a-owl', 'a-cat', 'a-panda', 'a-sheep', 'a-pig'];
  const CAT_COLORS = ['#e0503c', '#2f6fc4', '#41a132', '#eda200', '#8f7ae0', '#3596cc', '#dd6f52', '#25a97e'];
  const UNCATEGORIZED = '未分類';
  const catList = () => (typeof CATEGORIES !== 'undefined' && Array.isArray(CATEGORIES)) ? CATEGORIES : [];
  const NO_UPDATE_PERMISSION =
    '資料庫還不允許修改。請到 Supabase 的 SQL Editor 執行資料夾裡的 supabase-migration.sql，再試一次。';

  let sb = null;              // Supabase client
  let configured = false;     // 是否已填好 Supabase 設定
  let isAdmin = false;        // 是否已通過管理密碼
  let books = [];             // 全部書籍
  let filtered = [];          // 搜尋後的書籍
  let pendingAction = null;   // 通過密碼後要執行的動作
  let hasPosition = true;     // 資料庫有沒有 position 欄位（拖曳排序要用）
  let hasCategory = true;     // 資料庫有沒有 category 欄位（分類要用）
  let activeCat = '';         // 目前選的分類，空字串＝全部
  let editing = null;         // 正在編輯的書
  let dragState = null;       // 拖曳中的狀態
  let dragMoved = false;      // 這次按下去到底是拖曳還是單純點擊
  let dragEndedAt = 0;        // 剛拖曳完的時間，用來擋掉放開手指時的那一下點擊
  let nextPosBump = 0;        // 同一批多檔上傳時，讓每本的排序值不重複

  // 閱讀器狀態
  let pdfDoc = null;
  let currentBook = null;
  let pageNum = 1;
  let zoomMode = 'fit-page';  // fit-page | fit-width | custom
  let customScale = 1;
  let renderTask = null;
  let renderQueued = null;
  let appliedScale = 1;       // 這一頁實際用的倍率
  let spread = false;         // 雙頁模式
  const SPREAD_GAP = 14;      // 雙頁之間的縫隙，要跟 CSS 的 .canvas-wrap gap 一致

  /* ---------------- 工具 ---------------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, ms || 2600);
  }

  const fmtSize = (b) => !b ? '' : b >= 1048576
    ? (b / 1048576).toFixed(1) + ' MB'
    : Math.max(1, Math.round(b / 1024)) + ' KB';

  const isMobile = () => window.matchMedia('(max-width:640px)').matches;

  function publicUrl(path) {
    return SUPABASE_URL.replace(/\/+$/, '') +
      '/storage/v1/object/public/' + BUCKET + '/' + path.split('/').map(encodeURIComponent).join('/');
  }

  // 檔名去掉副檔名就是書名
  function fileTitle(name) {
    return String(name).replace(/\.pdf$/i, '').trim() || '未命名';
  }

  function uid() {
    return (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  }

  /* ---------------- 啟動 ---------------- */
  function init() {
    const name = SHELF_TITLE || '電子書櫃';
    document.title = name;
    // 只換標題文字，不要動旁邊的吉祥物
    const nameSlot = $('shelfTitle').querySelector('span');
    if (nameSlot) nameSlot.textContent = name; else $('shelfTitle').textContent = name;

    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }

    // 解鎖狀態記在這個分頁，重新整理不用再輸入一次密碼（關掉分頁就失效）
    try { if (sessionStorage.getItem('bookshelf:admin') === '1') isAdmin = true; } catch (e) {}

    bindUI();
    updateAdminUI();

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      showSetupNotice();
      return;
    }
    if (!window.supabase) {
      showStatus('讀不到 Supabase 程式庫（可能是網路被擋）。請確認電腦有連上網路後重新整理。');
      return;
    }

    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    configured = true;
    loadBooks();

    // 別人上傳新書時自動出現
    try {
      sb.channel('books-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'books' }, loadBooks)
        .subscribe();
    } catch (e) { /* Realtime 沒開也沒關係 */ }
  }

  function showStatus(html) {
    const box = $('statusBox');
    box.innerHTML = html;
    box.hidden = false;
  }

  function showSetupNotice() {
    showStatus(
      '<b>還沒設定 Supabase</b><br>書櫃需要一個雲端空間來放 PDF。請照著資料夾裡的' +
      '「<b>設定說明.md</b>」做完下面三件事，再重新整理這一頁：' +
      '<ol>' +
      '<li>到 supabase.com 免費開一個專案</li>' +
      '<li>在 SQL Editor 貼上並執行 <code>supabase-schema.sql</code></li>' +
      '<li>把專案的 URL 和 anon key 填進 <code>config.js</code></li>' +
      '</ol>'
    );
    $('uploadBtn').disabled = true;
    $('emptyState').hidden = true;
  }

  /* ---------------- 讀取書籍 ---------------- */
  async function loadBooks() {
    if (!configured) return;
    const { data, error } = await sb
      .from('books')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      showStatus('<b>讀取書籍失敗</b><br>' + esc(error.message) +
        '<br>請確認 <code>supabase-schema.sql</code> 已經執行過。');
      return;
    }
    $('statusBox').hidden = true;
    const rows = data || [];
    // 舊資料庫可能還沒加 position 欄位，偵測一下，沒有就照上架時間排
    if (rows.length) {
      hasPosition = Object.prototype.hasOwnProperty.call(rows[0], 'position');
      hasCategory = Object.prototype.hasOwnProperty.call(rows[0], 'category');
    }
    books = rows.slice().sort((a, b) => {
      const pa = a.position, pb = b.position;
      const ha = pa !== null && pa !== undefined;
      const hb = pb !== null && pb !== undefined;
      if (ha && hb) return pa - pb;
      if (ha) return -1;
      if (hb) return 1;
      return new Date(b.created_at) - new Date(a.created_at);
    });
    applyFilter();
  }

  const catOf = (b) => (b.category || '').trim() || UNCATEGORIZED;

  function applyFilter() {
    filtered = activeCat ? books.filter((b) => catOf(b) === activeCat) : books.slice();
    renderFilterBar();
    renderShelf();
  }

  // 依科目分組。選了某一科時就只有那一組，而且不加標題
  function groupBooks(list) {
    if (activeCat) return [{ name: '', books: list }];
    const order = catList().concat([UNCATEGORIZED]);
    const map = new Map();
    list.forEach((b) => {
      const c = catOf(b);
      if (!map.has(c)) map.set(c, []);
      map.get(c).push(b);
    });
    const groups = [];
    order.forEach((name) => { if (map.has(name)) { groups.push({ name, books: map.get(name) }); map.delete(name); } });
    map.forEach((arr, name) => groups.push({ name, books: arr }));   // config 沒列到的分類也不會消失
    return groups;
  }

  function catColor(name) {
    const i = catList().indexOf(name);
    return i >= 0 ? CAT_COLORS[i % CAT_COLORS.length] : '#a5825a';
  }

  function renderFilterBar() {
    const bar = $('filterBar');
    const counts = new Map();
    books.forEach((b) => {
      const c = catOf(b);
      counts.set(c, (counts.get(c) || 0) + 1);
    });
    // 只有一種分類（或完全沒分類）就不用顯示篩選列
    if (!books.length || counts.size < 2) { bar.hidden = true; bar.innerHTML = ''; return; }

    const order = catList().concat([UNCATEGORIZED]).filter((c) => counts.has(c));
    counts.forEach((n, name) => { if (order.indexOf(name) < 0) order.push(name); });

    bar.innerHTML = '';
    const mk = (label, value, n) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'chip' + (activeCat === value ? ' on' : '');
      el.innerHTML = esc(label) + '<b>' + n + '</b>';
      el.addEventListener('click', () => {
        activeCat = (activeCat === value) ? '' : value;
        applyFilter();
      });
      return el;
    };
    bar.appendChild(mk('全部', '', books.length));
    order.forEach((name) => bar.appendChild(mk(name, name, counts.get(name))));
    bar.hidden = false;
  }

  /* ---------------- 畫書架 ---------------- */
  function renderShelf() {
    const host = $('shelfRows');
    host.innerHTML = '';

    const count = books.length;
    $('bookCount').textContent = count
      ? '書櫃裡共 ' + count + ' 本書' + (activeCat ? '　·　目前看的是「' + activeCat + '」' : '')
      : '';

    if (!filtered.length) {
      const t = $('emptyState').querySelector('.empty-title') || {};
      const sub = $('emptyState').querySelector('.empty-sub') || {};
      if (count) {
        t.textContent = '這一科還沒有書';
        sub.textContent = '點上面的「全部」可以看其他科目。';
      } else {
        t.textContent = '書櫃還是空的';
        sub.textContent = '點右下角的齒輪就能上傳新書，選一個 PDF 檔，它就會變成書櫃上的一本書。';
      }
      $('emptyState').hidden = false;
      return;
    }
    $('emptyState').hidden = true;

    // 書本尺寸由 CSS 的 --book-w / --book-gap 決定（桌機、平板、手機各一組），
    // 這裡讀回來換算一層放得下幾本，所以要調大小改 CSS 就好。
    const cs = getComputedStyle(document.documentElement);
    const bw = parseFloat(cs.getPropertyValue('--book-w')) || 132;
    const gap = parseFloat(cs.getPropertyValue('--book-gap')) || 26;
    const pad = parseFloat(cs.getPropertyValue('--shelf-pad')) || 16;
    // 每層兩端站的小夥伴也要留位置（手機只留一隻，很窄的手機不放）
    const petW = parseFloat(cs.getPropertyValue('--pet-w')) || 0;
    const petSlots = parseFloat(cs.getPropertyValue('--pet-slots')) || 0;
    const reserved = petSlots * (petW + gap);
    // 扣掉書櫃內襯左右內距，才不會算出擠爆那一層的本數
    const avail = (host.clientWidth || window.innerWidth) - pad * 2;
    const perRow = Math.max(1, Math.floor((avail - reserved + gap) / (bw + gap)));

    let rowNo = 0;
    groupBooks(filtered).forEach((group) => {
      const wrap = document.createElement('div');
      wrap.className = 'group';

      if (group.name) {
        const head = document.createElement('div');
        head.className = 'group-head';
        head.innerHTML =
          '<span class="group-chip"><i style="background:' + catColor(group.name) + '"></i>' +
            esc(group.name) + '</span>' +
          '<span class="group-count">' + group.books.length + ' 本</span>';
        wrap.appendChild(head);
      }

      for (let i = 0; i < group.books.length; i += perRow) {
        const row = document.createElement('div');
        row.className = 'shelf-row';

        const inner = document.createElement('div');
        inner.className = 'shelf-inner';

        const strip = document.createElement('div');
        strip.className = 'shelf-books';

        // 每層兩端各站一隻，且每層都換不同的動物
        if (petSlots >= 2) strip.appendChild(petEl(rowNo * 2));
        group.books.slice(i, i + perRow).forEach((b) => strip.appendChild(bookEl(b)));
        if (petSlots >= 2) strip.appendChild(petEl(rowNo * 2 + 1));
        else if (petSlots >= 1) strip.appendChild(petEl(rowNo));
        rowNo++;

        const plank = document.createElement('div');
        plank.className = 'shelf-plank';

        inner.appendChild(strip);
        row.appendChild(inner);
        row.appendChild(plank);
        wrap.appendChild(row);
      }
      host.appendChild(wrap);
    });
  }

  // 站在每層兩端的動物
  function petEl(n) {
    const d = document.createElement('div');
    d.className = 'shelf-pet';
    d.setAttribute('aria-hidden', 'true');
    d.innerHTML = '<svg class="mascot" viewBox="0 0 120 120">' +
      '<use href="#' + ANIMALS[((n % ANIMALS.length) + ANIMALS.length) % ANIMALS.length] + '"/></svg>';
    return d;
  }

  // 沒封面的書給一個彩色書皮（同一本書每次顏色都一樣）
  function coverColor(title) {
    let h = 0;
    for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
    return 'c' + (h % 6);
  }

  const icon = (name) => '<svg class="ic"><use href="#i-' + name + '"/></svg>';

  function bookEl(b) {
    // 用 div 而不是 button：書封上還有編輯／刪除兩顆按鈕，
    // 按鈕包按鈕是無效 HTML，瀏覽器會把外層提早關掉。
    const el = document.createElement('div');
    el.className = 'book';
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.title = b.title + (b.author ? ' — ' + b.author : '');

    const cover = b.cover_path
      ? '<img src="' + esc(publicUrl(b.cover_path)) + '" alt="" loading="lazy" draggable="false">'
      : '<div class="fallback ' + coverColor(b.title || '') + '">' +
          icon('book') + '<span>' + esc(b.title) + '</span></div>';

    el.innerHTML =
      '<div class="book-cover">' + cover +
        (canManage()
          ? '<div class="book-grip" title="按住就可以拖曳排序">' + icon('drag') + '</div>'
          : '') +
        (canManage()
          ? '<div class="book-tools">' +
              '<button class="book-edit" type="button" title="改書名／換封面" aria-label="改書名或換封面">' +
                icon('edit') + '</button>' +
              '<button class="book-del" type="button" title="刪除這本書" aria-label="刪除這本書">' +
                icon('trash') + '</button>' +
            '</div>'
          : '') +
      '</div>' +
      '<div class="book-meta">' +
        '<div class="book-title">' + esc(b.title) + '</div>' +
        (b.author ? '<div class="book-author">' + esc(b.author) + '</div>' : '') +
      '</div>';

    // 拖曳放開時瀏覽器會再補一個 click，剛拖完的那一下要忽略
    el.addEventListener('click', () => {
      if (Date.now() - dragEndedAt > 300) openReader(b);
    });
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openReader(b); }
    });

    const del = el.querySelector('.book-del');
    if (del) {
      del.addEventListener('click', (ev) => { ev.stopPropagation(); deleteBook(b); });
    }
    const edit = el.querySelector('.book-edit');
    if (edit) {
      edit.addEventListener('click', (ev) => { ev.stopPropagation(); openEdit(b); });
    }
    if (canManage()) {
      el.classList.add('draggable');
      el.dataset.id = b.id;
      el.dataset.cat = catOf(b);
      el.addEventListener('pointerdown', (ev) => startDrag(ev, b, el));
      el.addEventListener('dragstart', (ev) => ev.preventDefault());
    }
    return el;
  }

  /* ---------------- 管理密碼 ---------------- */
  // 沒設密碼＝人人可管理；有設密碼＝要先解鎖，解鎖前連刪除鈕都不顯示
  function canManage() { return !ADMIN_PASSWORD || isAdmin; }

  // 角落的管理鈕：沒解鎖時是不起眼的齒輪，解鎖後才變成明顯的「上傳新書」
  function updateAdminUI() {
    const fab = $('uploadBtn');
    const use = fab.querySelector('use');
    $('adminBar').hidden = !canManage();
    if (canManage()) {
      fab.classList.add('is-admin');
      fab.title = '上傳新書';
      use.setAttribute('href', '#i-plus');
    } else {
      fab.classList.remove('is-admin');
      fab.title = '管理（上傳新書）';
      use.setAttribute('href', '#i-gear');
    }
  }

  function requireAdmin(fn, note) {
    if (!ADMIN_PASSWORD || isAdmin) { fn(); return; }
    pendingAction = fn;
    $('pwNote').textContent = note || '上傳與刪除需要管理密碼，瀏覽則不需要。';
    $('pwError').hidden = true;
    $('fPassword').value = '';
    $('pwModal').hidden = false;
    setTimeout(() => $('fPassword').focus(), 50);
  }

  /* ---------------- 拖曳排序 ---------------- */
  function startDrag(ev, book, el) {
    if (!canManage()) return;
    if (ev.button != null && ev.button !== 0) return;       // 只接受左鍵／單指
    if (ev.target.closest && ev.target.closest('.book-tools')) return;
    dragMoved = false;

    dragState = {
      book: book, el: el, target: null, before: true, ghost: null,
      startX: ev.clientX, startY: ev.clientY,
      lastX: ev.clientX, lastY: ev.clientY, autoScroll: null,
      rect: el.getBoundingClientRect()
    };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  }

  function beginGhost() {
    const { el, rect } = dragState;
    const g = el.cloneNode(true);
    g.className = 'book drag-ghost';
    g.style.width = rect.width + 'px';
    g.style.left = rect.left + 'px';
    g.style.top = rect.top + 'px';
    document.body.appendChild(g);
    dragState.ghost = g;
    el.classList.add('dragging');
    document.body.classList.add('is-dragging');

    // 拖到畫面上下緣時自動捲動，才拖得到看不見的那幾層
    dragState.autoScroll = setInterval(() => {
      if (!dragState) return;
      const edge = 90, step = 16;
      let dy = 0;
      if (dragState.lastY < edge) dy = -step;
      else if (dragState.lastY > window.innerHeight - edge) dy = step;
      if (!dy) return;
      const before = window.scrollY;
      window.scrollBy(0, dy);
      if (window.scrollY !== before) updateDropTarget(dragState.lastX, dragState.lastY);
    }, 30);
  }

  // 找出游標底下是哪一本書，要插在它前面還是後面
  function updateDropTarget(x, y) {
    if (!dragState || !dragState.ghost) return;
    const g = dragState.ghost;
    g.style.display = 'none';
    const under = document.elementFromPoint(x, y);
    g.style.display = '';

    clearDropMarks();
    const target = under && under.closest ? under.closest('.book') : null;
    if (target && target !== dragState.el && target.dataset.id) {
      const r = target.getBoundingClientRect();
      const before = x < r.left + r.width / 2;
      target.classList.add(before ? 'drop-before' : 'drop-after');
      dragState.target = target;
      dragState.before = before;
    } else {
      dragState.target = null;
    }
  }

  function clearDropMarks() {
    document.querySelectorAll('.drop-before,.drop-after')
      .forEach((n) => n.classList.remove('drop-before', 'drop-after'));
  }

  function onDragMove(ev) {
    if (!dragState) return;
    const dx = ev.clientX - dragState.startX;
    const dy = ev.clientY - dragState.startY;
    if (!dragMoved) {
      if (Math.abs(dx) + Math.abs(dy) < 8) return;          // 手抖不算拖曳
      dragMoved = true;
      beginGhost();
    }
    ev.preventDefault();
    dragState.lastX = ev.clientX;
    dragState.lastY = ev.clientY;
    const g = dragState.ghost;
    g.style.left = (dragState.rect.left + dx) + 'px';
    g.style.top = (dragState.rect.top + dy) + 'px';
    updateDropTarget(ev.clientX, ev.clientY);
  }

  function endDrag() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    if (!dragState) return;

    const moved = dragMoved && dragState.target;
    const dragId = dragState.book.id;
    const targetId = moved ? dragState.target.dataset.id : null;
    const before = dragState.before;

    if (dragMoved) dragEndedAt = Date.now();
    if (dragState.autoScroll) clearInterval(dragState.autoScroll);
    if (dragState.ghost) dragState.ghost.remove();
    dragState.el.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    clearDropMarks();
    dragState = null;

    if (moved) reorder(dragId, targetId, before);
  }

  function reorder(dragId, targetId, before) {
    const from = books.findIndex((b) => b.id === dragId);
    if (from < 0) return;
    const target = books.find((b) => b.id === targetId);

    // 拖到別科的書上面 = 順便換到那一科
    let movedToCat = null;
    if (target && hasCategory && !activeCat) {
      const oldCat = books[from].category || null;
      const newCat = target.category || null;
      if (oldCat !== newCat) {
        books[from].category = newCat;
        movedToCat = newCat || UNCATEGORIZED;
      }
    }

    const moved = books.splice(from, 1)[0];
    let to = books.findIndex((b) => b.id === targetId);
    if (to < 0) to = books.length;
    else if (!before) to += 1;
    books.splice(to, 0, moved);
    applyFilter();
    saveOrder(movedToCat ? moved : null, movedToCat);
  }

  async function saveOrder(catBook, catName) {
    // 換了科目就連同分類一起存
    if (catBook) {
      try {
        const { data, error } = await sb.from('books')
          .update({ category: catBook.category }).eq('id', catBook.id).select();
        if (error) throw error;
        if (!data || !data.length) { toast(NO_UPDATE_PERMISSION, 6000); return; }
        toast('已移到「' + catName + '」');
      } catch (e) {
        toast('換分類失敗：' + (e.message || e), 4000);
        return;
      }
    }
    const updates = [];
    books.forEach((b, i) => {
      const pos = (i + 1) * 10;
      if (b.position !== pos) { b.position = pos; updates.push({ id: b.id, position: pos }); }
    });
    if (!updates.length) return;
    if (!hasPosition) { orderNotSaved(); return; }
    try {
      const res = await Promise.all(updates.map((u) =>
        sb.from('books').update({ position: u.position }).eq('id', u.id).select('id')));
      const bad = res.find((r) => r && r.error);
      if (bad) throw bad.error;
      if (res.some((r) => !r.data || !r.data.length)) { orderNotSaved(); return; }
      if (!catBook) toast('順序已儲存');
    } catch (e) {
      const m = String(e.message || e);
      if (/position/i.test(m)) { hasPosition = false; orderNotSaved(); }
      else toast('順序儲存失敗：' + m, 4000);
    }
  }

  function orderNotSaved() {
    toast('順序只有這次有效：請先到 Supabase 執行 supabase-migration.sql', 6500);
    hasPosition = false;
  }

  // 把科目清單塞進下拉選單
  function fillCategorySelect(sel, current) {
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = UNCATEGORIZED;
    sel.appendChild(opt0);
    catList().forEach((c) => {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = c;
      sel.appendChild(o);
    });
    const cur = (current || '').trim();
    // config 裡沒有的舊分類也要留著，不然一存檔就被洗掉
    if (cur && catList().indexOf(cur) < 0) {
      const o = document.createElement('option');
      o.value = cur;
      o.textContent = cur;
      sel.appendChild(o);
    }
    sel.value = cur;
  }

  /* ---------------- 編輯書籍 ---------------- */
  function openEdit(b) {
    editing = b;
    $('editForm').reset();
    $('eTitle').value = b.title || '';
    $('eAuthor').value = b.author || '';
    fillCategorySelect($('eCategory'), b.category);
    $('eCoverPreview').innerHTML = b.cover_path
      ? '<img src="' + esc(publicUrl(b.cover_path)) + '" alt="">'
      : '<span>目前沒有封面</span>';
    $('editError').hidden = true;
    $('editProgress').hidden = true;
    $('submitEdit').disabled = false;
    $('submitEdit').textContent = '儲存';
    $('editModal').hidden = false;
    setTimeout(() => $('eTitle').focus(), 50);
  }

  async function doEdit(ev) {
    ev.preventDefault();
    if (!editing) return;
    const errBox = $('editError');
    errBox.hidden = true;

    const title = $('eTitle').value.trim();
    const author = $('eAuthor').value.trim();
    const coverFile = $('eCover').files[0];

    function fail(msg) {
      errBox.textContent = msg;
      errBox.hidden = false;
      $('submitEdit').disabled = false;
      $('submitEdit').textContent = '儲存';
      $('editProgress').hidden = true;
    }
    if (!title) return fail('書名不能空白。');

    $('submitEdit').disabled = true;
    $('submitEdit').textContent = '儲存中…';

    const patch = { title: title, author: author || null };
    if (hasCategory) patch.category = $('eCategory').value || null;
    const oldCover = editing.cover_path;
    let uploadedCover = null;   // 存檔失敗時要把它清掉，免得雲端留下沒人用的檔案

    try {
      if (coverFile) {
        $('editProgress').hidden = false;
        $('eProgressFill').style.width = '20%';
        $('eProgressText').textContent = '正在處理封面…';
        const blob = await shrinkImage(coverFile, 600);
        const newPath = 'covers/' + uid() + '.jpg';
        await uploadToStorage(newPath, blob, 'image/jpeg', (r) => {
          $('eProgressFill').style.width = (20 + r * 70) + '%';
          $('eProgressText').textContent = '正在上傳封面… ' + Math.round(r * 100) + '%';
        });
        patch.cover_path = newPath;
        uploadedCover = newPath;
      }

      $('eProgressFill').style.width = '95%';
      $('eProgressText').textContent = '正在儲存…';
      // 一定要 .select() 把改到的資料要回來：資料庫沒開修改權限時，
      // Supabase 會回「成功但 0 筆」，不檢查的話會誤以為存好了。
      let { data, error } = await sb.from('books').update(patch).eq('id', editing.id).select();
      // 資料庫還沒跑 migration 的話沒有 category 欄位，去掉再存一次
      if (error && /category/i.test(String(error.message || ''))) {
        hasCategory = false;
        delete patch.category;
        ({ data, error } = await sb.from('books').update(patch).eq('id', editing.id).select());
      }
      if (error) throw error;
      if (!data || !data.length) throw new Error(NO_UPDATE_PERMISSION);

      // 換了封面才刪掉舊的，避免刪錯
      if (patch.cover_path && oldCover) {
        try { await sb.storage.from(BUCKET).remove([oldCover]); } catch (e) {}
      }

      Object.assign(editing, patch);
      $('editModal').hidden = true;
      editing = null;
      applyFilter();
      toast('已更新「' + title + '」');
    } catch (e) {
      if (uploadedCover) {
        try { await sb.storage.from(BUCKET).remove([uploadedCover]); } catch (e2) {}
      }
      fail('儲存失敗：' + (e.message || e));
    }
  }

  /* ---------------- 刪除 ---------------- */
  async function deleteBook(b) {
    if (!confirm('確定要把「' + b.title + '」從書櫃刪除嗎？這個動作無法復原。')) return;
    const paths = [b.pdf_path, b.cover_path].filter(Boolean);
    try {
      if (paths.length) await sb.storage.from(BUCKET).remove(paths);
      const { error } = await sb.from('books').delete().eq('id', b.id);
      if (error) throw error;
      books = books.filter((x) => x.id !== b.id);
      applyFilter();
      toast('已刪除「' + b.title + '」');
    } catch (e) {
      toast('刪除失敗：' + (e.message || e), 4000);
    }
  }

  /* ---------------- 上傳 ---------------- */
  function openUpload() {
    $('uploadForm').reset();
    updateFileList([]);
    // 預設帶入目前正在看的那一科，連續上傳同一科比較快
    fillCategorySelect($('fCategory'), activeCat);
    $('coverPreview').innerHTML = '<span>封面預覽</span>';
    $('uploadError').hidden = true;
    $('uploadProgress').hidden = true;
    $('submitUpload').disabled = false;
    $('submitUpload').textContent = '開始上傳';
    $('uploadModal').hidden = false;
    setTimeout(() => $('fTitle').focus(), 50);
  }

  // 選了幾個檔就長不一樣：一個檔照舊，多個檔改成清單模式
  function updateFileList(files) {
    const list = $('fileList');
    const multi = files.length > 1;

    $('fTitle').disabled = multi;
    $('fTitle').required = !multi;
    $('fCover').disabled = multi;
    $('coverPreviewWrap').hidden = multi;
    $('fCover').closest('.field').hidden = multi;

    if (!files.length) {
      list.hidden = true; list.innerHTML = '';
      $('pdfHint').textContent = '可以一次選多個檔案，會自動一本一本上架。單一檔案建議 50 MB 以內';
      return;
    }

    if (!multi) {
      list.hidden = true; list.innerHTML = '';
      const f = files[0];
      $('pdfHint').textContent = '已選擇：' + f.name + '（' + fmtSize(f.size) + '）';
      if (!$('fTitle').value.trim()) $('fTitle').value = fileTitle(f.name);
      return;
    }

    const total = files.reduce((n, f) => n + f.size, 0);
    $('pdfHint').textContent = '已選擇 ' + files.length + ' 個檔案，共 ' + fmtSize(total) +
      '。書名會自動用檔名，封面自動抓每本 PDF 的第一頁，上架後可以再個別修改。';
    list.innerHTML = '<div class="file-list-head">這 ' + files.length + ' 本會依序上架</div>' +
      files.map((f, i) =>
        '<div class="file-row">' +
          '<span class="n">' + (i + 1) + '</span>' +
          '<span class="t">' + esc(fileTitle(f.name)) + '</span>' +
          '<span class="s">' + fmtSize(f.size) + '</span>' +
          '<span class="mark"></span>' +
        '</div>').join('');
    list.hidden = false;
  }

  function setProgress(pct, text) {
    $('uploadProgress').hidden = false;
    $('progressFill').style.width = Math.max(0, Math.min(100, pct)) + '%';
    $('progressText').textContent = text;
  }

  // 用 XHR 上傳，才拿得到真正的進度
  function uploadToStorage(path, blob, contentType, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', SUPABASE_URL.replace(/\/+$/, '') +
        '/storage/v1/object/' + BUCKET + '/' + path);
      xhr.setRequestHeader('Authorization', 'Bearer ' + SUPABASE_ANON_KEY);
      xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
      xhr.setRequestHeader('x-upsert', 'true');
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        // 伺服器有時回傳整頁 HTML 錯誤頁，直接倒給使用者看沒有意義
        let msg = '';
        try { msg = JSON.parse(xhr.responseText).message || ''; } catch (e2) {}
        if (!msg) {
          const raw = String(xhr.responseText || '');
          msg = /^\s*</.test(raw) || raw.length > 200
            ? '伺服器回應 HTTP ' + xhr.status
            : (raw || 'HTTP ' + xhr.status);
        }
        reject(new Error(msg));
      };
      xhr.onerror = () => reject(new Error('網路連線中斷'));
      xhr.send(blob);
    });
  }

  // 把圖片縮到最寬 600px 的 JPEG
  function shrinkImage(file, maxW) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const ratio = Math.min(1, maxW / img.width);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * ratio);
        c.height = Math.round(img.height * ratio);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((b) => b ? resolve(b) : reject(new Error('圖片處理失敗')), 'image/jpeg', 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('讀不到這張圖片')); };
      img.src = url;
    });
  }

  // 把 PDF 第一頁畫成封面
  function coverFromPdf(pdf) {
    return pdf.getPage(1).then((page) => {
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(3, 600 / base.width) });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      return page.render({ canvasContext: ctx, viewport: vp }).promise
        .then(() => new Promise((res, rej) =>
          c.toBlob((b) => b ? res(b) : rej(new Error('封面產生失敗')), 'image/jpeg', 0.85)));
    });
  }

  // 上傳一本書。回傳 { ok, error }
  async function uploadOne(pdfFile, meta, onStage) {
    const stage = onStage || function () {};
    let pdf, pageCount = null;

    stage(3, '正在檢查 PDF…');
    const buf = await pdfFile.arrayBuffer();
    try {
      pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
      pageCount = pdf.numPages;
    } catch (e) {
      return { ok: false, error: '這個 PDF 打不開（可能已損毀或有密碼保護）' };
    }

    stage(8, '正在處理封面…');
    let coverBlob = null;
    try {
      coverBlob = meta.coverFile
        ? await shrinkImage(meta.coverFile, 600)
        : await coverFromPdf(pdf);
    } catch (e) {
      coverBlob = null;                       // 封面失敗不擋上傳
    }

    const key = uid();
    const pdfPath = 'pdfs/' + key + '.pdf';
    try {
      await uploadToStorage(pdfPath, pdfFile, 'application/pdf', (r) => {
        stage(10 + r * 75, '正在上傳 PDF… ' + Math.round(r * 100) + '%（' + fmtSize(pdfFile.size) + '）');
      });
    } catch (e) {
      return { ok: false, error: uploadHint(e) };
    }

    let coverPath = null;
    if (coverBlob) {
      stage(88, '正在上傳封面…');
      coverPath = 'covers/' + key + '.jpg';
      try { await uploadToStorage(coverPath, coverBlob, 'image/jpeg'); }
      catch (e) { coverPath = null; }
    }

    stage(95, '正在放上書架…');
    const row = {
      title: meta.title,
      author: meta.author || null,
      pdf_path: pdfPath, cover_path: coverPath,
      page_count: pageCount, size_bytes: pdfFile.size
    };
    if (hasCategory && meta.category) row.category = meta.category;
    if (hasPosition) {
      const maxPos = books.reduce((m, b) =>
        (b.position != null && b.position > m ? b.position : m), 0);
      row.position = maxPos + 10 + nextPosBump;
      nextPosBump += 10;                      // 同一批連續上傳時不要撞在一起
    }

    // 資料庫還沒跑 supabase-migration.sql 的話會少欄位。
    // Postgres 一次只會報一個缺少的欄位，所以要一個一個拿掉重試。
    const optional = ['position', 'category'];
    let error = null;
    for (let attempt = 0; attempt <= optional.length; attempt++) {
      ({ error } = await sb.from('books').insert(row));
      if (!error) break;
      const msg = String(error.message || '');
      const missing = optional.find((c) => row[c] !== undefined && msg.indexOf("'" + c + "'") >= 0);
      if (!missing) break;
      if (missing === 'position') hasPosition = false; else hasCategory = false;
      delete row[missing];
    }
    if (error) {
      await sb.storage.from(BUCKET).remove([pdfPath, coverPath].filter(Boolean));
      return { ok: false, error: error.message || String(error) };
    }
    return { ok: true };
  }

  function uploadHint(e) {
    const m = String(e.message || e);
    return m + (/exceeded|too large|413/i.test(m)
      ? '（檔案超過 Supabase 的單檔上限，請到 Storage 設定調高，或改用小一點的 PDF）' : '');
  }

  async function doUpload(ev) {
    ev.preventDefault();
    const errBox = $('uploadError');
    errBox.hidden = true;

    const files = Array.prototype.slice.call($('fPdf').files || []);
    const author = $('fAuthor').value.trim();
    const category = $('fCategory') ? $('fCategory').value : '';
    const multi = files.length > 1;

    function fail(msg) {
      errBox.textContent = msg;
      errBox.hidden = false;
      $('submitUpload').disabled = false;
      $('submitUpload').textContent = '開始上傳';
      return false;
    }

    if (!files.length) return fail('請選 PDF 檔。');
    const bad = files.find((f) => !/\.pdf$/i.test(f.name) && f.type !== 'application/pdf');
    if (bad) return fail('「' + bad.name + '」看起來不是 PDF。');

    const title = $('fTitle').value.trim();
    if (!multi && !title) return fail('請先填書名。');

    $('submitUpload').disabled = true;
    $('submitUpload').textContent = '上傳中…';
    nextPosBump = 0;

    // ---- 單一檔案 ----
    if (!multi) {
      const res = await uploadOne(files[0], {
        title: title, author: author, category: category,
        coverFile: $('fCover').files[0] || null
      }, setProgress);
      if (!res.ok) { $('uploadProgress').hidden = true; return fail('上傳失敗：' + res.error); }
      setProgress(100, '完成！');
      $('uploadModal').hidden = true;
      toast('「' + title + '」已經上架');
      loadBooks();
      return true;
    }

    // ---- 多個檔案：一本一本上架 ----
    const rows = $('fileList').querySelectorAll('.file-row');
    const failures = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const name = fileTitle(f.name);
      const row = rows[i];
      if (row) row.classList.add('doing');
      const res = await uploadOne(f, {
        title: name, author: author, category: category, coverFile: null
      }, (pct, text) => {
        const overall = (i * 100 + pct) / files.length;
        setProgress(overall, '第 ' + (i + 1) + ' / ' + files.length + ' 本：' + name + ' — ' + text);
      });
      if (row) {
        row.classList.remove('doing');
        row.classList.add('done', res.ok ? 'ok' : 'bad');
        const mark = row.querySelector('.mark');
        if (mark) mark.textContent = res.ok ? '✓' : '✕';
      }
      if (!res.ok) failures.push(name + '（' + res.error + '）');
      // 每一本傳完就更新書架，看得到進度
      await loadBooks();
    }

    setProgress(100, '完成！');
    $('submitUpload').disabled = false;
    $('submitUpload').textContent = '開始上傳';

    const okCount = files.length - failures.length;
    if (!failures.length) {
      $('uploadModal').hidden = true;
      toast('已上架 ' + okCount + ' 本書');
    } else {
      fail('完成 ' + okCount + ' 本，但有 ' + failures.length + ' 本失敗：' + failures.join('；'));
    }
    return true;
  }

  /* ---------------- 閱讀器 ---------------- */
  async function openReader(b) {
    currentBook = b;
    pdfDoc = null;
    $('readerView').hidden = false;
    $('readerTitle').textContent = b.title;
    $('pageTotal').textContent = b.page_count || '–';
    $('readerLoading').style.display = '';
    $('readerLoadingText').textContent = '正在開啟「' + b.title + '」…';
    document.body.style.overflow = 'hidden';

    zoomMode = 'fit-page';
    try { spread = localStorage.getItem('bookshelf:spread') === '1'; } catch (e) { spread = false; }
    // 手機螢幕太窄，兩頁並排看不清楚
    if (isMobile()) spread = false;
    updateSpreadLabel();
    const saved = parseInt(localStorage.getItem('bookshelf:page:' + b.id) || '1', 10);

    try {
      const task = pdfjsLib.getDocument({ url: publicUrl(b.pdf_path), withCredentials: false });
      task.onProgress = (p) => {
        if (p.total) {
          $('readerLoadingText').textContent =
            '載入中… ' + Math.round(p.loaded / p.total * 100) + '%';
        }
      };
      pdfDoc = await task.promise;
      $('pageTotal').textContent = pdfDoc.numPages;
      pageNum = normalizePage(saved || 1);
      $('readerLoading').style.display = 'none';
      await renderPage();
    } catch (e) {
      $('readerLoadingText').textContent = '開啟失敗：' + (e.message || e);
    }
  }

  function closeReader() {
    $('readerView').hidden = true;
    document.body.style.overflow = '';
    if (renderTask) { try { renderTask.cancel(); } catch (e) {} renderTask = null; }
    if (pdfDoc) { try { pdfDoc.destroy(); } catch (e) {} }
    pdfDoc = null;
    currentBook = null;
  }

  async function renderPage() {
    if (!pdfDoc) return;
    // 前一次還在畫 → 取消，只畫最新的
    if (renderTask) {
      renderQueued = pageNum;
      $('pageInput').value = pageNum;
      try { renderTask.cancel(); } catch (e) {}
      return;
    }

    const target = pageNum;
    const second = spread && target + 1 <= pdfDoc.numPages ? target + 1 : null;
    $('pageInput').value = target;
    $('prevPage').disabled = $('edgePrev').disabled = target <= 1;
    $('nextPage').disabled = $('edgeNext').disabled =
      target + (spread ? 1 : 0) >= pdfDoc.numPages;
    $('renderSpinner').hidden = false;

    try {
      const page = await pdfDoc.getPage(target);
      const host = $('pageHost');
      const base = page.getViewport({ scale: 1 });
      const padding = isMobile() ? 16 : 40;
      // 雙頁時可用寬度要分給兩頁，還要扣掉中間的縫
      const cols = second ? 2 : 1;
      const availW = (host.clientWidth - padding - (second ? SPREAD_GAP : 0)) / cols;

      let scale;
      if (zoomMode === 'fit-width') {
        scale = availW / base.width;
      } else if (zoomMode === 'fit-page') {
        scale = Math.min(availW / base.width,
                         (host.clientHeight - padding) / base.height);
      } else {
        scale = customScale;
      }
      scale = Math.max(0.1, Math.min(6, scale));
      appliedScale = scale;
      updateZoomLabel();          // 先更新標籤，不要等畫完（畫得慢時標籤會跟不上）

      // 依螢幕實際解析度繪製（手機常見 3 倍），畫面才不會糊。
      // 但畫布像素總量有上限（iOS Safari 約 1670 萬），超過會整張變空白，
      // 所以放大到很大時要自動降倍率。雙頁時兩張畫布共用這個額度。
      const dpr = pickDpr(vpWidth(base, scale), vpHeight(base, scale), cols);
      const drawInto = async (pg, canvas) => {
        const vp = pg.getViewport({ scale });
        const ctx = canvas.getContext('2d');
        canvas.hidden = false;
        canvas.width = Math.floor(vp.width * dpr);
        canvas.height = Math.floor(vp.height * dpr);
        canvas.style.width = Math.floor(vp.width) + 'px';
        canvas.style.height = Math.floor(vp.height) + 'px';
        renderTask = pg.render({
          canvasContext: ctx,
          viewport: vp,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null
        });
        await renderTask.promise;
        renderTask = null;
      };

      const canvas = $('pdfCanvas');
      await drawInto(page, canvas);

      const canvas2 = $('pdfCanvas2');
      if (second) {
        const page2 = await pdfDoc.getPage(second);
        await drawInto(page2, canvas2);
      } else {
        canvas2.hidden = true;
      }

      host.scrollTop = 0;
      const wrapW = $('canvasWrap').offsetWidth;
      host.scrollLeft = Math.max(0, (wrapW - host.clientWidth) / 2);
      if (currentBook) localStorage.setItem('bookshelf:page:' + currentBook.id, String(target));
    } catch (e) {
      renderTask = null;
      if (e && e.name !== 'RenderingCancelledException') {
        toast('這一頁畫不出來：' + (e.message || e), 3500);
      }
    } finally {
      $('renderSpinner').hidden = true;
      if (renderQueued != null) {
        const q = renderQueued;
        renderQueued = null;
        pageNum = q;
        renderPage();
      }
    }
  }

  const MAX_CANVAS_PX = 12e6;   // 保守一點，離瀏覽器上限留餘裕
  const vpWidth = (base, scale) => base.width * scale;
  const vpHeight = (base, scale) => base.height * scale;

  function pickDpr(w, h, cols) {
    let d = Math.min(window.devicePixelRatio || 1, 3);
    const budget = MAX_CANVAS_PX / (cols || 1);
    const area = w * h * d * d;
    if (area > budget) d = Math.max(1, Math.sqrt(budget / (w * h)));
    return d;
  }

  function updateZoomLabel() {
    const btn = $('zoomLevel');
    if (zoomMode === 'fit-width') btn.textContent = '符合寬度';
    else if (zoomMode === 'fit-page') btn.textContent = '整頁';
    else btn.textContent = Math.round(appliedScale * 100) + '%';
  }

  const pageStep = () => (spread ? 2 : 1);

  // 雙頁時固定以奇數頁當左頁，跳到第 6 頁就顯示 5-6，不會每次錯開
  function normalizePage(n) {
    let p = Math.min(Math.max(1, n | 0), pdfDoc.numPages);
    if (spread && p % 2 === 0) p -= 1;
    return Math.max(1, p);
  }

  function goPage(n) {
    if (!pdfDoc) return;
    const p = normalizePage(n);
    if (p === pageNum && !renderQueued) { $('pageInput').value = p; return; }
    pageNum = p;
    renderPage();
  }

  // 以「目前實際倍率」為基準，往上／往下跳到最接近的一級
  function zoomBy(dir) {
    if (!pdfDoc) return;
    const now = appliedScale;
    let next;
    if (dir > 0) {
      next = ZOOM_STEPS.find((s) => s > now + 0.005);
      if (next == null) next = ZOOM_STEPS[ZOOM_STEPS.length - 1];
    } else {
      const smaller = ZOOM_STEPS.filter((s) => s < now - 0.005);
      next = smaller.length ? smaller[smaller.length - 1] : ZOOM_STEPS[0];
    }
    customScale = next;
    zoomMode = 'custom';
    renderPage();
  }

  // 整頁 → 符合寬度 → 100% → 整頁…
  function toggleSpread() {
    if (!pdfDoc) return;
    spread = !spread;
    try { localStorage.setItem('bookshelf:spread', spread ? '1' : '0'); } catch (e) {}
    updateSpreadLabel();
    pageNum = normalizePage(pageNum);
    renderPage();
  }

  // 按鈕顯示的是「按下去會變成什麼」，不是目前狀態
  function updateSpreadLabel() {
    const btn = $('spreadBtn');
    btn.textContent = spread ? '單頁' : '雙頁';
    btn.title = spread ? '切換成單頁 (D)' : '切換成雙頁 (D)';
  }

  function cycleZoomMode() {
    if (zoomMode === 'fit-page') { zoomMode = 'fit-width'; }
    else if (zoomMode === 'fit-width') { zoomMode = 'custom'; customScale = 1; }
    else { zoomMode = 'fit-page'; }
    renderPage();
  }

  /* ---------------- 事件綁定 ---------------- */
  function bindUI() {
    // 書架
    $('uploadBtn').addEventListener('click', () =>
      requireAdmin(openUpload, '上傳新書需要管理密碼。'));

    let rt;
    const onResize = () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        renderShelf();
        if (pdfDoc && zoomMode !== 'custom') renderPage();
      }, 180);
    };
    window.addEventListener('resize', onResize);
    // 書架寬度變了就重算一層放幾本（視窗縮放、捲軸出現、瀏覽器分頁改變大小都算）
    if (window.ResizeObserver) {
      let lastW = 0;
      new ResizeObserver((entries) => {
        const w = Math.round(entries[0].contentRect.width);
        if (w && w !== lastW) { lastW = w; onResize(); }
      }).observe($('shelfRows'));
    }

    // 上傳
    document.querySelectorAll('[data-close-upload]').forEach((b) =>
      b.addEventListener('click', () => { $('uploadModal').hidden = true; }));
    $('uploadForm').addEventListener('submit', doUpload);
    $('fCover').addEventListener('change', (e) => {
      const f = e.target.files[0];
      const box = $('coverPreview');
      if (!f) { box.innerHTML = '<span>封面預覽</span>'; return; }
      const url = URL.createObjectURL(f);
      box.innerHTML = '<img src="' + url + '" alt="">';
    });
    $('fPdf').addEventListener('change', (e) => {
      const files = Array.prototype.slice.call(e.target.files || []);
      updateFileList(files);
    });

    // 編輯書籍
    document.querySelectorAll('[data-close-edit]').forEach((b) =>
      b.addEventListener('click', () => { $('editModal').hidden = true; editing = null; }));
    $('editForm').addEventListener('submit', doEdit);
    $('eCover').addEventListener('change', (e) => {
      const f = e.target.files[0];
      const box = $('eCoverPreview');
      if (!f) return;
      box.innerHTML = '<img src="' + URL.createObjectURL(f) + '" alt="">';
    });

    // 離開管理模式
    $('exitAdmin').addEventListener('click', () => {
      isAdmin = false;
      try { sessionStorage.removeItem('bookshelf:admin'); } catch (e) {}
      updateAdminUI();
      renderShelf();
      toast('已離開管理模式');
    });

    // 密碼
    document.querySelectorAll('[data-close-pw]').forEach((b) =>
      b.addEventListener('click', () => { $('pwModal').hidden = true; pendingAction = null; }));
    $('pwForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if ($('fPassword').value === ADMIN_PASSWORD) {
        isAdmin = true;
        try { sessionStorage.setItem('bookshelf:admin', '1'); } catch (e) {}
        $('pwModal').hidden = true;
        updateAdminUI();
        renderShelf();               // 解鎖後刪除鈕才出現
        const fn = pendingAction; pendingAction = null;
        if (fn) fn();
      } else {
        $('pwError').hidden = false;
      }
    });

    // 閱讀器
    $('closeReader').addEventListener('click', closeReader);
    $('prevPage').addEventListener('click', () => goPage(pageNum - pageStep()));
    $('nextPage').addEventListener('click', () => goPage(pageNum + pageStep()));
    $('edgePrev').addEventListener('click', () => goPage(pageNum - pageStep()));
    $('edgeNext').addEventListener('click', () => goPage(pageNum + pageStep()));
    $('spreadBtn').addEventListener('click', toggleSpread);
    $('zoomIn').addEventListener('click', () => zoomBy(1));
    $('zoomOut').addEventListener('click', () => zoomBy(-1));
    $('zoomLevel').addEventListener('click', cycleZoomMode);
    $('fullscreenBtn').addEventListener('click', toggleFullscreen);

    const jump = () => {
      const v = parseInt(String($('pageInput').value).replace(/[^\d]/g, ''), 10);
      if (isNaN(v)) { $('pageInput').value = pageNum; return; }
      goPage(v);
    };
    $('pageInput').addEventListener('change', jump);
    $('pageInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); jump(); $('pageInput').blur(); }
    });

    // Ctrl + 滾輪縮放
    $('pageHost').addEventListener('wheel', (e) => {
      if (!e.ctrlKey || !pdfDoc) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });

    // 鍵盤
    document.addEventListener('keydown', (e) => {
      if ($('readerView').hidden) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      switch (e.key) {
        case 'Escape': closeReader(); break;
        case 'ArrowLeft': case 'PageUp': e.preventDefault(); goPage(pageNum - pageStep()); break;
        case 'ArrowRight': case 'PageDown': case ' ': e.preventDefault(); goPage(pageNum + pageStep()); break;
        case 'Home': e.preventDefault(); goPage(1); break;
        case 'End': e.preventDefault(); if (pdfDoc) goPage(pdfDoc.numPages); break;
        case '+': case '=': e.preventDefault(); zoomBy(1); break;
        case '-': case '_': e.preventDefault(); zoomBy(-1); break;
        case 'f': case 'F': toggleFullscreen(); break;
        case 'd': case 'D': e.preventDefault(); toggleSpread(); break;
        case 'g': case 'G': e.preventDefault(); $('pageInput').select(); break;
      }
    });
  }

  function toggleFullscreen() {
    const el = $('readerView');
    if (!document.fullscreenElement) {
      (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
