/* Daily photo certification. Uses the existing certificate tables and login. */
(function () {
  'use strict';
  var prefix = 'dpc_';
  var selectedDate = koreaDate();
  var configs = [];
  var records = [];
  var ready = false;
  var busy = false;
  var refreshToken = 0;
  var previewUrl = '';
  var pendingUpload = null;
  var previewDialog = null;
  var icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3L7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>';

  function koreaDate(date) {
    return new Date((date || new Date()).getTime() + 32400000).toISOString().slice(0, 10);
  }
  function text(element, value) { element.textContent = value; return element; }
  function el(tag, className, value) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }
  function targetIds(config) {
    try { var value = JSON.parse(config.targets || '[]'); return Array.isArray(value) ? value : []; }
    catch (_) { return []; }
  }
  function targetUsers() {
    var ids = configs.flatMap(targetIds);
    return db.users.filter(function (user) { return user.role === 'student' && ids.includes(user.id); });
  }
  function myConfig() {
    return configs.find(function (config) { return targetIds(config).includes(session.id); });
  }
  function currentRecord(studentId) {
    return records.find(function (record) { return record.student_id === studentId; });
  }
  function photoUrls(record) {
    if (!record || !record.photo_url) return [];
    try { var urls = JSON.parse(record.photo_url); return Array.isArray(urls) ? urls.filter(validPhotoUrl) : []; }
    catch (_) { return validPhotoUrl(record.photo_url) ? [record.photo_url] : []; }
  }
  function validPhotoUrl(value) {
    if (typeof value === 'string' && value.length <= 720000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return true;
    try { var url = new URL(value); return url.origin === SB_URL && url.pathname.startsWith('/storage/v1/object/public/qa-files/daily-proof/'); }
    catch (_) { return false; }
  }
  function statusText(record) {
    if (!record || !photoUrls(record).length) return '미제출';
    if (record.status === 'approved') return '확인 완료';
    if (record.status === 'rejected') return '다시 확인';
    return '확인 대기';
  }
  function message(value, error) {
    var node = document.getElementById(session && session.role === 'teacher' ? 'dp-teacher-message' : 'dp-student-message');
    if (node) { node.textContent = value; node.className = 'dp-message' + (error ? ' dp-error' : ''); }
  }

  function install() {
    ['teacher', 'student'].forEach(function (role) {
      var page = document.getElementById('page-' + role);
      var nav = page.querySelector('.sidebar-nav');
      var link = el('div', 'nav-item');
      link.dataset.p = 'study-proof'; link.innerHTML = icon;
      link.append(document.createTextNode('국어 공부 인증'));
      link.tabIndex = 0; link.setAttribute('role', 'button');
      function open() { (role === 'teacher' ? tNav : sNav)('study-proof'); }
      link.addEventListener('click', open);
      link.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
      nav.append(link);
      var panel = el('section', 'panel dp-panel');
      panel.id = 'panel-study-proof';
      var holder = page.querySelector('.main-inner');
      holder.append(panel);
      var tabbar = document.getElementById(role === 'teacher' ? 't-tabbar' : 's-tabbar');
      var tab = el('button', 'mobile-tab');
      tab.type = 'button'; tab.innerHTML = icon;
      tab.append(document.createTextNode('공부 인증'));
      tab.style.minWidth = '65px';
      tab.dataset[role === 'teacher' ? 'mt' : 'ms'] = 'study-proof';
      tab.addEventListener('click', open); tabbar.append(tab);
      if (role === 'teacher') buildTeacher(panel); else buildStudent(panel);
    });
    var originalTeacherNav = tNav;
    tNav = function (panel) { originalTeacherNav(panel); if (panel === 'study-proof') void refresh(); };
    var originalStudentNav = sNav;
    sNav = function (panel) { originalStudentNav(panel); if (panel === 'study-proof') { selectedDate = koreaDate(); void refresh(); } };
    document.addEventListener('visibilitychange', function () { if (!document.hidden && isOpen()) void refresh(); });
    setInterval(function () { if (!document.hidden && isOpen() && !busy) void refresh(); }, 30000);
  }
  function isOpen() {
    return !!session && !!document.querySelector('#page-' + session.role + '.active .dp-panel.active');
  }
  function heading(panel, title, description) {
    var head = el('div', 'page-header');
    head.append(el('h1', '', title), el('p', '', description)); panel.append(head);
  }
  function buildStudent(panel) {
    heading(panel, '국어 공부 인증', '열품타 화면이나 공부한 내용을 사진으로 올려 주세요.');
    panel.innerHTML += '<div class="dp-notice">매일 밤 11시까지 · 문자 자동 안내는 아직 꺼져 있어요.</div>' +
      '<div class="card dp-card"><div id="dp-student-intro" class="dp-intro">인증 대상을 확인하고 있어요.</div>' +
      '<form id="dp-form" hidden><label class="flabel" for="dp-photo">오늘의 공부 사진</label>' +
      '<input id="dp-photo" class="form-input" type="file" accept="image/jpeg,image/png,image/webp" required>' +
      '<p class="dp-muted">JPG · PNG · WebP / 최대 8MB. 사진에서 날짜와 공부 내용이 보이게 올려 주세요.</p>' +
      '<img id="dp-preview" class="dp-preview" hidden alt="선택한 사진 미리보기">' +
      '<button class="btn blue" id="dp-submit" type="submit">오늘의 공부 인증 올리기</button></form>' +
      '<p id="dp-student-message" class="dp-message" role="status"></p></div>' +
      '<div class="card dp-card"><h3>오늘 내가 올린 사진</h3><div id="dp-my-record" class="dp-record"></div></div>';
    document.getElementById('dp-photo').addEventListener('change', function (event) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      pendingUpload = null;
      var file = event.target.files[0];
      var image = document.getElementById('dp-preview');
      image.hidden = true; image.removeAttribute('src');
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8388608 || file.size === 0) {
        event.target.value = ''; message('8MB 이하 JPG, PNG, WebP 사진을 선택해 주세요.', true); return;
      }
      previewUrl = URL.createObjectURL(file); image.src = previewUrl; image.hidden = false; message('');
    });
    document.getElementById('dp-form').addEventListener('submit', submit);
  }
  function buildTeacher(panel) {
    heading(panel, '국어 공부 인증', '학생별 사진 제출과 확인 상태를 날짜별로 모아 봅니다.');
    panel.innerHTML += '<div class="dp-notice">운영 준비 중 · 휴대폰 알림과 문자 예약은 꺼져 있어요. 보충 안내 기준은 당일 오후 2시 한 번입니다.</div>' +
      '<div class="dp-toolbar"><label>집계 날짜 <input id="dp-date" class="form-input" type="date"></label>' +
      '<div><button type="button" class="btn" id="dp-refresh">새로고침</button> <button type="button" class="btn" id="dp-export">목록 저장</button></div></div>' +
      '<div id="dp-summary" class="dp-summary"></div><p id="dp-teacher-message" class="dp-message" role="status"></p>' +
      '<div id="dp-students" class="dp-grid"></div>';
    var input = document.getElementById('dp-date');
    input.value = selectedDate; input.max = koreaDate();
    input.addEventListener('change', function () { if (input.value) { selectedDate = input.value; void refresh(); } });
    document.getElementById('dp-refresh').addEventListener('click', refresh);
    document.getElementById('dp-export').addEventListener('click', exportCsv);
  }

  async function refresh() {
    if (!session) return;
    var token = ++refreshToken;
    var userId = session.id;
    var date = session.role === 'student' ? koreaDate() : selectedDate;
    try {
      var configResponse = await sb.from('cert_items').select('*').like('id', prefix + 'item_%');
      if (configResponse.error) throw configResponse.error;
      var query = sb.from('cert_submissions').select('*').like('id', 'dps_' + date.replaceAll('-', '') + '_%').order('submitted_at', { ascending: false });
      if (session.role === 'student') query = query.eq('student_id', userId);
      var response = await query;
      if (response.error) throw response.error;
      if (token !== refreshToken || !session || session.id !== userId) return;
      configs = configResponse.data || []; records = response.data || []; ready = true;
      render();
    } catch (_) {
      if (token !== refreshToken) return;
      ready = false; message('제출 기록을 불러오지 못했어요. 새로고침을 눌러 주세요.', true);
      if (session && session.role === 'teacher') {
        text(document.getElementById('dp-summary'), '조회 실패 · 제출 상태를 확인해 주세요.');
        document.getElementById('dp-students').replaceChildren();
      }
    }
  }
  function render() {
    if (!session) return;
    if (session.role === 'teacher') renderTeacher(); else renderStudent();
  }
  function renderStudent() {
    var config = myConfig();
    var intro = document.getElementById('dp-student-intro');
    intro.textContent = config ? session.name + ' 학생 · ' + koreaDate() + ' 공부 기록' : '아직 국어 공부 인증 대상으로 지정되지 않았어요.';
    document.getElementById('dp-form').hidden = !config;
    var holder = document.getElementById('dp-my-record'); holder.replaceChildren();
    var record = currentRecord(session.id);
    if (!record || !photoUrls(record).length) { holder.append(el('p', 'dp-muted', '오늘 올린 사진이 없어요.')); return; }
    holder.append(el('span', 'badge partial', statusText(record)), el('p', 'dp-muted', formatTime(record.submitted_at) + ' 제출'));
    addPhotos(holder, record);
  }
  function renderTeacher() {
    var users = targetUsers();
    var count = users.filter(function (user) { return photoUrls(currentRecord(user.id)).length; }).length;
    text(document.getElementById('dp-summary'), '대상 ' + users.length + '명 · 사진 제출 ' + count + '명 · 미제출 ' + (users.length - count) + '명');
    var container = document.getElementById('dp-students'); container.replaceChildren();
    if (!users.length) { container.append(el('p', 'dp-muted', '등록된 공부 인증 대상이 없어요.')); return; }
    users.forEach(function (user) {
      var record = currentRecord(user.id);
      var card = el('article', 'card dp-card');
      var head = el('div', 'dp-row'); head.append(el('h3', '', user.name), el('span', 'badge ' + (record ? 'partial' : 'none'), statusText(record))); card.append(head);
      if (record) {
        card.append(el('p', 'dp-muted', formatTime(record.submitted_at) + ' 제출'));
        addPhotos(card, record);
        var actions = el('div', 'dp-actions');
        [['approved', '확인 완료'], ['rejected', '다시 확인']].forEach(function (item) {
          var button = el('button', 'btn' + (record.status === item[0] ? ' blue' : ''), item[1]);
          button.type = 'button';
          button.addEventListener('click', function () { void review(record, item[0]); });
          actions.append(button);
        });
        card.append(actions);
      } else { card.append(el('p', 'dp-empty', '아직 인증 사진을 올리지 않았어요.')); }
      container.append(card);
    });
    message('밤 11시 집계와 미제출 안내 문자 · 현재 미예약');
  }
  function formatTime(value) {
    return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
  }
  function addPhotos(holder, record) {
    var urls = photoUrls(record);
    urls.forEach(function (url) {
      var button = el('button', 'dp-photo-button'); button.type = 'button';
      var image = el('img', 'dp-photo'); image.src = url; image.alt = '제출한 공부 인증 사진'; image.loading = 'lazy';
      button.append(image, el('span', '', '사진 크게 보기'));
      button.addEventListener('click', function () {
        if (previewDialog) previewDialog.remove();
        previewDialog = el('dialog', 'dp-dialog');
        var close = el('button', 'btn', '닫기'); close.type = 'button'; close.addEventListener('click', function () { previewDialog.close(); });
        var full = el('img'); full.src = url; full.alt = '공부 인증 사진';
        previewDialog.append(close, full); document.body.append(previewDialog); previewDialog.showModal();
      });
      holder.append(button);
    });
  }
  async function submit(event) {
    event.preventDefault();
    if (busy || !session || session.role !== 'student' || !ready || !myConfig()) return;
    var file = document.getElementById('dp-photo').files[0];
    if (!file) return;
    busy = true; document.getElementById('dp-submit').disabled = true;
    var user = { id: session.id, school: session.school_id };
    var config = myConfig();
    var date = koreaDate();
    var id = 'dps_' + date.replaceAll('-', '') + '_' + user.id;
    try {
      message('사진을 저장하고 있어요.');
      if (!pendingUpload || pendingUpload.file !== file || pendingUpload.id !== id) {
        pendingUpload = { file: file, id: id, photo: await preparePhoto(file), submittedAt: new Date().toISOString() };
      }
      var attempt = pendingUpload;
      var url = attempt.photo;
      var payload = { id: id, item_id: config.id, student_id: user.id, school_id: config.school_id, status: 'pending', photo_url: JSON.stringify([url]), submitted_at: attempt.submittedAt };
      var result = await sb.from('cert_submissions').upsert(payload, { onConflict: 'id' });
      if (result.error) throw result.error;
      if (!session || session.id !== user.id) return;
      document.getElementById('dp-photo').value = '';
      document.getElementById('dp-preview').hidden = true;
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = ''; }
      pendingUpload = null;
      await refresh(); message('오늘의 공부 인증을 올렸어요. 선생님이 확인할게요.');
    } catch (_) { message('저장 완료를 확인하지 못했어요. 같은 사진으로 다시 제출해 주세요.', true); }
    finally { busy = false; document.getElementById('dp-submit').disabled = false; }
  }
  async function preparePhoto(file) {
    var url = URL.createObjectURL(file);
    try {
      var image = new Image();
      image.src = url;
      await image.decode();
      var sizes = [1920, 1440, 1080];
      var qualities = [0.85, 0.75, 0.65];
      for (var i = 0; i < sizes.length; i++) {
        var scale = Math.min(1, sizes[i] / Math.max(image.naturalWidth, image.naturalHeight));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        var context = canvas.getContext('2d');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        var result = canvas.toDataURL('image/jpeg', qualities[i]);
        if (result.length <= 700000) return result;
      }
      throw new Error('Photo is too large');
    } finally { URL.revokeObjectURL(url); }
  }
  async function review(record, status) {
    if (!session || session.role !== 'teacher') return;
    var result = await sb.from('cert_submissions').update({ status: status }).eq('id', record.id);
    if (result.error) { message('확인 상태를 저장하지 못했어요.', true); return; }
    await refresh();
  }
  function exportCsv() {
    if (!ready || !session || session.role !== 'teacher') return;
    var lines = [['날짜', '학생', '제출 상태', '제출 시각']];
    targetUsers().forEach(function (user) { var record = currentRecord(user.id); lines.push([selectedDate, user.name, statusText(record), record ? formatTime(record.submitted_at) : '']); });
    var csv = '\uFEFF' + lines.map(function (row) { return row.map(function (value) { return '"' + value.replaceAll('"', '""') + '"'; }).join(','); }).join('\r\n');
    var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    var link = el('a'); link.href = url; link.download = '국어공부인증_' + selectedDate + '.csv'; link.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  install();
})();
