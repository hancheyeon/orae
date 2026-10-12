/* Account-scoped workspace: fresh accounts start empty and user-created cards drive study. */
(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const sessionId = () => sessionStorage.getItem('orae-session');
  const workspaceKey = id => `orae-workspace:${id}`;
  const emptyWorkspace = () => ({ folders: [], questions: [], reviews: [], createdAt: new Date().toISOString() });
  let workspace = emptyWorkspace();
  let studyQueue = [];
  let freshStudyIndex = 0;
  let editingQuestionId = null;
  let editingFolderId = null;
  let draggedFolderId = null;
  let pendingDeleteId = null;
  let pendingFolderDeleteId = null;
  let managementMode = null;
  let outlineRootId = 'root';
  let sessionReviewed = new Set();
  let currentHintUsed = false;
  let lastReviewAction = null;
  let currentSessionId = null;
  let currentSessionStartedAt = 0;
  const DAY_MS = 86400000;
  const NEW_CARD_RECOMMENDATION = 20;

  function learningDayKey(date = new Date()) { const seoul = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' })); seoul.setHours(seoul.getHours() - 4); return `${seoul.getFullYear()}-${String(seoul.getMonth() + 1).padStart(2, '0')}-${String(seoul.getDate()).padStart(2, '0')}`; }
  function activeReviews() { return workspace.reviews.filter(item => !item.undone); }
  function reviewsToday() { const day = learningDayKey(); return activeReviews().filter(item => (item.learningDay || learningDayKey(new Date(item.reviewedAt))) === day); }
  function uniqueCardsToday() { return new Set(reviewsToday().map(item => item.questionId)).size; }
  function defaultSchedule(createdAt) { return { due: createdAt || new Date().toISOString(), lastReview: null, stability: 0, difficulty: 5, reps: 0, lapses: 0, consecutiveSuccess: 0, problemCard: false, suspended: false, algorithm: 'prototype-fsrs-6' }; }
  function scheduleOf(item) { item.schedule ||= defaultSchedule(item.createdAt); return item.schedule; }
  function isIncomplete(item) { return !textFromHtml(item.prompt) || !textFromHtml(item.answer); }
  function isDue(item, now = Date.now()) { const state = scheduleOf(item); return !state.suspended && !isIncomplete(item) && state.reps > 0 && new Date(state.due).getTime() <= now; }
  function isNew(item) { const state = scheduleOf(item); return !state.suspended && !isIncomplete(item) && state.reps === 0; }
  function dueQuestions(items = workspace.questions) { return items.filter(item => isDue(item)).sort((a, b) => retrievability(a) - retrievability(b) || new Date(scheduleOf(a).due) - new Date(scheduleOf(b).due)); }
  function retrievability(item, now = Date.now()) { const state = scheduleOf(item); if (!state.lastReview || !state.stability) return 0; const elapsed = Math.max(0, now - new Date(state.lastReview).getTime()) / DAY_MS; return Math.pow(1 + 0.234567 * elapsed / state.stability, -0.5); }
  function newCardsStudiedToday() { return new Set(reviewsToday().filter(item => item.wasNew).map(item => item.questionId)).size; }
  function intervalFor(state, rating) { if (rating === 'again') return 10 / 1440; if (state.reps === 0) return ({ hard: 1, good: 3, easy: 7 })[rating]; const factor = ({ hard: 1.25, good: 2.4, easy: 3.6 })[rating]; return Math.max(1, state.stability * factor * (1 + (10 - state.difficulty) / 25)); }
  function updateSchedule(item, rating, reviewedAt) { const state = scheduleOf(item), wasNew = state.reps === 0, interval = intervalFor(state, rating); state.lastReview = reviewedAt; state.reps += 1; if (rating === 'again') { state.lapses += 1; state.consecutiveSuccess = 0; state.stability = Math.max(.1, state.stability ? state.stability * .35 : .1); state.difficulty = Math.min(10, state.difficulty + .8); } else { state.consecutiveSuccess += 1; state.stability = Math.max(interval, state.stability || interval); state.difficulty = Math.max(1, Math.min(10, state.difficulty + ({ hard: .25, good: -.15, easy: -.45 })[rating])); } state.problemCard = state.lapses >= 8 && state.consecutiveSuccess < 3; state.due = new Date(new Date(reviewedAt).getTime() + interval * DAY_MS).toISOString(); return wasNew; }
  function rebuildSchedule(item) { item.schedule = defaultSchedule(item.createdAt); activeReviews().filter(review => review.questionId === item.id).sort((a, b) => new Date(a.reviewedAt) - new Date(b.reviewedAt)).forEach(review => updateSchedule(item, review.rating, review.reviewedAt)); }
  function finishCurrentSession() { if (!currentSessionId) return; const session = (workspace.sessions || []).find(item => item.id === currentSessionId); if (session) { session.activeMs = (session.activeMs || 0) + Math.max(0, Date.now() - currentSessionStartedAt); session.endedAt = new Date().toISOString(); } currentSessionId = null; currentSessionStartedAt = 0; saveWorkspace(); }

  function loadWorkspace(id = sessionId()) {
    if (!id) return;
    try { workspace = JSON.parse(localStorage.getItem(workspaceKey(id))) || emptyWorkspace(); }
    catch { workspace = emptyWorkspace(); }
    workspace.folders ||= []; workspace.questions ||= []; workspace.reviews ||= []; workspace.settings ||= { includeChildren: true, newOrder: 'created' };
    workspace.questions.forEach(item => scheduleOf(item));
    saveWorkspace(); folderTree = workspace.folders;
    todayStudy = { date: learningDayKey(), count: uniqueCardsToday() };
    renderWorkspace();
  }
  function saveWorkspace() { const id = sessionId(); if (id) localStorage.setItem(workspaceKey(id), JSON.stringify(workspace)); }
  function folderById(id, items = workspace.folders) { for (const item of items) { if (item.id === id) return item; const child = folderById(id, item.children || []); if (child) return child; } return null; }
  function folderPath(id, items = workspace.folders, trail = []) { for (const item of items) { const next = [...trail, item.name]; if (item.id === id) return next; const child = folderPath(id, item.children || [], next); if (child) return child; } return []; }
  function allFolders(items = workspace.folders, depth = 0) { return items.flatMap(item => [{ ...item, depth }, ...allFolders(item.children || [], depth + 1)]); }
  function questionCountInFolder(id) { const ids = new Set([id]); const add = folder => (folder.children || []).forEach(child => { ids.add(child.id); add(child); }); const folder = folderById(id); if (folder) add(folder); return workspace.questions.filter(item => ids.has(item.folderId)).length; }
  function textFromHtml(html = '') { const node = document.createElement('div'); node.innerHTML = html; return node.textContent.trim(); }

  function renderFolderBranchFresh(items, depth = 0) {
    return items.map(item => {
      const count = questionCountInFolder(item.id);
      return `<div class="outline-node" style="--depth:${depth}" data-folder-node="${item.id}"><div class="outline-row" draggable="true" data-drag-folder="${item.id}"><span class="drag-handle" title="끌어서 순서 변경"><i data-lucide="grip-vertical"></i></span><button class="folder-name" data-folder-id="${item.id}" data-manage-kind="folder"><span class="folder-icon ${depth ? 'blue' : 'mint'}"><svg class="orae-icon"><use href="#orae-folder"></use></svg></span><span><strong>${escapeHtml(item.name)}</strong><small>${count}문제 · 눌러서 보기</small></span></button><button class="outline-study" data-study-folder="${item.id}" ${count ? '' : 'disabled'}><svg class="orae-icon"><use href="#orae-play"></use></svg><span>학습</span></button></div><div class="outline-children">${renderFolderBranchFresh(item.children || [], depth + 1)}</div></div>`;
    }).join('');
  }
  function renderSidebar() {
    const tree = q('.library-tree'); q('.nav-item[data-view="library"] .nav-count').textContent = workspace.questions.length;
    if (!tree) return;
    const rows = workspace.folders.slice(0, 5).map(item => `<button class="tree-item" data-workspace-folder="${item.id}"><span class="folder-icon mint"><svg class="orae-icon"><use href="#orae-folder"></use></svg></span><span>${escapeHtml(item.name)}</span><strong>${questionCountInFolder(item.id)}</strong></button>`).join('');
    tree.innerHTML = `<div class="tree-heading"><span>내 폴더</span><button class="icon-button small" id="workspaceNewFolder" aria-label="새 폴더"><svg class="orae-icon"><use href="#orae-folder-add"></use></svg></button></div>${rows || '<p class="sidebar-empty">아직 폴더가 없어요.</p>'}`;
    q('#workspaceNewFolder')?.addEventListener('click', () => { resetFolderModal(); openFolderModal('root'); });
    qa('[data-workspace-folder]').forEach(button => button.addEventListener('click', () => { selectedFolderId = button.dataset.workspaceFolder; q('#libraryTitle').textContent = '내 자료'; renderFolderQuestions(); showView('library'); window.lucide?.createIcons(); }));
  }
  function renderHome() {
    const count = workspace.questions.length, reviewCount = uniqueCardsToday(), dueCount = dueQuestions().length, newCount = workspace.questions.filter(isNew).length, folderList = q('.folders-section .folder-list');
    q('#homeView .page-heading > div > p:last-child').textContent = count ? `내가 만든 ${count}개 문제로 학습 흐름을 이어가세요.` : '아직 학습 기록이 없어요. 첫 자료부터 천천히 시작해 보세요.';
    q('#homeView .streak strong').textContent = reviewCount ? '1일' : '0일';
    q('#today-title').textContent = '오늘의 학습';
    q('.focus-copy > p').textContent = dueCount ? `기억이 흐려질 가능성이 높은 ${dueCount}개 카드부터 복습해요.` : newCount ? `오늘 새 카드 ${Math.min(NEW_CARD_RECOMMENDATION - newCardsStudiedToday(), newCount)}개를 추천해요.` : count ? '오늘 예정된 복습을 모두 마쳤어요.' : '폴더를 만들고 첫 문제를 추가하면 학습을 시작할 수 있어요.';
    q('#startStudy').innerHTML = count ? `<svg class="orae-icon"><use href="#orae-play"></use></svg>${dueCount ? `${dueCount}개 복습 시작` : '오늘 학습 시작'}` : '<svg class="orae-icon"><use href="#orae-folder-add"></use></svg>첫 폴더 만들기';
    q('#startNew').innerHTML = count ? '문제 더 만들기 <svg class="orae-icon"><use href="#orae-plus"></use></svg>' : '문제 만들기 <i data-lucide="arrow-right"></i>';
    const nums = qa('.focus-stats strong'); if (nums[0]) nums[0].textContent = dueCount; if (nums[1]) nums[1].textContent = Math.max(0, Math.min(NEW_CARD_RECOMMENDATION - newCardsStudiedToday(), newCount)); if (nums[2]) nums[2].textContent = dueCount ? `${Math.round(reviewCount / Math.max(reviewCount + dueCount, 1) * 100)}%` : '100%';
    q('#todayStudyCount').textContent = `${reviewCount}카드`; q('.quota-bar span').style.width = `${Math.min(reviewCount / Math.max(reviewCount + dueCount, 1) * 100, 100)}%`;
    folderList.innerHTML = workspace.folders.length ? workspace.folders.slice(0, 4).map(item => { const cards = questionsForFolder(item.id), due = dueQuestions(cards).length; return `<button class="folder-row" data-home-folder="${item.id}"><span class="subject-icon mint"><svg class="orae-icon"><use href="#orae-folder"></use></svg></span><span class="folder-main"><strong>${escapeHtml(item.name)}</strong><small>${cards.length}개 카드</small></span><span class="folder-progress"><span><i style="width:${cards.length ? Math.round((cards.length - due) / cards.length * 100) : 0}%"></i></span><small>${due ? `${due}개 예정` : '완료'}</small></span><span class="due-count"><strong>${due}</strong><small>복습</small></span><i data-lucide="chevron-right"></i></button>`; }).join('') : '<div class="workspace-empty"><span><svg class="orae-icon"><use href="#orae-folder-add"></use></svg></span><div><strong>아직 학습 자료가 없어요</strong><p>첫 폴더를 만든 뒤 직접 문제를 추가해 보세요.</p></div><button class="primary-button" id="emptyCreateFolder">첫 폴더 만들기</button></div>';
    q('#emptyCreateFolder')?.addEventListener('click', () => openFolderModal('root'));
    qa('[data-home-folder]').forEach(button => button.addEventListener('click', () => { selectedFolderId = button.dataset.homeFolder; renderFolderQuestions(); showView('library'); q('#libraryTitle').textContent = '내 자료'; window.lucide?.createIcons(); }));
    q('.week-total strong').textContent = workspace.reviews.length; q('.week-total small').textContent = workspace.reviews.length ? '내가 학습한 누적 기록이에요' : '첫 학습을 완료하면 기록이 쌓여요';
  }
  function renderLibrary() { const outline = q('#folderOutline'), root = outlineRootId === 'root' ? null : folderById(outlineRootId), items = root ? root.children || [] : workspace.folders; q('#libraryTitle').textContent = '내 자료'; q('#outlineBack').hidden = !root; q('#outlineTitle').textContent = root ? root.name : '전체 목록'; q('#outlineHelp').textContent = root ? `${root.name} 폴더의 하위 목차입니다.` : '폴더를 한 번 누르면 문제를 보고, 두 번 누르면 폴더 안으로 들어갑니다.'; outline.innerHTML = items.length ? renderFolderBranchFresh(items) : (root ? '<div class="library-empty compact"><span><svg class="orae-icon"><use href="#orae-folder"></use></svg></span><h2>하위 폴더가 없어요</h2><p>이 폴더에는 바로 문제가 저장되어 있습니다.</p></div>' : '<div class="library-empty"><span><svg class="orae-icon"><use href="#orae-folder-add"></use></svg></span><h2>첫 폴더를 만들어 보세요</h2><p>과목이나 주제별로 폴더를 만든 뒤 문제를 추가할 수 있어요.</p><button class="primary-button" id="libraryEmptyCreate">폴더 만들기</button></div>'); q('#libraryEmptyCreate')?.addEventListener('click', () => openFolderModal('root')); refreshFreshFolderOptions(); renderFolderQuestions(); q('#searchResults').innerHTML = '<span><svg class="orae-icon"><use href="#orae-search"></use></svg></span><h2>검색어를 입력해 보세요</h2><p>내 자료 ' + workspace.questions.length + '개에서 일치하는 내용을 찾아드려요.</p>'; }
  function renderFolderQuestions() {
    const panel = q('#folderQuestions'), folder = folderById(selectedFolderId);
    if (!folder) { panel.hidden = true; return; }
    panel.hidden = false; q('#folderQuestionsTitle').textContent = folder.name;
    const items = workspace.questions.filter(item => item.folderId === folder.id);
    q('#folderQuestionList').innerHTML = items.length ? items.map(item => { const state = scheduleOf(item), badges = `${isIncomplete(item) ? '<em class="incomplete-badge">미완성</em>' : ''}${state.problemCard ? '<em class="problem-badge">문제 카드</em>' : ''}${state.suspended ? '<em class="suspended-badge">학습 제외</em>' : ''}`; return `<article class="folder-question-card" data-question-card="${item.id}"><button class="question-open" data-question-id="${item.id}" data-manage-kind="question"><span class="question-type-dot ${item.type}" title="${typeNames[item.type]}"></span><span><strong>${escapeHtml(textFromHtml(item.prompt) || '미완성 카드')}</strong>${badges}${item.tags ? `<small>${escapeHtml(item.tags)}</small>` : ''}</span><svg class="orae-icon"><use href="#orae-play"></use></svg></button></article>`; }).join('') : '<div class="question-list-empty"><p>이 폴더에는 아직 문제가 없어요.</p><button class="secondary-button" id="emptyFolderAddQuestion"><svg class="orae-icon"><use href="#orae-plus"></use></svg>첫 문제 만들기</button></div>';
    q('#emptyFolderAddQuestion')?.addEventListener('click', () => openQuestionForFolder());
  }
  function renderProgressFresh() { const stats = qa('#progressView .stat-grid article strong'), today = reviewsToday(), unique = uniqueCardsToday(), sessionMinutes = Math.round((workspace.sessions || []).filter(item => item.learningDay === learningDayKey()).reduce((sum, item) => sum + (item.activeMs || 0), 0) / 60000), due = dueQuestions().length; if (stats[0]) stats[0].innerHTML = `${unique}<small>카드</small>`; if (stats[1]) stats[1].innerHTML = `${sessionMinutes}<small>분</small>`; if (stats[2]) stats[2].innerHTML = `${due}<small>카드</small>`; if (stats[3]) stats[3].innerHTML = `${today.length ? 1 : 0}<small>일</small>`; qa('#activityGrid span').forEach(cell => cell.dataset.level = '0'); const cells = qa('#activityGrid span'); if (cells.length && today.length) cells[cells.length - 1].dataset.level = String(Math.min(3, Math.ceil(unique / 3))); }
  function renderWorkspace() { renderSidebar(); renderHome(); renderLibrary(); renderProgressFresh(); window.lucide?.createIcons(); }

  function refreshFreshFolderOptions(preferred = selectedFolderId) {
    const list = allFolders(), select = q('#parentFolderInput');
    select.innerHTML = ['<option value="root">최상위</option>', ...list.map(item => `<option value="${item.id}">${'　'.repeat(item.depth)}${escapeHtml(item.name)}</option>`)].join(''); select.value = folderById(preferred) ? preferred : 'root';
    const questionSelect = q('#questionFolder'); questionSelect.innerHTML = list.length ? list.map(item => `<option value="${item.id}">${'　'.repeat(item.depth)}${escapeHtml(folderPath(item.id).join(' / '))}</option>`).join('') : '<option value="">먼저 폴더를 만들어 주세요</option>'; questionSelect.disabled = !list.length;
  }
  function openQuestionForFolder() { refreshFreshFolderOptions(selectedFolderId); q('#questionFolder').value = folderById(selectedFolderId) ? selectedFolderId : allFolders()[0]?.id || ''; editingQuestionId = null; q('#saveQuestion').textContent = '저장하고 계속'; openModal('qa'); }
  function openFolderEdit(id) { const folder = folderById(id); if (!folder) return; editingFolderId = id; openFolderModal('root'); q('#folderModalTitle').textContent = '폴더 이름 수정'; q('#folderNameInput').value = folder.name; q('#parentFolderInput').closest('.field').hidden = true; q('#saveFolder').textContent = '수정 내용 저장'; setTimeout(() => q('#folderNameInput').select(), 60); }
  function resetFolderModal() { editingFolderId = null; q('#folderModalTitle').textContent = '새 폴더 만들기'; q('#parentFolderInput').closest('.field').hidden = false; q('#saveFolder').textContent = '폴더 만들기'; }
  function editQuestion(id) {
    const item = workspace.questions.find(question => question.id === id); if (!item) return;
    editingQuestionId = id; setEditorType(item.type); refreshFreshFolderOptions(item.folderId); q('#questionFolder').value = item.folderId;
    q('#questionInput').innerHTML = item.type === 'qa' ? item.prompt : ''; q('#answerInput').innerHTML = item.type === 'qa' ? item.answer : '';
    if (item.type === 'cloze') q('#clozeInput').innerHTML = item.prompt;
    q('#hintInput').value = item.hint || ''; q('#explanationInput').value = item.explanation || ''; q('#sourceInput').value = item.source || ''; q('#questionTags').value = item.tags || '';
    q('#modalTitle').textContent = `${typeNames[item.type]} 수정`; q('#saveQuestion').textContent = '수정 내용 저장';
    modal.hidden = false; document.body.style.overflow = 'hidden';
  }
  function saveFreshFolder(event) { event.preventDefault(); event.stopImmediatePropagation(); const name = q('#folderNameInput').value.trim(); if (!name) { q('#folderError').textContent = '폴더 이름을 입력해 주세요.'; return; } if (editingFolderId) { const folder = folderById(editingFolderId); if (folder) folder.name = name; saveWorkspace(); renderWorkspace(); closeFolderModal(); resetFolderModal(); toast(`폴더 이름을 '${name}'(으)로 바꿨습니다.`); return; } const item = { id: `folder-${Date.now()}`, name, children: [], count: 0, due: 0 }, parentId = q('#parentFolderInput').value; if (parentId === 'root') workspace.folders.push(item); else folderById(parentId).children.push(item); selectedFolderId = item.id; saveWorkspace(); renderWorkspace(); closeFolderModal(); toast(`'${name}' 폴더를 만들었습니다.`); }
  function saveFreshQuestion() {
    if (!sessionId() || !allFolders().length) { toast('먼저 문제를 담을 폴더를 만들어 주세요.'); return false; }
    let prompt = '', answer = '';
    if (currentType === 'qa') { prompt = q('#questionInput').innerHTML; answer = q('#answerInput').innerHTML; }
    const existing = workspace.questions.find(item => item.id === editingQuestionId);
    if (currentType === 'cloze') { const source = q('#clozeInput').cloneNode(true), answers = qa('.cloze-token', source).map(mark => mark.textContent); if (existing && source.innerHTML === existing.prompt) { prompt = existing.prompt; answer = existing.answer; } else { qa('.cloze-token', source).forEach(mark => { mark.textContent = '＿'; }); prompt = source.innerHTML; answer = answers.join(', '); } }
    if (currentType === 'image') { prompt = existing?.prompt || '이미지 가리기 문제'; answer = existing?.answer || '가려진 영역을 확인하세요.'; }
    const values = { type: currentType, folderId: q('#questionFolder').value, prompt, answer, hint: q('#hintInput').value.trim(), explanation: q('#explanationInput').value.trim(), source: q('#sourceInput').value.trim(), tags: q('#questionTags').value.trim() };
    if (existing) { const keepHistory = window.confirm('기존 학습 기록을 유지할까요?\n확인: 기록 유지 · 취소: 처음부터 학습'); Object.assign(existing, values, { updatedAt: new Date().toISOString() }); if (!keepHistory) { existing.historyResetAt = new Date().toISOString(); existing.schedule = defaultSchedule(existing.updatedAt); } } else workspace.questions.push({ id: `question-${Date.now()}`, ...values, createdAt: new Date().toISOString(), schedule: defaultSchedule() }); saveWorkspace(); return true;
  }
  function removeFolderFromTree(id, items = workspace.folders) { const index = items.findIndex(item => item.id === id); if (index >= 0) return items.splice(index, 1)[0]; for (const item of items) { const found = removeFolderFromTree(id, item.children || []); if (found) return found; } return null; }
  function descendantFolderIds(id) { const ids = new Set(); const scan = folder => { ids.add(folder.id); (folder.children || []).forEach(scan); }; const folder = folderById(id); if (folder) scan(folder); return ids; }
  function deleteFolder(id) { const folder = folderById(id); if (!folder) return; const ids = descendantFolderIds(id), removedQuestions = workspace.questions.filter(item => ids.has(item.folderId)).map(item => item.id); removeFolderFromTree(id); workspace.questions = workspace.questions.filter(item => !ids.has(item.folderId)); workspace.reviews = workspace.reviews.filter(item => !removedQuestions.includes(item.questionId)); if (ids.has(selectedFolderId)) selectedFolderId = 'root'; if (ids.has(outlineRootId)) outlineRootId = 'root'; saveWorkspace(); renderWorkspace(); toast(`'${folder.name}' 폴더와 안의 문제를 삭제했습니다.`); }
  function setManagementMode(mode = null) { managementMode = managementMode === mode ? null : mode; pendingDeleteId = null; pendingFolderDeleteId = null; const hint = q('#managementHint'); hint.hidden = !managementMode; q('#libraryView').dataset.management = managementMode || ''; q('#libraryEditMode').classList.toggle('active', managementMode === 'edit'); q('#libraryDeleteMode').classList.toggle('active', managementMode === 'delete'); if (managementMode) hint.querySelector('span').textContent = managementMode === 'edit' ? '수정할 폴더나 질문을 선택하세요.' : '삭제할 폴더나 질문을 선택하세요.'; }
  function manageTarget(kind, id) { if (managementMode === 'edit') { setManagementMode(null); kind === 'folder' ? openFolderEdit(id) : editQuestion(id); return; } if (managementMode !== 'delete') return; if (kind === 'folder') { if (pendingFolderDeleteId !== id) { pendingFolderDeleteId = id; toast('폴더와 안의 문제가 함께 삭제됩니다. 같은 폴더를 한 번 더 눌러 주세요.'); return; } deleteFolder(id); } else { if (pendingDeleteId !== id) { pendingDeleteId = id; toast('삭제할 질문이 맞다면 같은 질문을 한 번 더 눌러 주세요.'); return; } workspace.questions = workspace.questions.filter(item => item.id !== id); workspace.reviews = workspace.reviews.filter(item => item.questionId !== id); saveWorkspace(); renderWorkspace(); toast('문제를 삭제했습니다.'); } setManagementMode(null); }
  function listContainingFolder(id, items = workspace.folders) { if (items.some(item => item.id === id)) return items; for (const item of items) { const found = listContainingFolder(id, item.children || []); if (found) return found; } return null; }
  function folderContains(rootId, candidateId) { const root = folderById(rootId); const scan = folder => folder.id === candidateId || (folder.children || []).some(scan); return root ? scan(root) : false; }
  function moveFolderBefore(sourceId, targetId) { if (!sourceId || sourceId === targetId || folderContains(sourceId, targetId)) return; const targetList = listContainingFolder(targetId); if (!targetList) return; const source = removeFolderFromTree(sourceId); if (!source) return; const targetIndex = targetList.findIndex(item => item.id === targetId); targetList.splice(Math.max(0, targetIndex), 0, source); saveWorkspace(); renderWorkspace(); toast(`'${source.name}' 위치를 옮겼습니다.`); }
  function questionsForFolder(id, includeChildren = true) { if (!id || id === 'root') return [...workspace.questions]; if (!includeChildren) return workspace.questions.filter(question => question.folderId === id); const ids = new Set([id]), add = folder => (folder.children || []).forEach(child => { ids.add(child.id); add(child); }); const folder = folderById(id); if (folder) add(folder); return workspace.questions.filter(question => ids.has(question.folderId)); }
  function startFreshStudy(folderId = null, questionId = null) {
    let candidates;
    if (questionId) candidates = workspace.questions.filter(item => item.id === questionId && !isIncomplete(item) && !scheduleOf(item).suspended);
    else {
      let includeChildren = workspace.settings.includeChildren;
      if (folderId && folderId !== 'root' && folderById(folderId)?.children?.length) { includeChildren = window.confirm('하위 폴더의 카드도 함께 학습할까요?\n확인: 하위 폴더 포함 · 취소: 이 폴더만'); workspace.settings.includeChildren = includeChildren; }
      candidates = questionsForFolder(folderId, includeChildren).filter(item => !isIncomplete(item) && !scheduleOf(item).suspended);
    }
    const due = dueQuestions(candidates), remainingNew = Math.max(0, NEW_CARD_RECOMMENDATION - newCardsStudiedToday()), fresh = candidates.filter(isNew).slice(0, remainingNew);
    studyQueue = questionId ? candidates : [...due, ...fresh];
    if (!studyQueue.length) { toast(candidates.length ? '이 범위의 오늘 복습을 모두 마쳤어요.' : '학습 가능한 카드가 없어요. 미완성 또는 제외 상태를 확인해 주세요.'); return; }
    freshStudyIndex = 0; sessionReviewed = new Set(); lastReviewAction = null; workspace.sessions ||= []; currentSessionId = `session-${Date.now()}`; currentSessionStartedAt = Date.now(); workspace.sessions.push({ id: currentSessionId, learningDay: learningDayKey(), startedAt: new Date().toISOString(), activeMs: 0 }); saveWorkspace(); q('#studyOverlay').hidden = false; q('#studyFeedback').hidden = true; document.body.style.overflow = 'hidden'; renderFreshCard();
  }
  function renderFreshCard() { const item = studyQueue[freshStudyIndex], prompt = document.createElement('div'); if (!item) return; currentHintUsed = false; prompt.innerHTML = item.prompt; if (item.type === 'cloze') qa('.cloze-token', prompt).forEach(mark => { mark.textContent = '＿'; }); q('#studyQuestion').innerHTML = prompt.innerHTML; q('#studyAnswer').innerHTML = item.answer; q('#hintBox p').textContent = item.hint || '등록된 힌트가 없어요.'; q('.explanation p').textContent = item.explanation || item.source || '등록된 해설이 없어요.'; q('.study-meta > span:first-child').textContent = folderPath(item.folderId).join(' · ') || '내 카드'; q('.study-meta .type-chip').textContent = scheduleOf(item).problemCard ? '문제 카드' : typeNames[item.type]; q('.study-progress small').innerHTML = `<strong id="studyCurrent">${freshStudyIndex + 1}</strong> / ${studyQueue.length}`; q('#studyProgressBar').style.width = `${(freshStudyIndex + 1) / studyQueue.length * 100}%`; q('#hintBox').hidden = true; q('#answerBox').hidden = true; q('#ratings').hidden = true; q('#beforeAnswer').hidden = false; q('[data-rating="easy"]').disabled = false; }
  function rateFreshQuestion(event, button) {
    event.preventDefault(); event.stopImmediatePropagation(); const item = studyQueue[freshStudyIndex], rating = button.dataset.rating, reviewedAt = new Date().toISOString(), previousSchedule = structuredClone(scheduleOf(item)), wasNew = updateSchedule(item, rating, reviewedAt), review = { id: `review-${Date.now()}-${Math.random().toString(16).slice(2)}`, questionId: item.id, rating, hintUsed: currentHintUsed, reviewedAt, learningDay: learningDayKey(), wasNew };
    workspace.reviews.push(review); sessionReviewed.add(item.id); lastReviewAction = { reviewId: review.id, questionId: item.id, previousSchedule, queueIndex: freshStudyIndex, item };
    if (rating === 'again') { const nextIndex = Math.min(studyQueue.length, freshStudyIndex + 4); studyQueue.splice(nextIndex, 0, item); }
    saveWorkspace(); q('#studyFeedbackText').textContent = rating === 'again' ? '기억 못함으로 기록했어요. 잠시 뒤 다시 나옵니다.' : '기억 상태를 기록했어요.'; q('#studyFeedback').hidden = false; freshStudyIndex += 1;
    if (freshStudyIndex >= studyQueue.length) { setTimeout(() => { finishCurrentSession(); exitStudy(); renderWorkspace(); toast(`${sessionReviewed.size}개 카드 학습을 마쳤어요!`); }, 350); } else renderFreshCard();
  }
  function undoLastReview() { if (!lastReviewAction) return; const action = lastReviewAction, review = workspace.reviews.find(item => item.id === action.reviewId), item = workspace.questions.find(question => question.id === action.questionId); if (!review || !item) return; review.undone = true; item.schedule = action.previousSchedule; const duplicated = studyQueue.findIndex((candidate, index) => index > action.queueIndex && candidate.id === item.id); if (duplicated >= 0) studyQueue.splice(duplicated, 1); freshStudyIndex = Math.max(0, action.queueIndex); lastReviewAction = null; saveWorkspace(); q('#studyFeedback').hidden = true; renderFreshCard(); toast('직전 평가를 취소했습니다.'); }
  function renderOwnSearch(value) { const results = workspace.questions.filter(item => [item.prompt, item.answer, item.tags, item.explanation, item.source].join(' ').includes(value)); q('#searchResults').innerHTML = results.length ? results.map(item => `<button class="search-result" data-search-question="${item.id}"><strong>${escapeHtml(textFromHtml(item.prompt))}</strong><small>${escapeHtml(folderPath(item.folderId).join(' / '))} · ${typeNames[item.type]}</small></button>`).join('') : '<span><svg class="orae-icon"><use href="#orae-card"></use></svg></span><h2>일치하는 문제가 없어요</h2><p>내가 만든 문제에서만 검색합니다.</p>'; window.lucide?.createIcons(); }

  window.loadUserWorkspace = loadWorkspace;
  q('#saveFolder').addEventListener('click', saveFreshFolder, true);
  q('#saveQuestion').addEventListener('click', event => { if (!allFolders().length) { event.preventDefault(); event.stopImmediatePropagation(); toast('먼저 폴더를 만들어 주세요.'); return; } const wasEditing = Boolean(editingQuestionId); if (saveFreshQuestion()) setTimeout(() => { renderWorkspace(); if (wasEditing) { editingQuestionId = null; q('#saveQuestion').textContent = '저장하고 계속'; closeModal(); toast('문제를 수정했습니다.'); } }, 0); }, true);
  q('#startStudy').addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); workspace.questions.length ? startFreshStudy() : openFolderModal('root'); }, true);
  q('#startNew').addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); allFolders().length ? openModal('qa') : openFolderModal('root'); }, true);
  q('#libraryStudy').addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); startFreshStudy(selectedFolderId); }, true);
  q('#folderOutline').addEventListener('click', event => { const study = event.target.closest('[data-study-folder]'), folder = event.target.closest('[data-folder-id]'); if (folder && managementMode) { event.preventDefault(); event.stopImmediatePropagation(); manageTarget('folder', folder.dataset.folderId); } else if (study) { event.preventDefault(); event.stopImmediatePropagation(); startFreshStudy(study.dataset.studyFolder); } else if (folder) { event.preventDefault(); event.stopImmediatePropagation(); selectedFolderId = folder.dataset.folderId; q('#libraryTitle').textContent = '내 자료'; renderFolderQuestions(); window.lucide?.createIcons(); } }, true);
  q('#folderOutline').addEventListener('dblclick', event => { const folder = event.target.closest('[data-folder-id]'); if (!folder || managementMode) return; const item = folderById(folder.dataset.folderId); if (!item?.children?.length) { toast('이 폴더에는 하위 폴더가 없어요.'); return; } outlineRootId = item.id; selectedFolderId = item.id; renderLibrary(); window.lucide?.createIcons(); });
  q('#outlineBack').addEventListener('click', () => { outlineRootId = 'root'; renderLibrary(); window.lucide?.createIcons(); });
  q('#folderOutline').addEventListener('dragstart', event => { const row = event.target.closest('[data-drag-folder]'); if (!row) return; draggedFolderId = row.dataset.dragFolder; row.classList.add('dragging'); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', draggedFolderId); });
  q('#folderOutline').addEventListener('dragend', event => { event.target.closest('[data-drag-folder]')?.classList.remove('dragging'); qa('.drop-target').forEach(row => row.classList.remove('drop-target')); draggedFolderId = null; });
  q('#folderOutline').addEventListener('dragover', event => { const row = event.target.closest('[data-drag-folder]'); if (!row || !draggedFolderId || row.dataset.dragFolder === draggedFolderId) return; event.preventDefault(); qa('.drop-target').forEach(item => item.classList.remove('drop-target')); row.classList.add('drop-target'); event.dataTransfer.dropEffect = 'move'; });
  q('#folderOutline').addEventListener('drop', event => { const row = event.target.closest('[data-drag-folder]'); if (!row) return; event.preventDefault(); moveFolderBefore(draggedFolderId || event.dataTransfer.getData('text/plain'), row.dataset.dragFolder); });
  q('#folderAddQuestion').addEventListener('click', openQuestionForFolder);
  q('#libraryEditMode').addEventListener('click', () => setManagementMode('edit'));
  q('#libraryDeleteMode').addEventListener('click', () => setManagementMode('delete'));
  q('#cancelManagement').addEventListener('click', () => setManagementMode(null));
  ['#newFolderButton', '#libraryNewFolder'].forEach(selector => q(selector)?.addEventListener('click', resetFolderModal, true));
  qa('[data-close-folder]').forEach(button => button.addEventListener('click', resetFolderModal));
  ['#createQuestion', '#quickQuestion', '#quickCloze', '#quickImage', '#mobileCreate'].forEach(selector => q(selector)?.addEventListener('click', () => { editingQuestionId = null; q('#saveQuestion').textContent = '저장하고 계속'; refreshFreshFolderOptions(selectedFolderId); }, true));
  q('#folderQuestions').addEventListener('click', event => { const play = event.target.closest('[data-question-id]'); if (!play) return; if (managementMode) manageTarget('question', play.dataset.questionId); else startFreshStudy(null, play.dataset.questionId); });
  qa('[data-close-modal]').forEach(button => button.addEventListener('click', () => { editingQuestionId = null; q('#saveQuestion').textContent = '저장하고 계속'; }));
  qa('[data-rating]').forEach(button => button.addEventListener('click', event => rateFreshQuestion(event, button), true));
  q('#showHint').addEventListener('click', () => { currentHintUsed = true; q('[data-rating="easy"]').disabled = true; }, true);
  q('#undoReview').addEventListener('click', undoLastReview);
  q('#exitStudy').addEventListener('click', finishCurrentSession, true);
  q('#searchPageInput').addEventListener('input', event => { event.stopImmediatePropagation(); renderOwnSearch(event.target.value.trim()); }, true);
  q('#globalSearch').addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.value.trim()) { event.preventDefault(); event.stopImmediatePropagation(); showView('search'); q('#searchPageInput').value = event.target.value; renderOwnSearch(event.target.value.trim()); } }, true);
  q('#authForm').addEventListener('submit', () => setTimeout(() => loadWorkspace(), 50));
  q('#profileButton').title = '로그아웃';
  loadWorkspace();
})();

