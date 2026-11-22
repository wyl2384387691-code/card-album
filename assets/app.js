/* 卡包相册 · Card Album v2 */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var STORE_KEY = 'cardalbum.store.v2';
  var LEGACY_STORE_KEY = 'cardalbum.store.v1';
  var SCHEMA = 3;
  var PAGE_SIZE = 60;
  var ALL = 'all';
  var UNCAT = 'uncat';
  var FOLDERS = 'folders';
  var TRASH = 'trash';
  var BUCKET_PREFIX = 'bucket:';
  var UNCAT_DROP = '__uncat';
  var ICONS = ['folder', 'suitcase', 'users', 'utensils', 'briefcase', 'star', 'camera', 'image'];
  var FOLDER_COLORS = ['#60769e', '#a78463', '#b9755a', '#748674', '#9a7fa8', '#6f8c92'];
  var DEFAULT_FOLDERS = [];
  var LEGACY_DEFAULT_IDS = { travel: 1, family: 1, food: 1, work: 1 };

  var DEMO_PHOTOS = [
    { id: 'demo-1', type: 'image', name: 'DSC_1024.jpg', date: new Date(2024, 5, 12, 10, 24).getTime(), w: 720, h: 983, src: 'demo-01-mountain-lake.jpg', bucketId: 'b-camera', bucketName: '相机' },
    { id: 'demo-2', type: 'image', name: 'IMG_2047.jpg', date: new Date(2024, 5, 11, 18, 36).getTime(), w: 720, h: 992, src: 'demo-02-sunset-beach.jpg', bucketId: 'b-camera', bucketName: '相机' },
    { id: 'demo-3', type: 'image', name: '肖像_032.jpg', date: new Date(2024, 5, 10, 9, 15).getTime(), w: 720, h: 1001, src: 'demo-03-portrait-girl.jpg', bucketId: 'b-wechat', bucketName: '微信' },
    { id: 'demo-4', type: 'image', name: '美食_08.jpg', date: new Date(2024, 5, 9, 12, 7).getTime(), w: 720, h: 609, src: 'demo-04-pasta.jpg', bucketId: 'b-qq', bucketName: 'QQ' },
    { id: 'demo-5', type: 'image', name: '建筑_256.jpg', date: new Date(2024, 5, 8, 16, 22).getTime(), w: 720, h: 614, src: 'demo-05-santorini.jpg', bucketId: 'b-camera', bucketName: '相机' },
    { id: 'demo-6', type: 'image', name: '人物_12.jpg', date: new Date(2024, 5, 7, 14, 8).getTime(), w: 720, h: 620, src: 'demo-06-fortress.jpg', bucketId: 'b-download', bucketName: '下载' },
    { id: 'demo-7', type: 'image', name: '生活_045.jpg', date: new Date(2024, 5, 6, 11, 33).getTime(), w: 720, h: 647, src: 'demo-07-cafe.jpg', bucketId: 'b-wechat', bucketName: '微信' },
    { id: 'demo-8', type: 'image', name: '樱花_01.jpg', date: new Date(2024, 5, 5, 17, 45).getTime(), w: 720, h: 653, src: 'demo-08-sakura.jpg', bucketId: 'b-camera', bucketName: '相机' },
    { id: 'demo-9', type: 'image', name: '海景_098.jpg', date: new Date(2024, 5, 4, 8, 20).getTime(), w: 720, h: 659, src: 'demo-09-coast.jpg', bucketId: 'b-download', bucketName: '下载' }
  ];

  var state = {
    photos: [],
    folders: [],
    assignments: {},
    folderOrders: {},
    trash: {},
    buckets: [],
    active: UNCAT,
    query: '',
    folderQuery: '',
    sort: 'newest',
    view: 'grid',
    mediaFilter: 'all',
    dateFilter: { year: null, month: null, day: null },
    tab: 'album',
    collapsed: false,
    permission: 'unknown',
    partial: false,
    limitedImages: false,
    limitedVideos: false,
    loading: true,
    error: '',
    demo: false,
    initialized: false,
    filtered: [],
    shown: 0,
    viewerId: null,
    viewerIndex: -1,
    viewerLive: false,
    selectionMode: false,
    selected: {},
    moveIds: [],
    moveFromTrash: false,
    multiMoveIds: [],
    multiMoveSelected: {},
    pendingMoveIds: [],
    editingFolderId: null,
    folderDeleteId: null,
    renameId: null,
    renameBusy: false,
    suppressClickUntil: 0,
    tipDismissed: false,
    tipScheduled: false,
    config: {
      thumbBase: 'content://com.cardalbum.app.photos/thumb/',
      fullBase: 'content://com.cardalbum.app.photos/full/',
      motionBase: 'content://com.cardalbum.app.photos/motion/'
    }
  };

  var els = {};
  var lastFocused = null;
  var toastTimer = 0;
  var tipTimer = 0;
  var searchTimer = 0;
  var scrollRaf = 0;
  var modalStack = [];
  var press = null;
  var drag = null;
  var swipe = null;
  var liveCheckToken = 0;
  var timeDraft = { year: null, month: null, day: null };
  var timeStep = 'year';
  var railDrag = null;
  var folderReorder = null;
  var sidebarAnimTimer = 0;
  var viewerZoom = { scale: 1, x: 0, y: 0, pointers: {}, pinch: null, pan: null };
  var viewerAnimating = false;
  var selectionTouchBlocker = null;
  var reorderTouchBlocker = null;


  function svgIcon(name, cls) {
    return '<svg class="' + (cls || 'icon') + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }
  function safeIcon(name) { return ICONS.indexOf(name) >= 0 ? name : 'folder'; }
  function isNative() { return !!(window.Native && typeof window.Native.init === 'function'); }
  function mobileLayout() { return window.matchMedia('(max-width: 720px)').matches; }
  function now() { return Date.now(); }
  function toast(message, duration) {
    clearTimeout(toastTimer);
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.hidden = false;
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, duration || 2300);
  }

  function haptic(ms) {
    try {
      if (isNative() && window.Native.haptic) { window.Native.haptic(); return; }
      if (navigator.vibrate) navigator.vibrate(ms || 8);
    } catch (e) {}
  }

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function defaultFolders() {
    return DEFAULT_FOLDERS.map(function (f) { return Object.assign({}, f); });
  }

  /* ---------------- persistence ---------------- */

  function normalizeFolders(saved) {
    var result = [];
    var known = {};
    if (Array.isArray(saved)) {
      saved.forEach(function (f) {
        if (!f || typeof f.id !== 'string' || !f.id || f.id === ALL || f.id === UNCAT || f.id === FOLDERS || f.id === 'fav') return;
        if (known[f.id] || result.length >= 40) return;
        var id = f.id;
        var name = (typeof f.name === 'string' && f.name.trim() ? f.name.trim() : '卡包').slice(0, 12);
        result.push({
          id: id,
          name: name,
          icon: safeIcon(f.icon),
          color: f.color || FOLDER_COLORS[result.length % FOLDER_COLORS.length]
        });
        known[id] = true;
      });
    }
    result.forEach(function (f, i) { if (!f.color) f.color = FOLDER_COLORS[i % FOLDER_COLORS.length]; });
    return result;
  }

  function loadPersisted() {
    var raw = null;
    if (isNative()) {
      try { raw = window.Native.loadStore(); } catch (e) {}
    }
    if (!raw) {
      try { raw = localStorage.getItem(STORE_KEY) || localStorage.getItem(LEGACY_STORE_KEY); } catch (e) {}
    }
    if (!raw) return;
    var data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    if (!data || typeof data !== 'object') return;

    var oldSchema = Number(data.schema || 0) < SCHEMA;
    state.folders = normalizeFolders(data.folders);
    if (oldSchema) {
      state.folders = state.folders.filter(function (f) { return !LEGACY_DEFAULT_IDS[f.id]; });
    }
    state.assignments = {};
    if (data.assignments && typeof data.assignments === 'object') {
      Object.keys(data.assignments).forEach(function (id) {
        var raw = data.assignments[id];
        var list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? [raw] : []);
        var valid = [];
        list.forEach(function (folder) {
          if (typeof folder !== 'string' || folder === 'fav' || !findFolder(folder)) return;
          if (valid.indexOf(folder) < 0) valid.push(folder);
        });
        if (valid.length) state.assignments[id] = valid;
      });
    }
    if (data.sort === 'newest' || data.sort === 'oldest' || data.sort === 'name' || data.sort === 'custom') state.sort = data.sort;
    if (data.view === 'grid' || data.view === 'grid5' || data.view === 'list') state.view = data.view;
    if (data.mediaFilter === 'all' || data.mediaFilter === 'image' || data.mediaFilter === 'video'
            || data.mediaFilter === 'animated' || data.mediaFilter === 'live') {
      state.mediaFilter = data.mediaFilter;
    }
    if (data.dateFilter && typeof data.dateFilter === 'object') {
      var df = data.dateFilter;
      var y = Number(df.year), m = Number(df.month), d = Number(df.day);
      if (y > 1900 && y < 3000) state.dateFilter.year = y;
      if (m >= 1 && m <= 12) state.dateFilter.month = m;
      if (d >= 1 && d <= 31) state.dateFilter.day = d;
    }
    if (data.folderOrders && typeof data.folderOrders === 'object') {
      Object.keys(data.folderOrders).forEach(function (fid) {
        if (!findFolder(fid) || !Array.isArray(data.folderOrders[fid])) return;
        state.folderOrders[fid] = data.folderOrders[fid].map(String);
      });
    }
    if (data.trash && typeof data.trash === 'object') {
      Object.keys(data.trash).forEach(function (id) { state.trash[String(id)] = Number(data.trash[id]) || now(); });
    }
    if (typeof data.active === 'string' && !data.active.startsWith('fav')) state.active = data.active;
    if (data.collapsed === true) state.collapsed = true;
    if (data.tipDismissed === true) state.tipDismissed = true;
    if (oldSchema) save();
  }

  function save() {
    var data = {
      folders: state.folders,
      assignments: state.assignments,
      folderOrders: state.folderOrders,
      trash: state.trash,
      sort: state.sort,
      view: state.view,
      mediaFilter: state.mediaFilter,
      dateFilter: state.dateFilter,
      schema: SCHEMA,
      active: state.active,
      collapsed: state.collapsed,
      tipDismissed: state.tipDismissed
    };
    var raw = JSON.stringify(data);
    try { localStorage.setItem(STORE_KEY, raw); } catch (e) {}
    if (isNative()) {
      try { window.Native.saveStore(raw); } catch (e) {}
    }
  }

  function findFolder(id) {
    for (var i = 0; i < state.folders.length; i++) if (state.folders[i].id === id) return state.folders[i];
    return null;
  }

  function folderIdsOf(id) {
    var raw = state.assignments[id];
    var list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? [raw] : []);
    var out = [];
    list.forEach(function (fid) {
      if (typeof fid === 'string' && findFolder(fid) && out.indexOf(fid) < 0) out.push(fid);
    });
    return out;
  }
  function photoInFolder(id, folderId) { return folderIdsOf(id).indexOf(folderId) >= 0; }
  function setPhotoFolders(id, folderIds) {
    var out = [];
    (folderIds || []).forEach(function (fid) {
      if (findFolder(fid) && out.indexOf(fid) < 0) out.push(fid);
    });
    if (out.length) state.assignments[id] = out;
    else delete state.assignments[id];
  }
  function addPhotoFolder(id, folderId) {
    if (!findFolder(folderId)) return false;
    var list = folderIdsOf(id);
    if (list.indexOf(folderId) >= 0) return false;
    list.push(folderId);
    state.assignments[id] = list;
    return true;
  }
  function clearPhotoFolders(id) { delete state.assignments[id]; }
  function photoFolderLabel(id) {
    var list = folderIdsOf(id);
    if (!list.length) return '未分类';
    if (list.length === 1) return folderName(list[0]);
    return folderName(list[0]) + ' +' + (list.length - 1);
  }
  function folderName(id) {
    var f = findFolder(id);
    return f ? f.name : '未分类';
  }
  function photoFolderId(id) {
    var list = folderIdsOf(id);
    return list.length ? list[0] : UNCAT;
  }
  function photoById(id) {
    for (var i = 0; i < state.photos.length; i++) if (state.photos[i].id === id) return state.photos[i];
    return null;
  }
  function isVideo(p) { return p && p.type === 'video'; }

  function normalizePhoto(p) {
    if (!p || p.id === undefined || p.id === null) return null;
    var date = Number(p.date);
    if (!isFinite(date) || date < 0) date = 0;
    var type = p.type === 'video' || String(p.id).startsWith('v') ? 'video' : 'image';
    return {
      id: String(p.id),
      type: type,
      name: String(p.name || (type === 'video' ? '未命名视频' : '未命名照片')),
      date: date,
      w: Number(p.w) || 0,
      h: Number(p.h) || 0,
      size: Number(p.size) || 0,
      mime: String(p.mime || (type === 'video' ? 'video/mp4' : 'image/jpeg')),
      bucketId: String(p.bucketId || p.bucket_id || ''),
      bucketName: String(p.bucketName || p.bucket_display_name || '其他'),
      duration: Number(p.duration) || 0,
      animated: !!p.animated,
      motion: !!p.motion,
      src: typeof p.src === 'string' ? p.src : ''
    };
  }

  function dedupePhotos(list) {
    var seen = {};
    var out = [];
    list.forEach(function (p) {
      var n = normalizePhoto(p);
      if (!n || seen[n.id]) return;
      seen[n.id] = true;
      out.push(n);
    });
    return out;
  }

  function migrateAssignments() {
    var byId = {};
    state.photos.forEach(function (p) { byId[p.id] = true; });
    var next = {};
    Object.keys(state.assignments).forEach(function (id) {
      var list = folderIdsOf(id);
      if (!list.length) return;
      var target = byId[id] ? id : (byId['i' + id] ? 'i' + id : null);
      if (target) next[target] = list;
    });
    state.assignments = next;
    Object.keys(state.selected || {}).forEach(function (id) {
      if (!byId[id]) delete state.selected[id];
    });
    if (state.selectionMode && !Object.keys(state.selected).length) state.selectionMode = false;
  }

  /* ---------------- date / url ---------------- */

  function dateParts(ms) {
    var d = new Date(Number(ms) || 0);
    if (isNaN(d.getTime())) return { date: '', time: '', year: 0, month: 0 };
    return {
      date: d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()),
      time: pad2(d.getHours()) + ':' + pad2(d.getMinutes()),
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate()
    };
  }
  function photoParts(p) { return dateParts(p && p.date || 0); }
  function hasDateFilter() { return !!(state.dateFilter && state.dateFilter.year); }
  function dateFilterLabel() {
    var f = state.dateFilter;
    if (!f || !f.year) return '';
    var out = f.year + '年';
    if (f.month) out += f.month + '月';
    if (f.month && f.day) out += f.day + '日';
    return out;
  }
  function dateFilterMetaLabel() {
    var f = state.dateFilter;
    if (!f || !f.year) return '';
    var out = String(f.year);
    if (f.month) out += '/' + f.month;
    if (f.month && f.day) out += '/' + f.day;
    return out;
  }
  function matchesDateFilter(p) {
    if (!hasDateFilter()) return true;
    var d = photoParts(p);
    if (d.year !== state.dateFilter.year) return false;
    if (state.dateFilter.month && d.month !== state.dateFilter.month) return false;
    if (state.dateFilter.day && d.day !== state.dateFilter.day) return false;
    return true;
  }
  function clearDateFilter() {
    state.dateFilter = { year: null, month: null, day: null };
  }

  function fullDate(ms) {
    var p = dateParts(ms);
    return p.date ? p.date + '  ' + p.time : '';
  }
  function monthKey(ms) {
    var p = dateParts(ms);
    return p.date ? p.year + '-' + pad2(p.month) : '';
  }
  function monthLabel(key) {
    if (key === 'all') return '全部月份';
    var parts = String(key).split('-');
    return parts[0] + '年' + parseInt(parts[1], 10) + '月';
  }
  function formatDuration(ms) {
    var total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    var m = Math.floor(total / 60), s = total % 60;
    return m + ':' + pad2(s);
  }

  function thumbUrl(p) {
    if (p.src) return p.src;
    return state.config.thumbBase + encodeURIComponent(p.id) + '?v=' + encodeURIComponent(String(p.date || 0) + '3');
  }
  function fullUrl(p) {
    if (p.src) return p.src;
    return state.config.fullBase + encodeURIComponent(p.id);
  }
  function typeLabel(p) {
    if (isVideo(p)) return '视频';
    if (p.animated) return '动图';
    return '图片';
  }
  function mediaUnit(pool) {
    if (state.mediaFilter === 'image' || state.mediaFilter === 'animated' || state.mediaFilter === 'live') return '张';
    if (state.mediaFilter === 'video') return '个';
    return '项';
  }

  /* ---------------- media pools / counts ---------------- */

  function mediaPool() {
    return state.photos.filter(function (p) {
      if (photoInTrash(p.id)) return false;
      if (state.mediaFilter === 'image' && p.type !== 'image') return false;
      if (state.mediaFilter === 'video' && p.type !== 'video') return false;
      if (state.mediaFilter === 'animated' && !(p.type === 'image' && p.animated)) return false;
      if (state.mediaFilter === 'live' && !(p.type === 'image' && p.motion)) return false;
      if (!matchesDateFilter(p)) return false;
      return true;
    });
  }

  function bucketDisplayName(name) {
    var n = String(name || '其他').trim();
    var lower = n.toLowerCase();
    var map = {
      camera: '相机', dcim: '相机', download: '下载', downloads: '下载',
      screenshots: '截图', screenshot: '截图', movies: '视频', video: '视频',
      pictures: '图片', wechat: '微信', weixin: '微信', qq: 'QQ', douyin: '抖音', cardalbum: '卡包'
    };
    if (map[lower]) return map[lower];
    return n || '其他';
  }

  function bucketOrder(name) {
    var n = bucketDisplayName(name).toLowerCase();
    var known = ['微信', 'qq', '下载', '抖音', '相机', '视频', '截图'];
    for (var i = 0; i < known.length; i++) if (n.indexOf(known[i].toLowerCase()) >= 0) return i;
    return 99;
  }

  function counts(pool) {
    var map = {};
    var classified = 0;
    state.folders.forEach(function (f) { map[f.id] = 0; });
    var bucketMap = {};
    pool.forEach(function (p) {
      var fids = folderIdsOf(p.id);
      if (fids.length) classified += 1;
      fids.forEach(function (fid) {
        if (Object.prototype.hasOwnProperty.call(map, fid)) map[fid] += 1;
      });
      var key = p.bucketId || ('n:' + p.bucketName);
      if (!bucketMap[key]) bucketMap[key] = { id: key, name: p.bucketName || '其他', count: 0, items: [] };
      bucketMap[key].count += 1;
      bucketMap[key].items.push(p);
    });
    var buckets = Object.keys(bucketMap).map(function (k) { return bucketMap[k]; });
    buckets.forEach(function (b) {
      b.items.sort(function (a, c) { return (c.date || 0) - (a.date || 0); });
      b.latest = b.items.slice(0, 4);
    });
    buckets.sort(function (a, b) {
      var oa = bucketOrder(a.name), ob = bucketOrder(b.name);
      if (oa !== ob) return oa - ob;
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
    return { map: map, uncat: Math.max(0, pool.length - classified), buckets: buckets, trash: trashCount() };
  }

  function bucketById(id) {
    for (var i = 0; i < state.buckets.length; i++) if (state.buckets[i].id === id) return state.buckets[i];
    return null;
  }

  function isFolderActive() { return !!findFolder(state.active); }
  function isTrashActive() { return state.active === TRASH; }
  function photoInTrash(id) { return Object.prototype.hasOwnProperty.call(state.trash, String(id)); }
  function trashCount() { return state.photos.filter(function (p) { return photoInTrash(p.id); }).length; }
  function isBucketActive() { return String(state.active).indexOf(BUCKET_PREFIX) === 0; }
  function activeBucket() { return isBucketActive() ? bucketById(state.active.slice(BUCKET_PREFIX.length)) : null; }

  function trashPool() {
    return state.photos.filter(function (p) {
      if (!photoInTrash(p.id)) return false;
      if (state.mediaFilter === 'image' && p.type !== 'image') return false;
      if (state.mediaFilter === 'video' && p.type !== 'video') return false;
      if (state.mediaFilter === 'animated' && !(p.type === 'image' && p.animated)) return false;
      if (state.mediaFilter === 'live' && !(p.type === 'image' && p.motion)) return false;
      return matchesDateFilter(p);
    });
  }

  function getFiltered() {
    var pool = isTrashActive() ? trashPool() : mediaPool();
    var list = pool;
    if (isTrashActive()) {
      list = pool;
    } else if (state.active === UNCAT) {
      list = pool.filter(function (p) { return !folderIdsOf(p.id).length; });
    } else if (isFolderActive()) {
      list = pool.filter(function (p) { return photoInFolder(p.id, state.active); });
    } else if (isBucketActive()) {
      var key = state.active.slice(BUCKET_PREFIX.length);
      list = pool.filter(function (p) { return (p.bucketId || ('n:' + p.bucketName)) === key; });
    } else if (state.active === FOLDERS) {
      list = [];
    }
    if (state.query.trim()) {
      var q = state.query.trim().toLowerCase();
      list = list.filter(function (p) {
        return p.name.toLowerCase().indexOf(q) >= 0 || p.bucketName.toLowerCase().indexOf(q) >= 0;
      });
    }
    list = list.slice();
    if (isFolderActive() && state.sort === 'custom' && state.folderOrders[state.active]) {
      var order = state.folderOrders[state.active];
      var pos = {};
      order.forEach(function (id, i) { pos[id] = i; });
      list.sort(function (a, b) {
        var ia = Object.prototype.hasOwnProperty.call(pos, a.id) ? pos[a.id] : 1e9;
        var ib = Object.prototype.hasOwnProperty.call(pos, b.id) ? pos[b.id] : 1e9;
        if (ia !== ib) return ia - ib;
        return comparePhotos(a, b);
      });
    } else {
      list.sort(comparePhotos);
    }
    return list;
  }

  function comparePhotos(a, b) {
    if (state.sort === 'name') return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
    if (state.sort === 'oldest') return (a.date || 0) - (b.date || 0);
    return (b.date || 0) - (a.date || 0);
  }

  /* ---------------- boot ---------------- */

  function boot() {
    els = {
      app: $('#app'), content: $('#content'), sidebar: $('#sidebar'),
      sideNav: $('#sideNav'), folderSearch: $('#folderSearch'),
      viewTitle: $('#viewTitle'), viewMeta: $('#viewMeta'), editFolderBtn: $('#editFolderBtn'), shareFolderBtn: $('#shareFolderBtn'),
      grid: $('#grid'), foldersBoard: $('#foldersBoard'), emptyState: $('#emptyState'),
      loadingState: $('#loadingState'), bannerStack: $('#bannerStack'), sentinel: $('#sentinel'),
      boardSearchWrap: $('#boardSearchWrap'), boardSearch: $('#boardSearch'),
      timeFilterModal: $('#timeFilterModal'), timeFilterTitle: $('#timeFilterTitle'), timeFilterHint: $('#timeFilterHint'),
      timeFilterList: $('#timeFilterList'), timeFilterClear: $('#timeFilterClear'), timeFilterBack: $('#timeFilterBack'), timeFilterNext: $('#timeFilterNext'),
      timeFilterLabel: $('#timeFilterLabel'),
      bottomNav: $('#bottomNav'), placeholderPage: $('#placeholderPage'), placeholderTitle: $('#placeholderTitle'), mePage: $('#mePage'),
      scrollRail: $('#scrollRail'), scrollThumb: $('#scrollThumb'),
      selectionBar: $('#selectionBar'), selectionCount: $('#selectionCount'), selectionHint: $('#selectionHint'),
      selectAllBtn: $('#selectAllBtn'), moveSelectedBtn: $('#moveSelectedBtn'), removeSelectedBtn: $('#removeSelectedBtn'), deleteSelectedBtn: $('#deleteSelectedBtn'), restoreTrashBtn: $('#restoreTrashBtn'), purgeTrashBtn: $('#purgeTrashBtn'), exitSelectionBtn: $('#exitSelectionBtn'),
      filterBtn: $('#filterBtn'), filterLabel: $('#filterLabel'), filterMenu: $('#filterMenu'),
      sortBtn: $('#sortBtn'), sortLabel: $('#sortLabel'), sortMenu: $('#sortMenu'),
      viewBtn: $('#viewBtn'), viewIcon: $('#viewIcon'), searchBtn: $('#searchBtn'),
      searchRow: $('#searchRow'), searchInput: $('#searchInput'), searchClear: $('#searchClear'),
      sidebarToggle: $('#sidebarToggle'), tipBtn: $('#tipBtn'), appMenu: $('#appMenu'),
      viewer: $('#viewer'), viewerCanvas: $('#viewerCanvas'), viewerImage: $('#viewerImage'), viewerVideo: $('#viewerVideo'),
      viewerName: $('#viewerName'), viewerDate: $('#viewerDate'), viewerFolder: $('#viewerFolder'),
      viewerFolderName: $('#viewerFolderName'), viewerCount: $('#viewerCount'), viewerLoading: $('#viewerLoading'),
      viewerClose: $('#viewerClose'), viewerShare: $('#viewerShare'), viewerStage: $('#viewerStage'),
      viewerPrev: $('#viewerPrev'), viewerNext: $('#viewerNext'), viewerLiveBtn: $('#viewerLiveBtn'),
      viewerRemovePackBtn: $('#viewerRemovePackBtn'),
      videoControls: $('#videoControls'), videoPlayBtn: $('#videoPlayBtn'), videoProgress: $('#videoProgress'), videoTime: $('#videoTime'), videoMuteBtn: $('#videoMuteBtn'),
      moveModal: $('#moveModal'), moveTitle: $('#moveTitle'), moveList: $('#moveList'), moveNewFolder: $('#moveNewFolder'), moveMulti: $('#moveMulti'),
      multiMoveModal: $('#multiMoveModal'), multiMoveList: $('#multiMoveList'), multiMoveClear: $('#multiMoveClear'), multiMoveSave: $('#multiMoveSave'),
      folderModal: $('#folderModal'), folderEyebrow: $('#folderEyebrow'), folderTitle: $('#folderTitle'),
      folderNameInput: $('#folderNameInput'), iconChoices: $('#iconChoices'),
      saveFolderBtn: $('#saveFolderBtn'), deleteFolderBtn: $('#deleteFolderBtn'),
      folderDeleteModal: $('#folderDeleteModal'), folderDeleteCopy: $('#folderDeleteCopy'), confirmDeleteFolderBtn: $('#confirmDeleteFolderBtn'),
      renameModal: $('#renameModal'), renameInput: $('#renameInput'), saveRenameBtn: $('#saveRenameBtn'),
      aboutModal: $('#aboutModal'), tipToast: $('#tipToast'), toast: $('#toast'),
    };

    loadPersisted();
    applySidebarState();
    buildIconChoices();
    bindEvents();
    updateToolControls();
    renderAll({ resetScroll: true });

    if (isNative()) {
      try {
        var cfg = window.Native.getConfig();
        if (cfg) {
          var parsed = JSON.parse(cfg);
          if (parsed.thumbBase) state.config.thumbBase = parsed.thumbBase;
          if (parsed.fullBase) state.config.fullBase = parsed.fullBase;
          if (parsed.motionBase) state.config.motionBase = parsed.motionBase;
        }
      } catch (e) {}
      state.permission = 'requesting';
      state.loading = true;
      renderAll({ resetScroll: false });
      try { window.Native.init(); } catch (e) {
        state.loading = false;
        state.error = '读取相册失败，请重新打开应用。';
        renderAll({});
      }
    } else {
      state.demo = true;
      requireDemo();
    }
  }

  function requireDemo() {
    setTimeout(function () {
      state.photos = dedupePhotos(DEMO_PHOTOS);
      state.demo = true;
      if (!state.folders.length) {
        state.folders = [
          { id: 'demo-travel', name: '旅行', icon: 'suitcase', color: FOLDER_COLORS[0] },
          { id: 'demo-family', name: '家人', icon: 'users', color: FOLDER_COLORS[1] },
          { id: 'demo-food', name: '美食', icon: 'utensils', color: FOLDER_COLORS[2] },
          { id: 'demo-work', name: '工作', icon: 'briefcase', color: FOLDER_COLORS[3] }
        ];
      }
      if (Object.keys(state.assignments).length === 0) {
        state.assignments = {
          'demo-1': ['demo-travel'], 'demo-2': ['demo-travel'],
          'demo-5': ['demo-family'], 'demo-4': ['demo-food'], 'demo-7': ['demo-work']
        };
      }
      if (!state.active || state.active === UNCAT) state.active = ALL;
      state.permission = 'granted';
      state.loading = false;
      state.initialized = true;
      renderAll({ resetScroll: true });
    }, 280);
  }

  function applySidebarState() {
    els.app.classList.toggle('sidebar-collapsed', state.collapsed);
    els.sidebarToggle.setAttribute('aria-expanded', state.collapsed ? 'false' : 'true');
  }

  /* ---------------- rendering ---------------- */

  function renderAll(opts) {
    opts = opts || {};
    var pool = mediaPool();
    var c = counts(pool);
    state.buckets = c.buckets;
    validateActive();
    if (!isFolderActive() && state.sort === 'custom') state.sort = 'newest';
    var filtered = getFiltered();
    state.filtered = filtered;
    renderHeader(pool, filtered, c);
    renderSidebar(c);
    renderBanners();
    renderContent(filtered, c, opts);
    updateToolControls();
    updateSelectionUI();
    if (state.viewerId) syncViewer();
    if (!state.demo) maybeTip();
    requestAnimationFrame(updateScrollRail);
  }

  function validateActive() {
    if (state.active === ALL || state.active === UNCAT || state.active === FOLDERS || state.active === TRASH) return;
    if (isBucketActive()) {
      if (!bucketById(state.active.slice(BUCKET_PREFIX.length))) state.active = ALL;
      return;
    }
    if (!findFolder(state.active)) state.active = UNCAT;
  }

  function renderHeader(pool, filtered, c) {
    var title = '未分类';
    if (state.active === ALL) {
      title = state.mediaFilter === 'image' ? '全部图片'
        : state.mediaFilter === 'video' ? '全部视频'
        : state.mediaFilter === 'animated' ? '全部动图'
        : state.mediaFilter === 'live' ? '全部实况'
        : '全部照片';
    } else if (state.active === FOLDERS) title = '卡包集合';
    else if (state.active === TRASH) title = '垃圾桶';
    else if (isFolderActive()) title = folderName(state.active);
    else if (isBucketActive()) {
      var b = activeBucket();
      title = b ? bucketDisplayName(b.name) : '手机图集';
    }
    els.viewTitle.textContent = title;
    els.viewTitle.title = title;
    els.editFolderBtn.hidden = !isFolderActive();
    if (isFolderActive()) els.editFolderBtn.dataset.folderId = state.active;
    if (els.shareFolderBtn) {
      els.shareFolderBtn.hidden = !isFolderActive();
      if (isFolderActive()) els.shareFolderBtn.dataset.folderId = state.active;
    }

    var meta = '';
    if (state.permission === 'denied' || state.permission === 'blocked') meta = '尚未获得照片和视频访问权限';
    else if (state.loading && !state.photos.length) meta = '正在读取相册…';
    else if (state.error && !state.photos.length) meta = '读取相册失败';
    else if (state.active === FOLDERS) meta = state.folders.length + ' 个卡包 · ' + c.buckets.length + ' 个手机图集';
    else if (state.active === TRASH) meta = filtered.length + ' 项 · 移出后可重新归类';
    else if (state.query.trim()) meta = '找到 ' + filtered.length + ' ' + mediaUnit(pool);
    else {
      var typeText = state.mediaFilter === 'image' ? '张图片'
        : state.mediaFilter === 'video' ? '个视频'
        : state.mediaFilter === 'animated' ? '张动图'
        : state.mediaFilter === 'live' ? '张实况'
        : '项媒体';
      meta = filtered.length + ' ' + typeText;
      if (hasDateFilter()) meta += ' · ' + dateFilterMetaLabel();
      if (state.active === UNCAT) meta += ' · 待整理';
    }
    if (state.partial && state.photos.length) meta += ' · 部分访问';
    els.viewMeta.textContent = meta;
  }

  function navRow(opts) {
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'nav-row' + (opts.bucket ? ' nav-bucket' : '');
    if (opts.folderId) {
      row.dataset.view = 'folder';
      row.dataset.id = opts.folderId;
      row.classList.add('folder-row');
    } else if (opts.bucket) {
      row.dataset.view = 'bucket';
      row.dataset.bucket = opts.bucket;
    } else {
      row.dataset.view = opts.view;
    }
    if (opts.drop !== undefined) row.dataset.dropFolder = opts.drop;
    var iconWrap = document.createElement('span');
    iconWrap.className = 'nav-icon';
    iconWrap.innerHTML = svgIcon(opts.icon);
    var label = document.createElement('span');
    label.className = 'nav-label';
    if (opts.longLabel && opts.longLabel !== opts.label) {
      var l = document.createElement('span'); l.className = 'label-long'; l.textContent = opts.longLabel;
      var s = document.createElement('span'); s.className = 'label-short'; s.textContent = opts.label;
      label.appendChild(l); label.appendChild(s);
    } else {
      label.textContent = opts.label;
    }
    var count = document.createElement('span');
    count.className = 'nav-count' + (Number(opts.count) === 0 ? ' is-zero' : '');
    count.textContent = String(opts.count || 0);
    row.appendChild(iconWrap);
    row.appendChild(label);
    row.appendChild(count);
    var active = false;
    if (opts.folderId) active = state.active === opts.folderId;
    else if (opts.bucket) active = state.active === (BUCKET_PREFIX + opts.bucket);
    else active = state.active === opts.view;
    if (active) {
      row.classList.add('active');
      row.setAttribute('aria-current', 'page');
    }
    return row;
  }

  function renderSidebar(c) {
    var q = state.folderQuery.trim().toLowerCase();
    els.sideNav.innerHTML = '';
    els.sideNav.appendChild(navRow({ view: ALL, label: '全部', longLabel: '全部媒体', icon: 'image', count: mediaPool().length }));
    els.sideNav.appendChild(navRow({ view: UNCAT, label: '未分类', icon: 'image', count: c.uncat, drop: UNCAT_DROP }));
    els.sideNav.appendChild(navRow({ view: FOLDERS, label: '卡包集合', icon: 'folder-open', count: state.folders.length }));
    els.sideNav.appendChild(navRow({ view: TRASH, label: '垃圾桶', icon: 'trash', count: c.trash || 0 }));

    var title = document.createElement('div');
    title.className = 'nav-section-title';
    title.textContent = '我的卡包';
    els.sideNav.appendChild(title);

    var folders = state.folders.filter(function (f) { return !q || f.name.toLowerCase().indexOf(q) >= 0; });
    if (folders.length) {
      var wrap = document.createElement('div');
      wrap.className = 'folder-nav';
      folders.forEach(function (f) {
        wrap.appendChild(navRow({ folderId: f.id, label: f.name, icon: f.icon, count: c.map[f.id] || 0, drop: f.id }));
      });
      els.sideNav.appendChild(wrap);
    } else {
      var empty = document.createElement('div');
      empty.className = 'side-empty';
      empty.textContent = q ? '没有匹配的卡包' : '还没有卡包';
      els.sideNav.appendChild(empty);
    }

    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'nav-row new-folder-row';
    add.id = 'newFolderBtn';
    add.dataset.view = 'new-folder';
    add.innerHTML = '<span class="nav-icon">' + svgIcon('folder-plus') + '</span><span class="nav-label">新建卡包</span>';
    els.sideNav.appendChild(add);

    var buckets = c.buckets.filter(function (b) {
      return !q || bucketDisplayName(b.name).toLowerCase().indexOf(q) >= 0 || b.name.toLowerCase().indexOf(q) >= 0;
    });
    if (buckets.length) {
      var bt = document.createElement('div');
      bt.className = 'nav-section-title';
      bt.textContent = '手机图集';
      els.sideNav.appendChild(bt);
      var bwrap = document.createElement('div');
      bwrap.className = 'folder-nav';
      buckets.forEach(function (b) {
        bwrap.appendChild(navRow({
          bucket: b.id, label: bucketDisplayName(b.name), icon: (b.name.toLowerCase().indexOf('video') >= 0 || b.name.indexOf('视频') >= 0) ? 'video' : 'camera',
          count: b.count, drop: undefined
        }));
      });
      els.sideNav.appendChild(bwrap);
    }
  }

  function renderBanners() {
    els.bannerStack.innerHTML = '';
    if (state.partial) {
      var b = document.createElement('div');
      b.className = 'banner';
      b.innerHTML = '<span class="banner-icon">' + svgIcon('lock') + '</span>' +
        '<span class="text">仅显示你允许访问的照片和视频，可以随时扩大范围。</span>' +
        '<button type="button" data-banner="permission">管理</button>';
      els.bannerStack.appendChild(b);
    } else if (!state.loading && (state.limitedImages || state.limitedVideos)) {
      var l = document.createElement('div');
      l.className = 'banner';
      var missing = state.limitedVideos && !state.limitedImages ? '视频' : state.limitedImages && !state.limitedVideos ? '图片' : '部分媒体';
      l.innerHTML = '<span class="banner-icon">' + svgIcon('lock') + '</span>' +
        '<span class="text">尚未获得' + missing + '访问权限，只显示已授权的内容。</span>' +
        '<button type="button" data-banner="permission">授权</button>';
      els.bannerStack.appendChild(l);
    }
    if (state.error && state.photos.length) {
      var e = document.createElement('div');
      e.className = 'banner';
      e.innerHTML = '<span class="banner-icon">' + svgIcon('info') + '</span>' +
        '<span class="text">' + escapeHtml(state.error) + '</span>' +
        '<button type="button" data-banner="refresh">重试</button>';
      els.bannerStack.appendChild(e);
    }
  }

  function renderContent(filtered, c, opts) {
    var permissionBlocked = state.permission === 'denied' || state.permission === 'blocked';
    var loadingBlocking = state.loading && state.photos.length === 0 && !permissionBlocked;
    els.loadingState.hidden = !loadingBlocking;
    if (loadingBlocking) {
      els.grid.innerHTML = '';
      els.grid.hidden = true;
      els.foldersBoard.hidden = true;
      els.emptyState.hidden = true;
      return;
    }
    if (state.active === FOLDERS) {
      els.boardSearchWrap.hidden = false;
      if (document.activeElement !== els.boardSearch) els.boardSearch.value = state.folderQuery;
      els.grid.hidden = true;
      els.grid.innerHTML = '';
      els.emptyState.hidden = true;
      els.foldersBoard.hidden = false;
      renderFoldersOverview(c);
      state.shown = 0;
      if (opts.resetScroll) els.content.scrollTop = 0;
      return;
    }
    els.foldersBoard.hidden = true;
    els.boardSearchWrap.hidden = true;
    els.grid.hidden = false;
    if (!filtered.length) {
      els.grid.innerHTML = '';
      els.emptyState.hidden = false;
      renderEmpty(permissionBlocked);
      state.shown = 0;
      return;
    }
    els.emptyState.hidden = true;
    els.grid.innerHTML = '';
    els.grid.classList.toggle('list-view', state.view === 'list');
    els.grid.classList.toggle('grid5', state.view === 'grid5');
    state.shown = 0;
    appendPage();
    if (opts.resetScroll) els.content.scrollTop = 0;
  }

  function appendPage() {
    if (state.shown >= state.filtered.length) return;
    var frag = document.createDocumentFragment();
    var end = Math.min(state.shown + PAGE_SIZE, state.filtered.length);
    for (var i = state.shown; i < end; i++) frag.appendChild(photoCard(state.filtered[i]));
    els.grid.appendChild(frag);
    state.shown = end;
  }

  function photoCard(p) {
    var card = document.createElement('article');
    card.className = 'photo-card' + (state.selected[p.id] ? ' selected' : '');
    card.dataset.photoId = p.id;
    card.dataset.mediaType = p.type;
    card.tabIndex = 0;
    card.setAttribute('role', 'listitem');
    card.setAttribute('aria-label', p.name + (isVideo(p) ? '，视频' : ''));

    var wrap = document.createElement('div');
    wrap.className = 'thumb-wrap';
    var img = document.createElement('img');
    img.className = 'thumb';
    img.alt = p.name;
    img.loading = 'lazy';
    img.decoding = 'async';
    var fallback = document.createElement('div');
    fallback.className = 'thumb-fallback';
    fallback.innerHTML = svgIcon(isVideo(p) ? 'video' : 'image');
    wrap.appendChild(img);
    wrap.appendChild(fallback);

    var check = document.createElement('span');
    check.className = 'select-check';
    check.innerHTML = svgIcon('check');
    wrap.appendChild(check);

    if (isVideo(p)) {
      var vb = document.createElement('span');
      vb.className = 'media-badge';
      vb.innerHTML = svgIcon('play') + '<span>' + formatDuration(p.duration) + '</span>';
      wrap.appendChild(vb);
    } else if (p.animated) {
      var ab = document.createElement('span');
      ab.className = 'media-badge animated';
      ab.innerHTML = svgIcon('live') + '<span>动图</span>';
      wrap.appendChild(ab);
    } else if (p.motion) {
      var lb = document.createElement('span');
      lb.className = 'media-badge live';
      lb.innerHTML = svgIcon('live') + '<span>实况</span>';
      wrap.appendChild(lb);
    }

    var meta = document.createElement('div');
    meta.className = 'photo-meta';
    var name = document.createElement('div');
    name.className = 'photo-name';
    name.textContent = p.name;
    var parts = dateParts(p.date);
    var date = document.createElement('div');
    date.className = 'photo-date';
    var dateSpan = document.createElement('span'); dateSpan.textContent = parts.date;
    var timeSpan = document.createElement('span'); timeSpan.className = 'time'; timeSpan.textContent = ' ' + parts.time;
    date.appendChild(dateSpan); date.appendChild(timeSpan);
    meta.appendChild(name); meta.appendChild(date);

    var folder = document.createElement('div');
    folder.className = 'row-folder';
    var fid = photoFolderId(p.id);
    folder.innerHTML = svgIcon(fid === UNCAT ? 'image' : (findFolder(fid) || {}).icon || 'folder');
    var fspan = document.createElement('span'); fspan.textContent = photoFolderLabel(p.id); folder.appendChild(fspan);
    var chev = document.createElement('div');
    chev.className = 'row-chevron';
    chev.innerHTML = svgIcon('chevron-right');

    card.appendChild(wrap);
    card.appendChild(meta);
    if (state.view === 'list') {
      card.appendChild(folder);
      card.appendChild(chev);
    }
    card._photo = p;

    img.addEventListener('load', function () { wrap.classList.add('loaded'); });
    img.addEventListener('error', function () { thumbError(img, p.id); });
    img.src = thumbUrl(p);
    if (img.complete && img.naturalWidth) wrap.classList.add('loaded');

    card.addEventListener('click', function (e) {
      if (now() < state.suppressClickUntil) { e.preventDefault(); return; }
      if (state.selectionMode) { toggleSelect(p.id); return; }
      openViewer(p.id);
    });
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (state.selectionMode) toggleSelect(p.id); else openViewer(p.id);
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (isTrashActive()) requestDelete(p.id); else moveToTrash([p.id]); }
    });
    card.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      openMove([p.id]);
    });
    bindCardPress(card, p);
    return card;
  }

  function thumbError(img, id) {
    if (img.dataset.fallbackTried === '1') {
      var w = img.parentNode;
      if (w) w.classList.add('broken');
      return;
    }
    img.dataset.fallbackTried = '1';
    if (isNative() && window.Native.getThumbData) {
      try {
        var data = window.Native.getThumbData(String(id));
        if (data && data.indexOf('data:image') === 0) {
          img.src = data;
          return;
        }
      } catch (e) {}
    }
    var wrap = img.parentNode;
    if (wrap) wrap.classList.add('broken');
  }

  function renderEmpty(permissionBlocked) {
    var art = '<div class="empty-art"><div class="e-glow"></div>' +
      '<div class="e-card one">' + svgIcon(state.mediaFilter === 'video' ? 'video' : 'image') + '</div>' +
      '<div class="e-card two">' + svgIcon('folder') + '</div>' +
      '<div class="e-folder">' + svgIcon(permissionBlocked ? 'lock' : 'folder') + '</div></div>';
    var title = '', copy = '', action = '', hint = '';
    if (permissionBlocked) {
      title = '让卡包看到你的照片和视频';
      copy = '读取相册后，才能把照片和视频整理进卡包。所有内容只在本机访问，不会上传。';
      action = '<button class="empty-btn" type="button" data-empty-action="permission">' + svgIcon('lock') + '<span>' +
        (state.permission === 'blocked' ? '打开系统设置' : '允许访问') + '</span></button>' +
        '<div class="empty-hint">' + svgIcon('lock') + '<span>内容始终留在你的设备上</span></div>';
    } else if (state.error && !state.photos.length) {
      title = '相册暂时打不开';
      copy = state.error;
      action = '<button class="empty-btn" type="button" data-empty-action="refresh">' + svgIcon('refresh') + '<span>重新读取</span></button>';
    } else if (state.query.trim()) {
      title = '没有找到匹配的内容';
      copy = '换一个名称关键词，或者清空搜索查看全部内容。';
      action = '<button class="empty-btn secondary" type="button" data-empty-action="clear-search">' + svgIcon('close') + '<span>清空搜索</span></button>';
    } else if (!state.photos.length) {
      title = '相册里还没有内容';
      copy = '拍几张照片或视频，保存到手机后再回来看看。';
      action = '<button class="empty-btn secondary" type="button" data-empty-action="refresh">' + svgIcon('refresh') + '<span>刷新相册</span></button>';
      hint = '<div class="empty-hint">' + svgIcon('image') + '<span>支持 JPG、PNG、WebP、GIF 和常见视频格式</span></div>';
    } else if (hasDateFilter() || state.mediaFilter !== 'all') {
      title = '这个筛选下没有内容';
      copy = '换一个时间范围或媒体类型看看。';
      action = '<button class="empty-btn secondary" type="button" data-empty-action="clear-filter">' + svgIcon('filter') + '<span>清除筛选</span></button>';
    } else if (state.active === TRASH) {
      title = '垃圾桶是空的';
      copy = '删除的照片和视频会先放在这里；在垃圾桶内多选后可恢复或彻底删除。';
      action = '<button class="empty-btn secondary" type="button" data-empty-action="all">' + svgIcon('image') + '<span>回到全部照片</span></button>';
    } else if (state.active === UNCAT) {
      title = '内容都整理好啦';
      copy = '未分类里已经空了。去左侧卡包或卡包集合看看。';
      action = '<button class="empty-btn secondary" type="button" data-empty-action="folders">' + svgIcon('folder-open') + '<span>打开卡包集合</span></button>';
    } else {
      title = '这里还是空的';
      copy = '长按进入多选，再把内容拖进左侧卡包；也可以点开内容后使用卡包标签。';
      action = '<button class="empty-btn secondary" type="button" data-empty-action="all">' + svgIcon('image') + '<span>去挑内容</span></button>';
      hint = '<div class="empty-hint">' + svgIcon('select-all') + '<span>长按即可进入多选</span></div>';
    }
    els.emptyState.innerHTML = art + '<div class="empty-title">' + escapeHtml(title) + '</div>' +
      '<div class="empty-copy">' + escapeHtml(copy) + '</div>' + action + hint;
  }

  function renderFoldersOverview(c) {
    els.foldersBoard.innerHTML = '';
    var q = state.folderQuery.trim().toLowerCase();
    var title = document.createElement('div');
    title.className = 'folders-section-title';
    title.textContent = '我的卡包';
    els.foldersBoard.appendChild(title);

    state.folders.filter(function (f) { return !q || f.name.toLowerCase().indexOf(q) >= 0; }).forEach(function (f) {
      var items = mediaPool().filter(function (p) { return photoInFolder(p.id, f.id); })
        .sort(function (a, b) { return (b.date || 0) - (a.date || 0); }).slice(0, 4);
      els.foldersBoard.appendChild(folderOverviewCard(f, items, c.map[f.id] || 0));
    });
    if (!q) {
      var add = document.createElement('button');
      add.type = 'button';
      add.className = 'folder-ov-card folder-ov-new';
      add.innerHTML = svgIcon('folder-plus') + '<span>新建卡包</span>';
      add.addEventListener('click', function () { openFolderModal(null); });
      els.foldersBoard.appendChild(add);
    }

    if (c.buckets.length) {
      var bt = document.createElement('div');
      bt.className = 'folders-section-title';
      bt.textContent = '手机图集';
      els.foldersBoard.appendChild(bt);
      c.buckets.filter(function (b) { return !q || bucketDisplayName(b.name).toLowerCase().indexOf(q) >= 0; }).forEach(function (b) {
        els.foldersBoard.appendChild(bucketOverviewCard(b));
      });
    }
  }

  function overviewCover(items, emptyIcon) {
    var cover = document.createElement('div');
    cover.className = 'folder-ov-cover' + (items.length === 1 ? ' single' : items.length === 2 ? ' two' : items.length === 3 ? ' three' : '');
    if (!items.length) {
      cover.innerHTML = '<div class="cover-empty">' + svgIcon(emptyIcon || 'image') + '</div>';
      return cover;
    }
    items.slice(0, 4).forEach(function (p) {
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      img.src = thumbUrl(p);
      img.onerror = function () { this.style.opacity = '0'; };
      cover.appendChild(img);
    });
    return cover;
  }

  function folderOverviewCard(f, items, count) {
    var card = document.createElement('article');
    card.className = 'folder-ov-card';
    card.appendChild(overviewCover(items, f.icon));
    var body = document.createElement('div');
    body.className = 'folder-ov-body';
    var row = document.createElement('div');
    row.className = 'folder-ov-title-row';
    var name = document.createElement('span');
    name.className = 'folder-ov-title';
    name.textContent = f.name;
    var countEl = document.createElement('span');
    countEl.className = 'folder-ov-count';
    countEl.textContent = count + ' 项';
    var actions = document.createElement('span');
    actions.className = 'folder-ov-actions';
    actions.innerHTML = '<button type="button" data-edit-folder="' + f.id + '" title="编辑卡包">' + svgIcon('edit') + '</button>' +
      '<button type="button" class="danger" data-delete-folder="' + f.id + '" title="删除卡包">' + svgIcon('trash') + '</button>';
    row.appendChild(name); row.appendChild(countEl); row.appendChild(actions);
    var sub = document.createElement('div');
    sub.className = 'folder-ov-sub';
    sub.textContent = '我的卡包 · ' + (items.length ? '最近更新' : '还没有内容');
    body.appendChild(row); body.appendChild(sub);
    card.appendChild(body);
    card.addEventListener('click', function (e) {
      if (e.target.closest('[data-edit-folder],[data-delete-folder]')) return;
      state.active = f.id;
      if (state.folderOrders[f.id]) state.sort = 'custom';
      exitSelection();
      clearSearch(false);
      save();
      renderAll({ resetScroll: true });
    });
    return card;
  }

  function bucketOverviewCard(b) {
    var card = document.createElement('article');
    card.className = 'folder-ov-card';
    card.appendChild(overviewCover(b.latest, b.name.toLowerCase().indexOf('video') >= 0 ? 'video' : 'camera'));
    var body = document.createElement('div');
    body.className = 'folder-ov-body';
    var row = document.createElement('div');
    row.className = 'folder-ov-title-row';
    var name = document.createElement('span'); name.className = 'folder-ov-title'; name.textContent = bucketDisplayName(b.name);
    var count = document.createElement('span'); count.className = 'folder-ov-count'; count.textContent = b.count + ' 项';
    row.appendChild(name); row.appendChild(count);
    var sub = document.createElement('div'); sub.className = 'folder-ov-sub'; sub.textContent = '手机图集 · ' + b.name;
    body.appendChild(row); body.appendChild(sub);
    card.appendChild(body);
    card.addEventListener('click', function () {
      state.active = BUCKET_PREFIX + b.id;
      exitSelection();
      clearSearch(false);
      save();
      renderAll({ resetScroll: true });
    });
    return card;
  }

  /* ---------------- viewer ---------------- */

  function openViewer(id) {
    requestAnimationFrame(updateScrollRail);
    var idx = -1;
    for (var i = 0; i < state.filtered.length; i++) if (state.filtered[i].id === id) { idx = i; break; }
    if (idx < 0) return;
    state.viewerId = id;
    state.viewerIndex = idx;
    resetViewerZoom(false);
    els.viewer.hidden = false;
    els.viewer.setAttribute('aria-hidden', 'false');
    updateViewer();
  }

  function closeViewer() {
    requestAnimationFrame(updateScrollRail);
    resetViewerZoom(false);
    stopViewerVideo();
    els.viewer.hidden = true;
    els.viewer.setAttribute('aria-hidden', 'true');
    els.viewerImage.removeAttribute('src');
    els.viewerImage.classList.remove('ready');
    els.viewerImage.hidden = false;
    els.viewerVideo.hidden = true;
    els.videoControls.hidden = true;
    els.viewerLiveBtn.hidden = true;
    state.viewerId = null;
    state.viewerIndex = -1;
    state.viewerLive = false;
  }

  function stopViewerVideo() {
    try {
      els.viewerVideo.pause();
      els.viewerVideo.removeAttribute('src');
      els.viewerVideo.load();
    } catch (e) {}
    setVideoPlayState(false);
    els.videoControls.hidden = true;
    if (els.videoProgress) els.videoProgress.value = '0';
    if (els.videoTime) els.videoTime.textContent = '0:00';
  }

  function currentViewerPhoto() {
    return state.viewerId ? photoById(state.viewerId) : null;
  }

  function updateViewer() {
    resetViewerZoom(false);
    var p = currentViewerPhoto();
    if (!p) { closeViewer(); return; }
    var idx = -1;
    for (var i = 0; i < state.filtered.length; i++) if (state.filtered[i].id === p.id) { idx = i; break; }
    if (idx < 0) { closeViewer(); return; }
    state.viewerIndex = idx;
    state.viewerLive = false;
    liveCheckToken++;
    els.viewerName.textContent = p.name;
    var kind = isVideo(p) ? '视频' : p.animated ? '动图' : '图片';
    var extra = isVideo(p) ? ' · ' + formatDuration(p.duration) : '';
    els.viewerDate.textContent = fullDate(p.date) + extra + (p.w && p.h ? '  ·  ' + p.w + ' × ' + p.h : '') + '  ·  ' + kind;
    els.viewerFolderName.textContent = photoFolderLabel(p.id);
    els.viewerCount.textContent = (idx + 1) + ' / ' + state.filtered.length;
    els.viewerPrev.disabled = idx <= 0;
    els.viewerNext.disabled = idx >= state.filtered.length - 1;
    els.viewerLiveBtn.hidden = true;
    els.viewerVideo.hidden = true;
    els.videoControls.hidden = true;
    els.viewerImage.hidden = false;
    els.viewerLoading.hidden = false;

    if (isVideo(p)) {
      els.viewerImage.hidden = true;
      els.viewerImage.removeAttribute('src');
      els.viewerVideo.hidden = false;
      els.videoControls.hidden = false;
      els.viewerVideo.poster = thumbUrl(p);
      els.viewerVideo.muted = false;
      updateMuteUI();
      els.viewerVideo.src = fullUrl(p);
      els.viewerVideo.onloadedmetadata = function () {
        els.viewerLoading.hidden = true;
        updateVideoUI();
      };
      els.viewerVideo.onerror = function () { els.viewerLoading.hidden = true; };
      setVideoPlayState(false);
      return;
    }

    els.viewerImage.classList.remove('ready');
    els.viewerImage.onload = function () {
      els.viewerImage.classList.add('ready');
      els.viewerLoading.hidden = true;
    };
    els.viewerImage.onerror = function () {
      if (els.viewerImage.dataset.fallback === '0') {
        els.viewerImage.dataset.fallback = '1';
        els.viewerImage.src = thumbUrl(p);
        return;
      }
      if (els.viewerImage.dataset.fallback === '1') {
        els.viewerImage.dataset.fallback = '2';
        if (isNative() && window.Native.getThumbData) {
          try {
            var data = window.Native.getThumbData(String(p.id));
            if (data && data.indexOf('data:image') === 0) { els.viewerImage.src = data; return; }
          } catch (e) {}
        }
      }
      els.viewerLoading.hidden = true;
    };
    els.viewerImage.dataset.fallback = '0';
    els.viewerImage.src = fullUrl(p);
    if (els.viewerImage.complete && els.viewerImage.naturalWidth) {
      els.viewerImage.classList.add('ready');
      els.viewerLoading.hidden = true;
    }

    if (isNative() && window.Native.hasMotion) {
      var token = liveCheckToken;
      var id = p.id;
      setTimeout(function () {
        if (token !== liveCheckToken || state.viewerId !== id) return;
        try {
          if (window.Native.hasMotion(id)) {
            els.viewerDate.textContent += '  · 实况';
            playMotion();
          }
        } catch (e) {}
      }, 20);
    }
  }

  function navigateViewer(delta) {
    if (viewerAnimating) return;
    var next = state.viewerIndex + delta;
    if (next < 0 || next >= state.filtered.length) return;
    var canvas = els.viewerCanvas;
    var out = delta > 0 ? 'slide-out-left' : 'slide-out-right';
    var inc = delta > 0 ? 'slide-in-right' : 'slide-in-left';
    viewerAnimating = true;
    stopViewerVideo();
    resetViewerZoom(false);
    canvas.style.willChange = 'transform, opacity';
    canvas.classList.remove('slide-in-left', 'slide-in-right', 'slide-out-left', 'slide-out-right');
    canvas.classList.add(out);
    setTimeout(function () {
      stopViewerVideo();
      state.viewerId = state.filtered[next].id;
      state.viewerIndex = next;
      updateViewer();
      canvas.classList.remove(out);
      canvas.classList.add(inc);
      setTimeout(function () { canvas.classList.remove(inc); canvas.style.willChange = ''; viewerAnimating = false; }, 190);
    }, 150);
  }

  function resetViewerZoom(animate) {
    viewerZoom.scale = 1;
    viewerZoom.x = 0;
    viewerZoom.y = 0;
    viewerZoom.pointers = {};
    viewerZoom.pinch = null;
    viewerZoom.pan = null;
    if (!els.viewerImage) return;
    els.viewerImage.classList.remove('zooming');
    els.viewerImage.style.transition = animate ? 'transform .16s ease' : 'none';
    els.viewerImage.style.transform = 'translate3d(0,0,0) scale(1)';
    if (animate) setTimeout(function () { if (els.viewerImage) els.viewerImage.style.transition = ''; }, 180);
  }

  function applyViewerZoom() {
    if (!els.viewerImage) return;
    var z = viewerZoom;
    z.scale = clamp(z.scale, 1, 5);
    var w = els.viewerCanvas.clientWidth || 1;
    var h = els.viewerCanvas.clientHeight || 1;
    var mx = Math.max(0, (w * (z.scale - 1)) / 2 + 30);
    var my = Math.max(0, (h * (z.scale - 1)) / 2 + 30);
    z.x = clamp(z.x, -mx, mx);
    z.y = clamp(z.y, -my, my);
    els.viewerImage.style.transform = 'translate3d(' + z.x + 'px,' + z.y + 'px,0) scale(' + z.scale + ')';
  }

  function zoomPointerDown(e) {
    var p = currentViewerPhoto();
    if (!p) return;
    if (e.target.closest('button')) return;
    var vidVisible = isVideo(p) || state.viewerLive;
    viewerZoom.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(viewerZoom.pointers);
    if (vidVisible) {
      if (ids.length === 1) {
        swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
        try { els.viewerCanvas.setPointerCapture(e.pointerId); } catch (err) {}
      } else {
        swipe = null;
      }
      return;
    }
    if (ids.length === 2) {
      var a = viewerZoom.pointers[ids[0]], b = viewerZoom.pointers[ids[1]];
      var dist = Math.hypot(a.x - b.x, a.y - b.y);
      viewerZoom.pinch = { dist: Math.max(1, dist), scale: viewerZoom.scale };
      viewerZoom.pan = null;
      swipe = null;
      els.viewerImage.classList.add('zooming');
      try { els.viewerCanvas.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    } else if (ids.length === 1) {
      if (viewerZoom.scale > 1.01) {
        viewerZoom.pan = { x: e.clientX, y: e.clientY, px: viewerZoom.x, py: viewerZoom.y };
        swipe = null;
        els.viewerImage.classList.add('zooming');
      } else {
        swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
        try { els.viewerCanvas.setPointerCapture(e.pointerId); } catch (err) {}
      }
    }
  }

  function zoomPointerMove(e) {
    if (!viewerZoom.pointers[e.pointerId]) return;
    viewerZoom.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(viewerZoom.pointers);
    if (viewerZoom.pinch && ids.length >= 2) {
      var a = viewerZoom.pointers[ids[0]], b = viewerZoom.pointers[ids[1]];
      var dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      viewerZoom.scale = clamp(viewerZoom.pinch.scale * dist / viewerZoom.pinch.dist, 1, 5);
      applyViewerZoom();
      e.preventDefault();
    } else if (viewerZoom.pan && ids.length === 1 && viewerZoom.scale > 1.01) {
      viewerZoom.x = viewerZoom.pan.px + (e.clientX - viewerZoom.pan.x);
      viewerZoom.y = viewerZoom.pan.py + (e.clientY - viewerZoom.pan.y);
      applyViewerZoom();
      e.preventDefault();
    }
  }

  function zoomPointerUp(e) {
    var had = viewerZoom.pointers[e.pointerId];
    delete viewerZoom.pointers[e.pointerId];
    var ids = Object.keys(viewerZoom.pointers);
    if (ids.length < 2) viewerZoom.pinch = null;
    if (ids.length === 1 && viewerZoom.scale > 1.01) {
      var restId = ids[0];
      viewerZoom.pan = { x: viewerZoom.pointers[restId].x, y: viewerZoom.pointers[restId].y, px: viewerZoom.x, py: viewerZoom.y };
    }
    if (ids.length === 0) viewerZoom.pan = null;
    if (viewerZoom.scale <= 1.01) {
      viewerZoom.scale = 1; viewerZoom.x = 0; viewerZoom.y = 0;
      applyViewerZoom();
    }
    els.viewerImage.classList.remove('zooming');
    if (had && swipe && swipe.id === e.pointerId && ids.length === 0) {
      var dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
      swipe = null;
      if (viewerZoom.scale <= 1.01 && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.25) {
        navigateViewer(dx < 0 ? 1 : -1);
      }
    }
  }

  function syncViewer() {
    if (!state.viewerId) return;
    var idx = -1;
    for (var i = 0; i < state.filtered.length; i++) if (state.filtered[i].id === state.viewerId) { idx = i; break; }
    if (idx < 0) { closeViewer(); return; }
    state.viewerIndex = idx;
    updateViewer();
  }

  function toggleVideoPlay() {
    var v = els.viewerVideo;
    if (!v) return;
    if (v.paused) {
      try { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
    } else {
      v.pause();
    }
  }
  function setVideoPlayState(playing) {
    if (els.videoPlayBtn) {
      var play = els.videoPlayBtn.querySelector('.play-icon');
      var pause = els.videoPlayBtn.querySelector('.pause-icon');
      if (play) play.hidden = playing;
      if (pause) pause.hidden = !playing;
    }
  }
  function updateVideoUI() {
    var v = els.viewerVideo;
    if (!v || !v.duration) return;
    var pct = (v.currentTime / v.duration) * 100;
    if (els.videoProgress) els.videoProgress.value = String(pct);
    if (els.videoTime) els.videoTime.textContent = formatDuration(Math.round(v.currentTime) * 1000) + ' / ' + formatDuration(v.duration * 1000);
    updateMuteUI();
  }
  function updateMuteUI() {
    if (!els.videoMuteBtn) return;
    var muted = !!els.viewerVideo.muted;
    var on = els.videoMuteBtn.querySelector('.volume-on');
    var off = els.videoMuteBtn.querySelector('.volume-off');
    if (on) on.hidden = muted;
    if (off) off.hidden = !muted;
  }

  function playMotion() {
    if (!state.viewerId || !isNative()) return;
    var id = state.viewerId;
    var url = '';
    try { url = window.Native.getMotionUrl(id); } catch (e) {}
    if (!url) { toast('没有可播放的实况视频'); return; }
    els.viewerImage.hidden = true;
    els.viewerLiveBtn.hidden = true;
    els.viewerVideo.hidden = false;
    els.videoControls.hidden = false;
    els.viewerVideo.poster = thumbUrl(currentViewerPhoto());
    els.viewerVideo.muted = true;
    els.viewerVideo.onerror = function () { els.viewerLoading.hidden = true; toast('实况视频无法播放'); };
    els.viewerVideo.src = url;
    els.viewerLoading.hidden = true;
    try { var livePromise = els.viewerVideo.play(); if (livePromise && livePromise.catch) livePromise.catch(function () {}); } catch (e) {}
    state.viewerLive = true;
  }

  /* ---------------- selection ---------------- */

  function enterSelection(id) {
    if (!state.selectionMode) {
      state.selectionMode = true;
      state.selected = {};
      closeAllPopovers();
    }
    state.selected[id] = true;
    updateSelectionUI();
    haptic(10);
  }

  function toggleSelect(id) {
    if (!state.selectionMode) { enterSelection(id); return; }
    if (state.selected[id]) delete state.selected[id];
    else state.selected[id] = true;
    if (!Object.keys(state.selected).length) exitSelection();
    else { state.suppressClickUntil = now() + 250; updateSelectionUI(); }
  }

  function exitSelection() {
    state.selectionMode = false;
    state.selected = {};
    unblockSelectionTouch();
    updateSelectionUI();
  }

  function selectedIds() {
    return Object.keys(state.selected || {});
  }

  function updateSelectionUI() {
    document.body.classList.toggle('selection-mode', state.selectionMode);
    els.selectionBar.hidden = !state.selectionMode;
    var ids = selectedIds();
    els.selectionCount.textContent = '已选 ' + ids.length + ' 项';
    var allSelected = state.filtered.length > 0 && state.filtered.every(function (p) { return state.selected[p.id]; });
    var inTrash = isTrashActive();
    els.selectAllBtn.querySelector('span').textContent = inTrash ? '全选' : (allSelected ? '取消全选' : '全选');
    if (els.moveSelectedBtn) els.moveSelectedBtn.hidden = inTrash;
    if (els.removeSelectedBtn) els.removeSelectedBtn.hidden = inTrash || !isFolderActive();
    if (els.deleteSelectedBtn) els.deleteSelectedBtn.hidden = inTrash;
    if (els.restoreTrashBtn) els.restoreTrashBtn.hidden = !inTrash;
    if (els.purgeTrashBtn) els.purgeTrashBtn.hidden = !inTrash;
    if (els.selectionHint) els.selectionHint.textContent = inTrash ? '选择要恢复或彻底删除的内容' : '点按照片继续多选，拖动所选内容归档';
    els.selectAllBtn.classList.toggle('active', allSelected);
    $$('.photo-card').forEach(function (card) {
      card.classList.toggle('selected', !!state.selected[card.dataset.photoId]);
    });
    if (!state.selectionMode) els.selectionBar.hidden = true;
  }

  function selectAllVisible() {
    var all = state.filtered.length > 0 && state.filtered.every(function (p) { return state.selected[p.id]; });
    if (isTrashActive() && all) { updateSelectionUI(); return; }
    state.selected = {};
    if (!all) state.filtered.forEach(function (p) { state.selected[p.id] = true; });
    if (!Object.keys(state.selected).length) exitSelection();
    else updateSelectionUI();
  }

  /* ---------------- folders / move ---------------- */

  function assignMany(ids, folderId, mode) {
    ids = (ids || []).filter(Boolean);
    if (!ids.length) return;
    var target = folderId === UNCAT_DROP || folderId === UNCAT ? UNCAT : folderId;
    if (target !== UNCAT && !findFolder(target)) return;
    var addMode = mode !== 'replace';
    var changed = 0;
    ids.forEach(function (id) {
      if (target === UNCAT) {
        if (folderIdsOf(id).length) { clearPhotoFolders(id); changed++; }
        return;
      }
      if (addMode) {
        if (addPhotoFolder(id, target)) changed++;
      } else {
        var list = folderIdsOf(id);
        if (!(list.length === 1 && list[0] === target)) {
          setPhotoFolders(id, [target]);
          changed++;
        }
      }
    });
    if (!changed) {
      toast(target === UNCAT ? '已经在未分类里' : '已经在「' + folderName(target) + '」里');
      exitSelection();
      return;
    }
    save();
    exitSelection();
    renderAll({ resetScroll: false });
    haptic(12);
    toast(ids.length > 1
      ? '已将 ' + ids.length + ' 项放入' + (target === UNCAT ? '未分类' : '「' + folderName(target) + '」')
      : (target === UNCAT ? '已移回未分类' : '已放入「' + folderName(target) + '」'));
  }

  function moveToTrash(ids) {
    ids = (ids || []).filter(Boolean);
    if (!ids.length) return;
    ids.forEach(function (id) {
      state.trash[String(id)] = now();
      delete state.selected[id];
    });
    save();
    exitSelection();
    renderAll({ resetScroll: false });
  }

  function restoreFromTrash(ids, target) {
    ids = (ids || []).filter(Boolean);
    if (!ids.length) return;
    ids.forEach(function (id) {
      delete state.trash[String(id)];
      if (target === UNCAT) clearPhotoFolders(id);
      else setPhotoFolders(id, [target]);
    });
    state.moveFromTrash = false;
    save();
    exitSelection();
    renderAll({ resetScroll: false });
  }

  function openTrashMove(ids) {
    openMove(ids, true);
  }

  function openMove(input, fromTrash) {
    var ids = (Array.isArray(input) ? input : [input]).filter(function (id) { return photoById(id); });
    if (!ids.length) return;
    state.moveFromTrash = !!fromTrash;
    state.moveIds = ids;
    var c = counts(mediaPool());
    var allUncat = ids.every(function (id) { return !folderIdsOf(id).length; });
    els.moveTitle.textContent = state.moveFromTrash
      ? (ids.length > 1 ? '移出 ' + ids.length + ' 项到卡包' : '移出垃圾桶')
      : (ids.length > 1 ? '移动 ' + ids.length + ' 项到卡包' : '移动到卡包');
    els.moveMulti.hidden = !!state.moveFromTrash;
    els.moveNewFolder.hidden = !!state.moveFromTrash;
    els.moveList.innerHTML = '';
    var uncat = document.createElement('button');
    uncat.type = 'button';
    uncat.className = 'move-row' + (allUncat ? ' active' : '');
    uncat.dataset.folder = UNCAT;
    uncat.innerHTML = '<span class="m-icon">' + svgIcon('image') + '</span><span class="m-name">未分类</span>' +
      '<span class="m-count">' + c.uncat + '</span><span class="m-check">' + svgIcon('check') + '</span>';
    els.moveList.appendChild(uncat);
    state.folders.forEach(function (f) {
      var row = document.createElement('button');
      row.type = 'button';
      var allIn = ids.every(function (id) { return photoInFolder(id, f.id); });
      row.className = 'move-row' + (allIn ? ' active' : '');
      row.dataset.folder = f.id;
      var icon = document.createElement('span');
      icon.className = 'm-icon';
      icon.style.color = f.color;
      icon.style.background = hexAlpha(f.color, .11);
      icon.innerHTML = svgIcon(f.icon);
      var name = document.createElement('span'); name.className = 'm-name'; name.textContent = f.name;
      var count = document.createElement('span'); count.className = 'm-count'; count.textContent = String(c.map[f.id] || 0);
      var check = document.createElement('span'); check.className = 'm-check'; check.innerHTML = svgIcon('check');
      row.appendChild(icon); row.appendChild(name); row.appendChild(count); row.appendChild(check);
      els.moveList.appendChild(row);
    });
    openModal('moveModal');
  }

  function openMultiMove(input) {
    var ids = (Array.isArray(input) ? input : [input]).filter(function (id) { return photoById(id); });
    if (!ids.length) return;
    state.multiMoveIds = ids;
    state.multiMoveSelected = {};
    ids.forEach(function (id) {
      folderIdsOf(id).forEach(function (fid) { state.multiMoveSelected[fid] = true; });
    });
    els.multiMoveList.innerHTML = '';
    var c = counts(mediaPool());
    state.folders.forEach(function (f) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'multi-row' + (state.multiMoveSelected[f.id] ? ' active' : '');
      row.dataset.folder = f.id;
      var check = document.createElement('span');
      check.className = 'multi-check';
      check.innerHTML = svgIcon('check');
      var icon = document.createElement('span');
      icon.className = 'multi-icon';
      icon.style.color = f.color;
      icon.style.background = hexAlpha(f.color, .12);
      icon.innerHTML = svgIcon(f.icon);
      var name = document.createElement('span');
      name.className = 'multi-name';
      name.textContent = f.name;
      var count = document.createElement('span');
      count.className = 'multi-count';
      count.textContent = String(c.map[f.id] || 0);
      row.appendChild(check); row.appendChild(icon); row.appendChild(name); row.appendChild(count);
      els.multiMoveList.appendChild(row);
    });
    if (!state.folders.length) {
      var empty = document.createElement('div');
      empty.className = 'multi-empty';
      empty.textContent = '还没有卡包，请先新建卡包';
      els.multiMoveList.appendChild(empty);
    }
    closeModal('moveModal');
    openModal('multiMoveModal');
  }

  function saveMultiMove() {
    var ids = state.multiMoveIds.slice();
    var chosen = Object.keys(state.multiMoveSelected).filter(function (fid) { return !!findFolder(fid); });
    ids.forEach(function (id) { setPhotoFolders(id, chosen); });
    state.multiMoveIds = [];
    closeModal('multiMoveModal');
    exitSelection();
    save();
    renderAll({ resetScroll: false });
    toast(chosen.length ? '已放入 ' + chosen.length + ' 个卡包' : '已移回未分类');
  }

  function clearMultiMove() {
    state.multiMoveIds.forEach(function (id) { clearPhotoFolders(id); });
    state.multiMoveIds = [];
    closeModal('multiMoveModal');
    exitSelection();
    save();
    renderAll({ resetScroll: false });
    toast('已移回未分类');
  }

  function hexAlpha(hex, alpha) {
    var h = String(hex || '#60769e').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (x) { return x + x; }).join('');
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  /* ---------------- modals ---------------- */
  function openModal(id) {
    var el = document.getElementById(id);
    if (!el) return;
    lastFocused = document.activeElement;
    modalStack = modalStack.filter(function (x) { return x !== id; });
    modalStack.push(id);
    el.hidden = false;
    if (id !== 'folderModal' && id !== 'renameModal' && id !== 'timeFilterModal') {
      var focusable = el.querySelector('input,button,[tabindex]');
      if (focusable) setTimeout(function () { try { focusable.focus(); } catch (e) {} }, 60);
    }
  }

  function closeModal(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.hidden = true;
    modalStack = modalStack.filter(function (x) { return x !== id; });
    if (id === 'folderModal') {
      state.pendingMoveIds = [];
      state.editingFolderId = null;
    } else if (id === 'renameModal') {
      state.renameId = null;
      state.renameBusy = false;
      els.saveRenameBtn.disabled = false;
      els.saveRenameBtn.textContent = '保存名称';
    } else if (id === 'folderDeleteModal') {
      state.folderDeleteId = null;
    } else if (id === 'multiMoveModal') {
      state.multiMoveIds = [];
      state.multiMoveSelected = {};
    }
    if (lastFocused && document.contains(lastFocused)) {
      try { lastFocused.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  function closeTopModal() {
    if (!modalStack.length) return false;
    closeModal(modalStack[modalStack.length - 1]);
    return true;
  }

  function anyModalOpen() { return modalStack.length > 0; }

  /* ---------------- folder dialogs ---------------- */

  function buildIconChoices() {
    els.iconChoices.innerHTML = '';
    ICONS.forEach(function (name) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'choice-icon';
      b.dataset.icon = name;
      b.setAttribute('aria-label', '图标');
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = svgIcon(name);
      els.iconChoices.appendChild(b);
    });
  }

  function selectIcon(name) {
    $$('[data-icon]', els.iconChoices).forEach(function (b) {
      var on = b.dataset.icon === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    state._chosenIcon = name;
  }

  function openFolderModal(editId, fromMove) {
    state.editingFolderId = editId || null;
    state.pendingMoveIds = fromMove ? (state.moveIds || []).slice() : [];
    var folder = editId ? findFolder(editId) : null;
    els.folderEyebrow.textContent = folder ? '编辑卡包' : '整理媒体';
    els.folderTitle.textContent = folder ? '编辑卡包' : '新建卡包';
    els.saveFolderBtn.textContent = folder ? '保存修改' : '创建卡包';
    els.deleteFolderBtn.hidden = !folder;
    els.folderNameInput.value = folder ? folder.name : '';
    selectIcon(folder ? folder.icon : 'folder');
    if (fromMove) closeModal('moveModal');
    openModal('folderModal');
    setTimeout(function () { try { els.folderNameInput.focus(); } catch (e) {} }, 90);
  }

  function saveFolder() {
    var name = els.folderNameInput.value.trim().replace(/\s+/g, ' ');
    if (!name) { toast('给卡包起个名字吧'); els.folderNameInput.focus(); return; }
    name = name.slice(0, 12);
    var duplicate = state.folders.some(function (f) {
      return f.name.toLowerCase() === name.toLowerCase() && f.id !== state.editingFolderId;
    });
    if (duplicate) { toast('已经有同名卡包了'); els.folderNameInput.focus(); return; }
    var icon = state._chosenIcon || 'folder';
    var pending = state.pendingMoveIds.slice();
    if (state.editingFolderId) {
      var f = findFolder(state.editingFolderId);
      if (f) { f.name = name; f.icon = safeIcon(icon); }
      var id = state.editingFolderId;
      state.editingFolderId = null;
      state.pendingMoveIds = [];
      closeModal('folderModal');
      save();
      renderAll({ resetScroll: false });
      toast('已更新卡包「' + name + '」');
      if (pending.length) assignMany(pending, id, 'add');
    } else {
      var id2 = 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      state.folders.push({
        id: id2, name: name, icon: safeIcon(icon),
        color: FOLDER_COLORS[state.folders.length % FOLDER_COLORS.length]
      });
      state.editingFolderId = null;
      state.pendingMoveIds = [];
      closeModal('folderModal');
      save();
      if (pending.length) {
        assignMany(pending, id2, 'add');
      } else {
        state.active = id2;
        state.query = '';
        clearSearch(false);
        save();
        renderAll({ resetScroll: true });
        toast('已创建卡包「' + name + '」');
      }
    }
  }

  function requestDeleteFolder(id) {
    var f = findFolder(id);
    if (!f) return;
    state.folderDeleteId = id;
    els.folderDeleteCopy.textContent = '删除「' + f.name + '」后，里面的媒体会回到“未分类”。原始照片和视频不会被删除。';
    openModal('folderDeleteModal');
  }

  function confirmDeleteFolder() {
    var id = state.folderDeleteId;
    var f = id ? findFolder(id) : null;
    if (!f) { closeModal('folderDeleteModal'); return; }
    Object.keys(state.assignments).forEach(function (photoId) {
      var list = folderIdsOf(photoId).filter(function (fid) { return fid !== id; });
      if (list.length) state.assignments[photoId] = list;
      else delete state.assignments[photoId];
    });
    state.folders = state.folders.filter(function (x) { return x.id !== id; });
    delete state.folderOrders[id];
    if (state.active === id) state.active = UNCAT;
    state.folderDeleteId = null;
    closeModal('folderDeleteModal');
    if (state.editingFolderId === id) { state.editingFolderId = null; closeModal('folderModal'); }
    save();
    renderAll({ resetScroll: false });
    toast('已删除卡包「' + f.name + '」');
  }

  /* ---------------- rename / delete / share ---------------- */

  function openRename(id) {
    var p = photoById(id);
    if (!p) return;
    state.renameId = id;
    els.renameInput.value = p.name;
    els.saveRenameBtn.disabled = false;
    openModal('renameModal');
    setTimeout(function () {
      try {
        els.renameInput.focus();
        var dot = p.name.lastIndexOf('.');
        els.renameInput.setSelectionRange(0, dot > 0 ? dot : p.name.length);
      } catch (e) {}
    }, 80);
  }

  function saveRename() {
    var id = state.renameId;
    var p = id ? photoById(id) : null;
    if (!p) return;
    var name = els.renameInput.value.trim();
    if (!name) { toast('文件名不能为空'); return; }
    if (isNative() && window.Native.renameMedia) {
      state.renameBusy = true;
      els.saveRenameBtn.disabled = true;
      els.saveRenameBtn.textContent = '保存中…';
      try {
        window.Native.renameMedia(id, name);
      } catch (e) {
        state.renameBusy = false;
        els.saveRenameBtn.disabled = false;
        els.saveRenameBtn.textContent = '保存名称';
        toast('重命名失败');
      }
      return;
    }
    p.name = name;
    closeModal('renameModal');
    state.renameId = null;
    save();
    renderAll({ resetScroll: false });
    if (state.viewerId === id) updateViewer();
    toast('已重命名');
  }

  function requestDelete(id) {
    if (isNative() && window.Native.deletePhoto) {
      try { window.Native.deletePhoto(String(id)); } catch (e) { toast('删除失败'); }
      return;
    }
    var p = photoById(id);
    if (!p) return;
    state.photos = state.photos.filter(function (x) { return x.id !== id; });
    delete state.trash[String(id)];
    delete state.assignments[id];
    Object.keys(state.folderOrders).forEach(function (fid) {
      state.folderOrders[fid] = state.folderOrders[fid].filter(function (x) { return x !== id; });
    });
    save();
    if (state.viewerId === id) closeViewer();
    renderAll({ resetScroll: false });
    toast('已移除');
  }

  function requestDeleteMany(ids) {
    if (isNative() && window.Native.deletePhotos) {
      try { window.Native.deletePhotos(JSON.stringify(ids)); } catch (e) { toast('删除失败'); }
      return;
    }
    ids.forEach(function (id) { requestDelete(id); });
  }

  function shareFolder() {
    if (!isFolderActive()) return;
    var f = findFolder(state.active);
    var ids = mediaPool().filter(function (p) { return photoInFolder(p.id, state.active); }).map(function (p) { return p.id; });
    if (!ids.length) { toast('这个卡包还没有可分享的内容'); return; }
    if (isNative() && window.Native.shareMediaList) {
      try { window.Native.shareMediaList(JSON.stringify(ids), f ? f.name : '卡包'); } catch (e) { toast('分享失败'); }
    } else {
      toast('演示模式：安装到手机后可分享整个卡包');
    }
  }

  function shareMedia(id) {
    if (isNative() && window.Native.sharePhoto) {
      try { window.Native.sharePhoto(String(id)); } catch (e) { toast('分享失败'); }
    } else {
      toast('演示模式：安装到手机后可分享');
    }
  }

  /* ---------------- native callbacks ---------------- */

  function installNativeCallbacks() {
    window.__native = {
      onPermission: function (status) {
        state.permission = status || 'unknown';
        if (status === 'denied' || status === 'blocked') {
          state.photos = [];
          state.loading = false;
        } else if (status === 'requesting') {
          state.loading = state.photos.length === 0;
        } else {
          state.loading = true;
        }
        renderAll({ resetScroll: false });
      },
      onPhotos: function (payload) {
        if (typeof payload === 'string') {
          try { payload = JSON.parse(payload); } catch (e) { payload = null; }
        }
        state.loading = false;
        state.initialized = true;
        if (!payload) {
          state.error = '读取相册失败，请重试。';
          renderAll({ resetScroll: false });
          return;
        }
        state.error = payload.error ? String(payload.error) : '';
        state.partial = !!payload.partial;
        state.limitedImages = !!payload.limitedImages;
        state.limitedVideos = !!payload.limitedVideos;
        state.permission = state.partial ? 'partial' : 'granted';
        state.photos = dedupePhotos(Array.isArray(payload.photos) ? payload.photos : []);
        var validIds = {};
        state.photos.forEach(function (p) { validIds[p.id] = true; });
        Object.keys(state.trash).forEach(function (id) { if (!validIds[id]) delete state.trash[id]; });
        migrateAssignments();
        save();
        renderAll({ resetScroll: false });
        if (state.demo) state.demo = false;
      },
      onDeleteResult: function (ok, idsJson) {
        if (!ok) { toast('已取消删除'); return; }
        var ids = [];
        try { ids = typeof idsJson === 'string' ? JSON.parse(idsJson) : idsJson; } catch (e) { ids = []; }
        if (!Array.isArray(ids)) ids = [];
        ids = ids.map(String);
        var map = {};
        ids.forEach(function (id) { map[id] = true; delete state.trash[String(id)]; delete state.assignments[id]; delete state.selected[id]; });
        Object.keys(state.folderOrders).forEach(function (fid) {
          state.folderOrders[fid] = state.folderOrders[fid].filter(function (id) { return !map[id]; });
        });
        state.photos = state.photos.filter(function (p) { return !map[p.id]; });
        if (state.selectionMode && !selectedIds().length) exitSelection();
        save();
        if (state.viewerId && map[state.viewerId]) closeViewer();
        renderAll({ resetScroll: false });
        toast('已删除 ' + ids.length + ' 项');
      },
      onRenameResult: function (ok, id, newName, message) {
        state.renameBusy = false;
        els.saveRenameBtn.disabled = false;
        els.saveRenameBtn.textContent = '保存名称';
        if (!ok) { toast(message || '重命名失败'); return; }
        var p = photoById(id);
        if (p) p.name = newName;
        closeModal('renameModal');
        state.renameId = null;
        save();
        renderAll({ resetScroll: false });
        if (state.viewerId === id) updateViewer();
        toast('已重命名');
      },
      onError: function (msg) {
        state.loading = false;
        state.error = String(msg || '读取相册失败');
        renderAll({ resetScroll: false });
        toast(state.error);
      }
    };
  }

  /* ---------------- events ---------------- */

  function bindEvents() {
    installNativeCallbacks();
    els.sideNav.addEventListener('click', onNavClick);
    els.folderSearch.addEventListener('input', function () {
      state.folderQuery = els.folderSearch.value;
      if (els.boardSearch) els.boardSearch.value = state.folderQuery;
      renderSidebar(counts(mediaPool()));
      if (state.active === FOLDERS) renderFoldersOverview(counts(mediaPool()));
    });
    els.boardSearch.addEventListener('input', function () {
      state.folderQuery = els.boardSearch.value;
      if (els.folderSearch) els.folderSearch.value = state.folderQuery;
      renderSidebar(counts(mediaPool()));
      if (state.active === FOLDERS) renderFoldersOverview(counts(mediaPool()));
    });
    els.editFolderBtn.addEventListener('click', function () { if (isFolderActive()) openFolderModal(state.active); });
    els.shareFolderBtn.addEventListener('click', shareFolder);
    els.sidebarToggle.addEventListener('click', toggleSidebar);
    els.tipBtn.addEventListener('click', function () { openModal('tipModal'); });
    els.filterBtn.addEventListener('click', function (e) { e.stopPropagation(); togglePopover(els.filterMenu, els.filterBtn); });
    els.sortBtn.addEventListener('click', function (e) { e.stopPropagation(); togglePopover(els.sortMenu, els.sortBtn); });
    els.filterMenu.addEventListener('click', function (e) {
      var b = e.target.closest('[data-filter]');
      if (!b) return;
      if (b.dataset.filter === 'time') {
        closeAllPopovers();
        openTimeFilter();
        return;
      }
      state.mediaFilter = b.dataset.filter;
      exitSelection();
      save();
      closeAllPopovers();
      renderAll({ resetScroll: true });
    });
    els.sortMenu.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sort]');
      if (!b) return;
      state.sort = b.dataset.sort;
      save();
      closeAllPopovers();
      renderAll({ resetScroll: true });
    });
    els.appMenu.addEventListener('click', function (e) {
      var b = e.target.closest('[data-action]');
      if (!b) return;
      closeAllPopovers();
      var action = b.dataset.action;
      if (action === 'refresh') refreshPhotos();
      else if (action === 'permission') openPermissionSettings();
      else if (action === 'tip') showTip(true);
      else if (action === 'about') openModal('aboutModal');
    });
    els.viewBtn.addEventListener('click', function () {
      state.view = state.view === 'grid' ? 'grid5' : state.view === 'grid5' ? 'list' : 'grid';
      save();
      updateToolControls();
      renderAll({ resetScroll: true });
    });
    els.searchBtn.addEventListener('click', function () {
      if (!els.searchRow.hidden && !state.query) { hideSearch(); return; }
      els.searchRow.hidden = false;
      els.searchBtn.classList.add('active');
      setTimeout(function () { try { els.searchInput.focus(); } catch (e) {} }, 40);
    });
    els.searchInput.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.query = els.searchInput.value;
        els.searchClear.hidden = !state.query;
        els.searchBtn.classList.toggle('active', !!state.query);
        renderAll({ resetScroll: true });
      }, 100);
    });
    els.searchClear.addEventListener('click', function () { clearSearch(true); });
    els.searchRow.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideSearch(); });

    els.selectAllBtn.addEventListener('click', selectAllVisible);
    els.moveSelectedBtn.addEventListener('click', function () {
      var ids = selectedIds();
      if (ids.length) openMove(ids);
    });
    els.removeSelectedBtn.addEventListener('click', function () {
      var ids = selectedIds();
      if (!ids.length) return;
      ids.forEach(function (id) { clearPhotoFolders(id); });
      save();
      exitSelection();
      renderAll({ resetScroll: false });
      toast(ids.length > 1 ? '已从卡包移出 ' + ids.length + ' 项' : '已移出卡包');
    });
    els.deleteSelectedBtn.addEventListener('click', function () {
      var ids = selectedIds();
      if (!ids.length) return;
      if (isTrashActive()) {
        exitSelection();
        ids.forEach(function (id) { requestDelete(id); });
      } else {
        moveToTrash(ids);
      }
    });
    els.restoreTrashBtn.addEventListener('click', function () {
      var ids = selectedIds();
      if (!ids.length) return;
      openTrashMove(ids);
    });
    els.purgeTrashBtn.addEventListener('click', function () {
      var ids = selectedIds();
      if (!ids.length) return;
      exitSelection();
      requestDeleteMany(ids);
    });
    els.exitSelectionBtn.addEventListener('click', exitSelection);
    els.timeFilterNext.addEventListener('click', stepTimeFilter);
    els.timeFilterBack.addEventListener('click', backTimeFilter);
    els.timeFilterClear.addEventListener('click', function () {
      clearDateFilter();
      closeModal('timeFilterModal');
      exitSelection();
      save();
      renderAll({ resetScroll: true });
    });
    els.bottomNav.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (b) setTab(b.dataset.tab);
    });
    els.mePage.addEventListener('click', function (e) {
      var b = e.target.closest('[data-me-action]');
      if (!b) return;
      var action = b.dataset.meAction;
      if (action === 'refresh') { setTab('album'); refreshPhotos(); }
      else if (action === 'permission') openPermissionSettings();
      else if (action === 'about') openModal('aboutModal');
      else if (action === 'privacy') openModal('privacyModal');
      else if (action === 'permission-doc') openModal('permissionModal');
    });
    els.scrollRail.addEventListener('pointerdown', startRailDrag);
    els.scrollThumb.addEventListener('pointerdown', startRailDrag);
    els.content.addEventListener('scroll', updateScrollRail, { passive: true });
    els.sideNav.addEventListener('pointerdown', onFolderReorderStart, { passive: true });

    els.emptyState.addEventListener('click', onEmptyAction);
    els.bannerStack.addEventListener('click', function (e) {
      var b = e.target.closest('[data-banner]');
      if (!b) return;
      if (b.dataset.banner === 'permission') {
        if (state.partial || state.limitedImages || state.limitedVideos) requestPermission();
        else openPermissionSettings();
      } else refreshPhotos();
    });

    els.viewerClose.addEventListener('click', closeViewer);
    els.viewerPrev.addEventListener('click', function () { navigateViewer(-1); });
    els.viewerNext.addEventListener('click', function () { navigateViewer(1); });
    els.viewerFolder.addEventListener('click', function () { if (state.viewerId) openMove([state.viewerId]); });
    els.viewerShare.addEventListener('click', function () { if (state.viewerId) shareMedia(state.viewerId); });
    els.viewerLiveBtn.addEventListener('click', playMotion);
    els.viewerRemovePackBtn.addEventListener('click', function () {
      if (!state.viewerId) return;
      clearPhotoFolders(state.viewerId);
      save();
      updateViewer();
      toast('已移出卡包');
    });
    els.videoPlayBtn.addEventListener('click', toggleVideoPlay);
    els.videoMuteBtn.addEventListener('click', function () {
      els.viewerVideo.muted = !els.viewerVideo.muted;
      if (!els.viewerVideo.muted) { try { els.viewerVideo.volume = 1; } catch (e) {} }
      updateMuteUI();
    });
    els.viewerVideo.addEventListener('volumechange', updateMuteUI);
    els.videoProgress.addEventListener('input', function () {
      var v = els.viewerVideo;
      if (!v || !v.duration) return;
      var pct = Number(els.videoProgress.value) || 0;
      try { v.currentTime = (pct / 100) * v.duration; } catch (e) {}
    });
    els.viewerVideo.addEventListener('timeupdate', updateVideoUI);
    els.viewerVideo.addEventListener('durationchange', updateVideoUI);
    els.viewerVideo.addEventListener('play', function () { setVideoPlayState(true); });
    els.viewerVideo.addEventListener('pause', function () { setVideoPlayState(false); });
    els.viewerVideo.addEventListener('ended', function () { setVideoPlayState(false); });
    els.viewerCanvas.addEventListener('pointerdown', zoomPointerDown);
    els.viewerCanvas.addEventListener('pointermove', zoomPointerMove, { passive: false });
    els.viewerCanvas.addEventListener('pointerup', zoomPointerUp);
    els.viewerCanvas.addEventListener('pointercancel', zoomPointerUp);
    $$('.viewer-actions [data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!state.viewerId) return;
        var act = b.dataset.act;
        if (act === 'rename') openRename(state.viewerId);
        else if (act === 'remove-pack') { clearPhotoFolders(state.viewerId); save(); updateViewer(); toast('已移出卡包'); }
        else if (act === 'delete') {
          if (isTrashActive()) requestDelete(state.viewerId);
          else { moveToTrash([state.viewerId]); closeViewer(); }
        }
      });
    });

    els.moveList.addEventListener('click', function (e) {
      var row = e.target.closest('[data-folder]');
      if (!row) return;
      var ids = state.moveIds.slice();
      var fid = row.dataset.folder;
      var fromTrash = state.moveFromTrash;
      state.moveIds = [];
      state.moveFromTrash = false;
      closeModal('moveModal');
      if (fromTrash) restoreFromTrash(ids, fid);
      else assignMany(ids, fid, 'replace');
    });
    els.moveNewFolder.addEventListener('click', function () { openFolderModal(null, true); });
    els.moveMulti.addEventListener('click', function () { openMultiMove(state.moveIds); });
    els.multiMoveList.addEventListener('click', function (e) {
      var row = e.target.closest('[data-folder]');
      if (!row) return;
      var fid = row.dataset.folder;
      if (state.multiMoveSelected[fid]) delete state.multiMoveSelected[fid];
      else state.multiMoveSelected[fid] = true;
      row.classList.toggle('active', !!state.multiMoveSelected[fid]);
    });
    els.multiMoveSave.addEventListener('click', saveMultiMove);
    els.multiMoveClear.addEventListener('click', clearMultiMove);

    els.folderModal.addEventListener('click', function (e) {
      var icon = e.target.closest('[data-icon]');
      if (icon) { selectIcon(icon.dataset.icon); return; }
    });
    els.saveFolderBtn.addEventListener('click', saveFolder);
    els.folderNameInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveFolder(); } });
    els.deleteFolderBtn.addEventListener('click', function () {
      if (state.editingFolderId) requestDeleteFolder(state.editingFolderId);
    });
    els.confirmDeleteFolderBtn.addEventListener('click', confirmDeleteFolder);

    els.foldersBoard.addEventListener('click', function (e) {
      var edit = e.target.closest('[data-edit-folder]');
      if (edit) { openFolderModal(edit.dataset.editFolder); return; }
      var del = e.target.closest('[data-delete-folder]');
      if (del) requestDeleteFolder(del.dataset.deleteFolder);
    });

    els.saveRenameBtn.addEventListener('click', saveRename);
    els.renameInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveRename(); } });

    $$('.modal-backdrop').forEach(function (backdrop) {
      backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(backdrop.id); });
    });
    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { closeModal(b.dataset.close); });
    });

    $('#tipClose').addEventListener('click', function (e) {
      e.stopPropagation();
      state.tipDismissed = true;
      save();
      hideTip();
    });

    document.addEventListener('click', function (e) {
      if (e.target.closest('.popover') || e.target.closest('#sortBtn') || e.target.closest('#filterBtn') || e.target.closest('#appMenuBtn')) return;
      closeAllPopovers();
    });
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', closeAllPopovers, true);
    els.content.addEventListener('scroll', onContentScroll, { passive: true });

    document.addEventListener('pointermove', onPointerMove, { passive: false });
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
    document.addEventListener('dragstart', function (e) {
      if (e.target.closest('.photo-card, .viewer')) e.preventDefault();
    });
    document.addEventListener('contextmenu', function (e) {
      if (e.target.closest('.photo-card, .viewer-canvas')) e.preventDefault();
    });
    window.addEventListener('beforeunload', function () { save(); });
  }

  function showFoldersView() {
    state.active = FOLDERS;
    exitSelection();
    clearSearch(false);
    save();
    renderAll({ resetScroll: true });
  }

  function onNavClick(e) {
    if (now() < state.suppressClickUntil) return;
    var row = e.target.closest('.nav-row');
    if (!row) return;
    if (row.dataset.view === 'new-folder' || row.id === 'newFolderBtn') {
      openFolderModal(null);
      return;
    }
    exitSelection();
    if (row.dataset.view === 'folder') state.active = row.dataset.id;
    else if (row.dataset.view === 'bucket') state.active = BUCKET_PREFIX + row.dataset.bucket;
    else state.active = row.dataset.view;
    if (isFolderActive() && state.folderOrders[state.active]) state.sort = 'custom';
    else if (!isFolderActive() && state.sort === 'custom') state.sort = 'newest';
    clearSearch(false);
    els.searchRow.hidden = true;
    save();
    renderAll({ resetScroll: true });
  }

  function onEmptyAction(e) {
    var b = e.target.closest('[data-empty-action]');
    if (!b) return;
    var action = b.dataset.emptyAction;
    if (action === 'permission') {
      if (state.permission === 'blocked') openPermissionSettings(); else requestPermission();
    } else if (action === 'refresh') refreshPhotos();
    else if (action === 'clear-search') clearSearch(true);
    else if (action === 'clear-filter') { clearDateFilter(); state.mediaFilter = 'all'; save(); renderAll({ resetScroll: true }); }
    else if (action === 'all') { state.active = ALL; save(); renderAll({ resetScroll: true }); }
    else if (action === 'folders') showFoldersView();
  }

  function requestPermission() {
    if (!isNative()) { toast('演示模式：安装到手机后可授权'); return; }
    if (state.permission === 'blocked') { openPermissionSettings(); return; }
    state.permission = 'requesting';
    state.loading = true;
    renderAll({ resetScroll: false });
    try { window.Native.requestPermission(); } catch (e) { toast('无法请求权限'); }
  }
  function openPermissionSettings() {
    if (!isNative()) { toast('演示模式'); return; }
    try { window.Native.openSettings(); } catch (e) {}
  }
  function refreshPhotos() {
    if (!isNative()) {
      state.loading = true;
      state.photos = [];
      renderAll({ resetScroll: false });
      setTimeout(function () {
        state.photos = dedupePhotos(DEMO_PHOTOS);
        state.loading = false;
        state.permission = 'granted';
        renderAll({ resetScroll: false });
      }, 400);
      return;
    }
    state.error = '';
    state.loading = true;
    renderAll({ resetScroll: false });
    try { window.Native.loadPhotos(); } catch (e) { state.loading = false; state.error = '刷新失败'; renderAll({}); }
  }
  function clearSearch(render) {
    state.query = '';
    if (els.boardSearch) els.boardSearch.value = state.folderQuery;
    els.searchInput.value = '';
    els.searchClear.hidden = true;
    els.searchBtn.classList.remove('active');
    els.searchRow.hidden = true;
    if (render) renderAll({ resetScroll: true });
  }
  function hideSearch() { clearSearch(true); }

  function onContentScroll() {
    closeAllPopovers();
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(function () {
      scrollRaf = 0;
      var el = els.content;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 520) appendPage();
    });
  }

  function updateToolControls() {
    var use = els.viewIcon.querySelector('use');
    var curIcon = state.view === 'grid' ? '#i-grid' : state.view === 'grid5' ? '#i-grid5' : '#i-list';
    if (use) use.setAttribute('href', curIcon);
    var curLabel = state.view === 'grid' ? '三张一行' : state.view === 'grid5' ? '五张一行' : '一张一行';
    els.viewBtn.title = '当前：' + curLabel + '，点击切换';
    els.viewBtn.setAttribute('aria-label', els.viewBtn.title);
    var labels = { all: '全部', image: '图片', video: '视频', animated: '动图', live: '实况' };
    els.filterLabel.textContent = hasDateFilter() && state.mediaFilter === 'all' ? '时间' : (labels[state.mediaFilter] || '全部');
    els.filterBtn.classList.toggle('active', state.mediaFilter !== 'all' || hasDateFilter());
    if (els.timeFilterLabel) els.timeFilterLabel.textContent = hasDateFilter() ? dateFilterLabel() : '未设置';
    $$('[data-filter]', els.filterMenu).forEach(function (b) {
      var on = b.dataset.filter === 'time' ? hasDateFilter() : b.dataset.filter === state.mediaFilter;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    var sortLabels = { newest: '最新', oldest: '最早', name: '名称', custom: '自定义' };
    els.sortLabel.textContent = sortLabels[state.sort] || '最新';
    $$('[data-sort]', els.sortMenu).forEach(function (b) {
      if (b.dataset.sort === 'custom') b.hidden = !isFolderActive();
      b.setAttribute('aria-checked', b.dataset.sort === state.sort ? 'true' : 'false');
    });
  }

  /* ---------------- time filter ---------------- */
  function openTimeFilter() {
    timeDraft = {
      year: state.dateFilter.year || null,
      month: state.dateFilter.month || null,
      day: state.dateFilter.day || null
    };
    timeStep = 'year';
    renderTimeFilter();
    openModal('timeFilterModal');
  }

  function availableTimeParts() {
    var years = {}, months = {}, days = {};
    state.photos.forEach(function (p) {
      var d = photoParts(p);
      if (!d.year || d.year < 1900) return;
      years[d.year] = true;
      if (timeDraft.year && d.year === timeDraft.year) {
        months[d.month] = true;
        if (timeDraft.month && d.month === timeDraft.month) days[d.day] = true;
      }
    });
    return {
      years: Object.keys(years).map(Number).sort(function (a, b) { return b - a; }),
      months: Object.keys(months).map(Number).sort(function (a, b) { return a - b; }),
      days: Object.keys(days).map(Number).sort(function (a, b) { return a - b; })
    };
  }

  function renderTimeFilter() {
    els.timeFilterList.innerHTML = '';
    var parts = availableTimeParts();
    var title = timeStep === 'year' ? '选择年份' : timeStep === 'month' ? '选择月份' : '选择日期';
    els.timeFilterTitle.textContent = title;
    els.timeFilterHint.textContent = '只显示相册中存在的日期；不选月份显示整年，不选日期显示整月。';
    els.timeFilterBack.hidden = timeStep === 'year';
    els.timeFilterClear.hidden = !hasDateFilter();
    els.timeFilterNext.textContent = timeStep === 'day' ? '确定' : '下一步';
    els.timeFilterNext.disabled = timeStep === 'year' && !timeDraft.year;

    function addOption(label, selected, onPick) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'time-option' + (selected ? ' active' : '');
      b.textContent = label;
      b.addEventListener('click', function () { onPick(); renderTimeFilter(); });
      els.timeFilterList.appendChild(b);
    }

    if (timeStep === 'year') {
      if (!parts.years.length) {
        var empty = document.createElement('div'); empty.className = 'time-empty'; empty.textContent = '相册里还没有可选日期'; els.timeFilterList.appendChild(empty);
      }
      parts.years.forEach(function (y) {
        addOption(String(y), timeDraft.year === y, function () {
          timeDraft.year = y; timeDraft.month = null; timeDraft.day = null;
        });
      });
    } else if (timeStep === 'month') {
      addOption('全年（' + timeDraft.year + '）', !timeDraft.month, function () {
        timeDraft.month = null; timeDraft.day = null;
      });
      parts.months.forEach(function (m) {
        addOption(m + '月', timeDraft.month === m, function () {
          timeDraft.month = m; timeDraft.day = null;
        });
      });
    } else {
      addOption('整月（' + timeDraft.year + '年' + timeDraft.month + '月）', !timeDraft.day, function () {
        timeDraft.day = null;
      });
      parts.days.forEach(function (d) {
        addOption(d + '日', timeDraft.day === d, function () { timeDraft.day = d; });
      });
    }
  }

  function applyTimeFilter() {
    if (!timeDraft.year) return;
    state.dateFilter = {
      year: timeDraft.year,
      month: timeDraft.month || null,
      day: timeDraft.day || null
    };
    closeModal('timeFilterModal');
    exitSelection();
    save();
    renderAll({ resetScroll: true });
  }

  function stepTimeFilter() {
    if (timeStep === 'year') {
      if (!timeDraft.year) return;
      timeStep = 'month';
      renderTimeFilter();
    } else if (timeStep === 'month') {
      if (!timeDraft.month) {
        timeDraft.day = null;
        applyTimeFilter();
        return;
      }
      timeStep = 'day';
      renderTimeFilter();
    } else {
      applyTimeFilter();
    }
  }

  function backTimeFilter() {
    if (timeStep === 'day') timeStep = 'month';
    else if (timeStep === 'month') timeStep = 'year';
    renderTimeFilter();
  }

  /* ---------------- popovers / sidebar ---------------- */

  function togglePopover(panel, anchor) {
    var wasOpen = !panel.hidden;
    closeAllPopovers();
    if (wasOpen) return;
    panel.hidden = false;
    anchor.setAttribute('aria-expanded', 'true');
    var rect = anchor.getBoundingClientRect();
    var w = panel.offsetWidth || 190;
    var h = panel.offsetHeight || 180;
    var left = Math.max(10, Math.min(window.innerWidth - w - 10, rect.right - w));
    var top = rect.bottom + 8;
    if (top + h > window.innerHeight - 10) top = Math.max(10, rect.top - h - 8);
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }
  function closeAllPopovers() {
    [els.sortMenu, els.filterMenu, els.appMenu].forEach(function (p) { if (p) p.hidden = true; });
    if (els.sortBtn) els.sortBtn.setAttribute('aria-expanded', 'false');
    if (els.filterBtn) els.filterBtn.setAttribute('aria-expanded', 'false');
    if (els.appMenuBtn) els.appMenuBtn.setAttribute('aria-expanded', 'false');
  }
  function toggleSidebar() {
    state.collapsed = !state.collapsed;
    els.app.classList.add('sidebar-animating');
    clearTimeout(sidebarAnimTimer);
    sidebarAnimTimer = setTimeout(function () { els.app.classList.remove('sidebar-animating'); }, 230);
    applySidebarState();
    save();
  }
  function onResize() {
    closeAllPopovers();
    updateScrollRail();
  }

  /* ---------------- tip ---------------- */
  function maybeTip() {
    if (state.tipDismissed || state.tipScheduled || state.demo || !state.photos.length) return;
    if (!els.tipToast.hidden) return;
    state.tipScheduled = true;
    setTimeout(function () {
      state.tipScheduled = false;
      if (!state.tipDismissed && state.photos.length) showTip(false);
    }, 1100);
  }
  function showTip(force) {
    if (state.demo && force) { toast('长按照片进入多选，再拖到左侧卡包'); return; }
    clearTimeout(tipTimer);
    els.tipToast.hidden = false;
    if (force) tipTimer = setTimeout(hideTip, 8000);
    else tipTimer = setTimeout(function () { state.tipDismissed = true; save(); hideTip(); }, 9500);
  }
  function hideTip() { els.tipToast.hidden = true; clearTimeout(tipTimer); }

  /* ---------------- drag & selection gestures ---------------- */
  function blockSelectionTouch() {
    if (selectionTouchBlocker) return;
    selectionTouchBlocker = function (ev) { if (ev.cancelable) ev.preventDefault(); };
    document.addEventListener('touchmove', selectionTouchBlocker, { passive: false });
  }
  function unblockSelectionTouch() {
    if (!selectionTouchBlocker) return;
    document.removeEventListener('touchmove', selectionTouchBlocker);
    selectionTouchBlocker = null;
  }

  function bindCardPress(card, photo) {
    card.addEventListener('pointerdown', function (e) {
      if (drag) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('button')) return;
      clearPress();
      var selected = !!state.selected[photo.id];
      if (state.selectionMode && selected) blockSelectionTouch();
      press = {
        card: card, photo: photo, id: e.pointerId,
        x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY,
        pointerType: e.pointerType || 'touch', active: false, timer: 0,
        dragOnMove: (!state.selectionMode && e.pointerType === 'mouse') || (state.selectionMode && selected),
        selectedByHold: false
      };
      if (!state.selectionMode) {
        press.timer = setTimeout(function () {
          if (!press || press.active || !press.card) return;
          blockSelectionTouch();
          enterSelection(press.photo.id);
          press.selectedByHold = true;
          press.dragOnMove = true;
        }, 220);
      }
    });
  }

  function clearPress() {
    if (press && press.timer) clearTimeout(press.timer);
    press = null;
    unblockSelectionTouch();
  }

  function onPointerMove(e) {
    if (press && !press.active) {
      if (e.pointerId !== press.id) return;
      press.x = e.clientX; press.y = e.clientY;
      var dx0 = e.clientX - press.startX;
      var dy0 = e.clientY - press.startY;
      var dist = Math.sqrt(dx0 * dx0 + dy0 * dy0);
      if (press.dragOnMove && dist > 6) {
        beginDrag(e.clientX, e.clientY);
      } else if (!press.selectedByHold && dist > 10) {
        clearPress();
        return;
      }
    }
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    updateDrag(e.clientX, e.clientY);
  }

  function beginDrag(x, y) {
    if (!press || drag) return;
    var ids = state.selectionMode ? selectedIds() : [press.photo.id];
    if (!ids.length) ids = [press.photo.id];
    if (state.selectionMode && !state.selected[press.photo.id]) return;
    var batch = state.selectionMode && ids.length > 1;
    press.active = true;
    try { press.card.setPointerCapture(press.id); } catch (e) {}
    var rect = press.card.getBoundingClientRect();
    var ghost = document.createElement('div');
    ghost.className = 'drag-ghost' + (batch ? ' batch' : '');
    if (batch) {
      var bi = document.createElement('img');
      bi.src = 'batch-drag.png';
      bi.alt = '';
      var count = document.createElement('div');
      count.className = 'dg-count';
      count.textContent = ids.length + ' 项';
      var badge = document.createElement('div');
      badge.className = 'dg-badge';
      badge.innerHTML = svgIcon('move') + '<span>批量拖动</span>';
      ghost.appendChild(bi); ghost.appendChild(count); ghost.appendChild(badge);
    } else {
      var im = document.createElement('img');
      im.alt = '';
      var sourceImg = press.card.querySelector('img.thumb');
      im.src = sourceImg ? sourceImg.src : thumbUrl(press.photo);
      var name = document.createElement('div');
      name.className = 'dg-name'; name.textContent = press.photo.name;
      var badge2 = document.createElement('div');
      badge2.className = 'dg-badge'; badge2.innerHTML = svgIcon('move') + '<span>拖动中</span>';
      ghost.appendChild(im); ghost.appendChild(name); ghost.appendChild(badge2);
    }
    document.body.appendChild(ghost);
    ids.forEach(function (id) {
      var c = document.querySelector('.photo-card[data-photo-id="' + cssEscape(id) + '"]');
      if (c) c.classList.add('is-source');
    });
    document.body.classList.add('is-dragging');
    drag = {
      card: press.card, photo: press.photo, ids: ids, batch: batch, ghost: ghost, tip: null,
      pointerId: press.id, startX: press.startX, startY: press.startY,
      moved: false, fromTrash: isTrashActive(), targetRow: null, targetFolder: null, targetCard: null, cardRect: null, reorderAfter: false, raf: 0, pendingX: x, pendingY: y
    };
    updateDrag(x, y);
    haptic(12);
  }

  function updateDrag(x, y) {
    if (!drag) return;
    drag.pendingX = x;
    drag.pendingY = y;
    if (drag.raf) return;
    drag.raf = requestAnimationFrame(function () {
      if (!drag) return;
      drag.raf = 0;
      applyDrag(drag.pendingX, drag.pendingY);
    });
  }

  function applyDrag(x, y) {
    if (!drag) return;
    var dx = x - drag.startX, dy = y - drag.startY;
    if (!drag.moved && Math.sqrt(dx * dx + dy * dy) > 4) drag.moved = true;
    var w = drag.batch ? 58 : 78;
    var h = drag.batch ? 58 : 82;
    var left = clamp(x - w / 2, 4, window.innerWidth - w - 4);
    var top = clamp(y - h / 2, 4, window.innerHeight - h - 4);
    drag.ghost.style.transform = 'translate3d(' + left + 'px,' + top + 'px,0) rotate(' + (drag.batch ? -3 : -2.5) + 'deg)';
    var under = document.elementFromPoint(x, y);
    var row = under ? under.closest('[data-drop-folder]') : null;
    var card = (!row && isFolderActive() && state.selectionMode && under) ? under.closest('.photo-card') : null;
    if (card && (state.selected[card.dataset.photoId] || drag.ids.indexOf(card.dataset.photoId) >= 0)) card = null;

    if (drag.targetRow !== row) {
      if (drag.targetRow) drag.targetRow.classList.remove('drop-hover');
      drag.targetRow = row;
      drag.targetFolder = row ? row.getAttribute('data-drop-folder') : null;
      if (row) row.classList.add('drop-hover');
    }
    if (drag.targetCard !== card) {
      if (drag.targetCard) drag.targetCard.classList.remove('reorder-hover', 'reorder-before', 'reorder-after');
      drag.targetCard = card;
      drag.cardRect = card ? card.getBoundingClientRect() : null;
      drag.reorderAfter = null;
      if (card) card.classList.add('reorder-hover');
    }
    if (drag.targetCard && drag.cardRect) {
      var after = x > drag.cardRect.left + drag.cardRect.width / 2;
      if (after !== drag.reorderAfter) {
        drag.reorderAfter = after;
        drag.targetCard.classList.toggle('reorder-after', after);
        drag.targetCard.classList.toggle('reorder-before', !after);
      }
    }
  }

  function reorderFolderMedia(ids, targetId, after) {
    if (!isFolderActive() || !targetId) return;
    var order = state.folderOrders[state.active] ? state.folderOrders[state.active].slice() : state.filtered.map(function (p) { return p.id; });
    state.filtered.forEach(function (p) { if (order.indexOf(p.id) < 0) order.push(p.id); });
    var moving = order.filter(function (id) { return ids.indexOf(id) >= 0; });
    if (!moving.length || moving.indexOf(targetId) >= 0) return;
    var rest = order.filter(function (id) { return ids.indexOf(id) < 0; });
    var at = rest.indexOf(targetId);
    if (at < 0) at = rest.length - 1;
    if (after) at += 1;
    rest.splice.apply(rest, [at, 0].concat(moving));
    state.folderOrders[state.active] = rest;
    state.sort = 'custom';
    save();
    exitSelection();
    renderAll({ resetScroll: false });
    toast('已调整卡包内顺序');
  }

  function onPointerUp(e) {
    if (drag && e.pointerId === drag.pointerId) { finishDrag(); return; }
    if (press && e.pointerId === press.id) {
      if (press.selectedByHold) state.suppressClickUntil = now() + 320;
      clearPress();
    }
  }

  function finishDrag() {
    if (!drag) return;
    var d = drag;
    drag = null;
    state.suppressClickUntil = now() + 500;
    if (d.targetRow) d.targetRow.classList.remove('drop-hover');
    if (d.targetCard) d.targetCard.classList.remove('reorder-hover', 'reorder-before', 'reorder-after');
    d.ids.forEach(function (id) {
      var c = document.querySelector('.photo-card[data-photo-id="' + cssEscape(id) + '"]');
      if (c) c.classList.remove('is-source');
    });
    document.body.classList.remove('is-dragging');
    try { d.card.releasePointerCapture(d.pointerId); } catch (e) {}
    if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; }
    if (d.targetFolder) {
      var rect = d.targetRow.getBoundingClientRect();
      var left = rect.left + 12;
      var top = rect.top + rect.height / 2 - 36;
      d.ghost.style.transition = 'transform .16s ease, opacity .16s ease';
      d.ghost.style.transform = 'translate3d(' + left + 'px,' + top + 'px,0) rotate(-3deg) scale(.7)';
      d.ghost.style.opacity = '0';
      setTimeout(function () { if (d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost); }, 170);
      var target = d.targetFolder === UNCAT_DROP ? UNCAT : d.targetFolder;
      if (d.fromTrash) restoreFromTrash(d.ids, target);
      else assignMany(d.ids, target, 'add');
    } else if (d.targetCard) {
      d.ghost.style.transition = 'opacity .14s ease';
      d.ghost.style.opacity = '0';
      setTimeout(function () { if (d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost); }, 150);
      reorderFolderMedia(d.ids, d.targetCard.dataset.photoId, d.reorderAfter);
    } else {
      d.ghost.style.transition = 'opacity .14s ease';
      d.ghost.style.opacity = '0';
      setTimeout(function () { if (d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost); }, 150);
    }
    if (press) clearPress();
    unblockSelectionTouch();
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  /* ---------------- bottom tabs / scroll rail ---------------- */
  function setTab(tab) {
    if (tab !== 'album') {
      closeAllPopovers();
      if (!els.viewer.hidden) closeViewer();
      if (state.selectionMode) exitSelection();
    }
    state.tab = tab;
    var away = tab !== 'album';
    els.app.classList.toggle('app-tab-away', away);
    els.placeholderPage.hidden = tab !== 'cloud';
    els.mePage.hidden = tab !== 'me';
    if (tab === 'cloud') {
      els.placeholderTitle.textContent = '云空间';
      els.placeholderPage.querySelector('p').textContent = '正在施工中，尽请期待';
    }
    $$('.bottom-tab', els.bottomNav).forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    updateScrollRail();
  }

  function updateScrollRail() {
    if (!els.scrollRail) return;
    if (state.tab !== 'album' || state.viewerId) {
      els.scrollRail.hidden = true;
      return;
    }
    var el = els.content;
    var max = el.scrollHeight - el.clientHeight;
    if (max < 12) { els.scrollRail.hidden = true; return; }
    els.scrollRail.hidden = false;
    var track = els.scrollRail.clientHeight;
    var h = Math.max(40, Math.min(84, Math.round(track * el.clientHeight / el.scrollHeight)));
    var top = Math.round((el.scrollTop / max) * (track - h));
    els.scrollThumb.style.height = h + 'px';
    els.scrollThumb.style.transform = 'translate3d(0,' + top + 'px,0)';
  }

  function startRailDrag(e) {
    if (railDrag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    var railRect = els.scrollRail.getBoundingClientRect();
    var thumbRect = els.scrollThumb.getBoundingClientRect();
    var track = els.scrollRail.clientHeight;
    var h = thumbRect.height;
    if (e.target !== els.scrollThumb) {
      var y = e.clientY - railRect.top - h / 2;
      var ratio = clamp(y / Math.max(1, track - h), 0, 1);
      els.content.scrollTop = ratio * (els.content.scrollHeight - els.content.clientHeight);
      updateScrollRail();
    }
    railDrag = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startScroll: els.content.scrollTop,
      track: track,
      thumb: h
    };
    try { els.scrollThumb.setPointerCapture(e.pointerId); } catch (err) {}
    document.addEventListener('pointermove', moveRailDrag, { passive: false });
    document.addEventListener('pointerup', endRailDrag);
    document.addEventListener('pointercancel', endRailDrag);
  }

  function moveRailDrag(e) {
    if (!railDrag || e.pointerId !== railDrag.pointerId) return;
    e.preventDefault();
    var max = els.content.scrollHeight - els.content.clientHeight;
    var span = Math.max(1, railDrag.track - railDrag.thumb);
    els.content.scrollTop = railDrag.startScroll + ((e.clientY - railDrag.startY) / span) * max;
    updateScrollRail();
  }

  function endRailDrag(e) {
    if (!railDrag || (e && e.pointerId !== railDrag.pointerId)) return;
    railDrag = null;
    document.removeEventListener('pointermove', moveRailDrag);
    document.removeEventListener('pointerup', endRailDrag);
    document.removeEventListener('pointercancel', endRailDrag);
  }

  /* ---------------- folder reorder ---------------- */
  function onFolderReorderStart(e) {
    if (folderReorder || drag || state.folderQuery.trim()) return;
    var row = e.target.closest('.folder-row[data-view="folder"]');
    if (!row || !els.sideNav.contains(row)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var startY = e.clientY;
    var pointerId = e.pointerId;
    var timer = 0;
    var preMove = function (ev) {
      if (ev.pointerId !== pointerId) return;
      if (Math.abs(ev.clientY - startY) > 8) cancel();
    };
    var cancel = function () {
      clearTimeout(timer);
      document.removeEventListener('pointermove', preMove);
      document.removeEventListener('pointerup', cancel);
      document.removeEventListener('pointercancel', cancel);
    };
    document.addEventListener('pointermove', preMove, { passive: true });
    document.addEventListener('pointerup', cancel);
    document.addEventListener('pointercancel', cancel);
    timer = setTimeout(function () {
      cancel();
      startFolderReorder(row, pointerId, startY);
    }, 360);
  }

  function startFolderReorder(row, pointerId, startY) {
    var rows = $$('.folder-row[data-view="folder"]', els.sideNav);
    var index = -1;
    for (var i = 0; i < rows.length; i++) if (rows[i] === row) { index = i; break; }
    if (index < 0) return;
    var rects = rows.map(function (r) { return r.getBoundingClientRect(); });
    var step = rects.length > 1 ? rects[1].top - rects[0].top : rects[0].height + 3;
    folderReorder = {
      row: row, rows: rows, rects: rects, index: index, targetIndex: index,
      pointerId: pointerId, startY: startY, step: step
    };
    state.suppressClickUntil = now() + 1600;
    row.classList.add('reorder-active');
    els.sideNav.classList.add('reorder-on');
    document.body.classList.add('folder-reordering');
    reorderTouchBlocker = function (ev) { if (ev.cancelable) ev.preventDefault(); };
    document.addEventListener('touchmove', reorderTouchBlocker, { passive: false });
    haptic(10);
    document.addEventListener('pointermove', onFolderReorderMove, { passive: false });
    document.addEventListener('pointerup', endFolderReorder);
    document.addEventListener('pointercancel', endFolderReorder);
  }

  function onFolderReorderMove(e) {
    if (!folderReorder || e.pointerId !== folderReorder.pointerId) return;
    e.preventDefault();
    var d = folderReorder;
    var dy = e.clientY - d.startY;
    d.row.style.transform = 'translate3d(0,' + dy + 'px,0)';
    var target = d.index;
    for (var i = 0; i < d.rows.length; i++) {
      if (i === d.index) continue;
      var mid = d.rects[i].top + d.rects[i].height / 2;
      if (d.index < i && e.clientY > mid) target = i;
      if (d.index > i && e.clientY < mid) target = i;
    }
    target = clamp(target, 0, d.rows.length - 1);
    d.targetIndex = target;
    d.rows.forEach(function (el, j) {
      if (j === d.index) return;
      var shift = 0;
      if (d.index < target && j > d.index && j <= target) shift = -d.step;
      else if (d.index > target && j < d.index && j >= target) shift = d.step;
      el.style.transform = shift ? 'translate3d(0,' + shift + 'px,0)' : '';
    });
  }

  function endFolderReorder(e) {
    if (!folderReorder) return;
    if (e && e.pointerId !== folderReorder.pointerId) return;
    var d = folderReorder;
    folderReorder = null;
    d.row.style.transform = '';
    d.rows.forEach(function (el) { el.style.transform = ''; });
    d.row.classList.remove('reorder-active');
    els.sideNav.classList.remove('reorder-on');
    document.body.classList.remove('folder-reordering');
    if (reorderTouchBlocker) {
      document.removeEventListener('touchmove', reorderTouchBlocker);
      reorderTouchBlocker = null;
    }
    document.removeEventListener('pointermove', onFolderReorderMove);
    document.removeEventListener('pointerup', endFolderReorder);
    document.removeEventListener('pointercancel', endFolderReorder);
    if (d.targetIndex !== d.index) {
      var moved = state.folders.splice(d.index, 1)[0];
      state.folders.splice(d.targetIndex, 0, moved);
      save();
      renderAll({ resetScroll: false });
      toast('已调整卡包顺序');
    }
    state.suppressClickUntil = now() + 1200;
  }

  /* ---------------- keyboard / back ---------------- */

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (state.tab !== 'album') { setTab('album'); e.preventDefault(); return; }
      if (closeTopModal()) { e.preventDefault(); return; }
      if (!els.sortMenu.hidden || !els.filterMenu.hidden || !els.appMenu.hidden) { closeAllPopovers(); e.preventDefault(); return; }
      if (state.selectionMode) { exitSelection(); e.preventDefault(); return; }
      if (!els.viewer.hidden) { closeViewer(); e.preventDefault(); return; }
      if (!els.searchRow.hidden) { hideSearch(); e.preventDefault(); return; }
    }
    if (!els.viewer.hidden && !anyModalOpen()) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); navigateViewer(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); navigateViewer(1); }
    }
  }

  window.__onAndroidBack = function () {
    if (state.tab !== 'album') { setTab('album'); return true; }
    if (closeTopModal()) return true;
    if (!els.sortMenu.hidden || !els.filterMenu.hidden || !els.appMenu.hidden) { closeAllPopovers(); return true; }
    if (state.selectionMode) { exitSelection(); return true; }
    if (!els.viewer.hidden) { closeViewer(); return true; }
    if (!els.searchRow.hidden) { hideSearch(); return true; }
    return false;
  };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
