const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
if (window.lucide) window.lucide.createIcons();

const views = { home: $('#homeView'), library: $('#libraryView'), search: $('#searchView'), progress: $('#progressView'), community: $('#communityView') };
const typeNames = { qa: '질문·정답', cloze: '빈칸 암기', image: '이미지 가리기' };
let currentType = 'qa';
let currentShape = 'rect';
let maskTotal = 0;
let maskGroupIndex = 0;

function showView(name) {
  Object.values(views).forEach(view => view.classList.remove('active'));
  (views[name] || views.home).classList.add('active');
  $$('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === name));
  $('#sidebar').classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$$('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
$('#openSidebar').addEventListener('click', () => $('#sidebar').classList.add('open'));
$('#closeSidebar').addEventListener('click', () => $('#sidebar').classList.remove('open'));
$$('[data-folder]').forEach(button => button.addEventListener('click', () => { $('#libraryTitle').textContent = button.dataset.folder; showView('library'); }));

let authMode = 'login';
async function hashPassword(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function setAuthMode(mode) {
  authMode = mode;
  $$('[data-auth-tab]').forEach(tab => tab.classList.toggle('active', tab.dataset.authTab === mode));
  $$('.signup-only').forEach(field => { field.hidden = mode !== 'signup'; });
  $('#authName').disabled = mode !== 'signup';
  $('#authPassword').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  $('#authSubmit').textContent = mode === 'signup' ? '가입하고 시작하기' : '로그인';
  $('#authError').textContent = '';
}
function applyDisplayName(displayName) {
  $('#profileName').textContent = displayName;
  $('#profileInitial').textContent = displayName.slice(0, 1).toUpperCase();
  $('#greetingName').textContent = displayName;
}
function showNameSetup(id) {
  $('#nameSetupModal').dataset.accountId = id;
  $('#nameSetupInput').value = '';
  $('#nameSetupError').textContent = '';
  $('#nameSetupModal').hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#nameSetupInput').focus(), 50);
}
function enterApp(id) {
  const account = JSON.parse(localStorage.getItem('orae-accounts') || '{}')[id] || {};
  sessionStorage.setItem('orae-session', id);
  applyDisplayName(account.name || '학습자');
  $('#authGate').classList.add('hidden');
  document.body.style.overflow = '';
  if (!account.name) showNameSetup(id);
}
function showAuth() {
  $('#authGate').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setAuthMode('login');
  setTimeout(() => $('#authId').focus(), 50);
}
$$('[data-auth-tab]').forEach(tab => tab.addEventListener('click', () => setAuthMode(tab.dataset.authTab)));
$('#togglePassword').addEventListener('click', () => {
  const field = $('#authPassword');
  field.type = field.type === 'password' ? 'text' : 'password';
  $('#togglePassword').innerHTML = `<i data-lucide="${field.type === 'password' ? 'eye' : 'eye-off'}"></i>`;
  window.lucide?.createIcons();
});
$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const id = $('#authId').value.trim();
  const password = $('#authPassword').value;
  const error = $('#authError');
  if (!/^[a-zA-Z0-9가-힣_-]{4,20}$/.test(id)) { error.textContent = '아이디는 공백 없이 4~20자로 입력해 주세요.'; return; }
  if (password.length < 8) { error.textContent = '비밀번호는 8자 이상 입력해 주세요.'; return; }
  const accounts = JSON.parse(localStorage.getItem('orae-accounts') || '{}');
  if (authMode === 'signup') {
    const name = $('#authName').value.trim();
    if (!name) { error.textContent = '이름을 입력해 주세요.'; return; }
    if (accounts[id]) { error.textContent = '이미 사용 중인 아이디입니다.'; return; }
    accounts[id] = { name, passwordHash: await hashPassword(password), createdAt: new Date().toISOString() };
    localStorage.setItem('orae-accounts', JSON.stringify(accounts));
    enterApp(id); toast(`${name}님, Orae에 가입했어요.`);
  } else {
    if (!accounts[id] || accounts[id].passwordHash !== await hashPassword(password)) { error.textContent = '아이디 또는 비밀번호가 올바르지 않습니다.'; return; }
    enterApp(id); toast(`${accounts[id].name || id}님, 다시 만나서 반가워요.`);
  }
});
$('#profileButton').addEventListener('click', () => { sessionStorage.removeItem('orae-session'); showAuth(); });
const savedSession = sessionStorage.getItem('orae-session');
if (savedSession) enterApp(savedSession); else showAuth();
$('#saveDisplayName').addEventListener('click', () => {
  const name = $('#nameSetupInput').value.trim();
  if (!name) { $('#nameSetupError').textContent = '표시할 이름을 입력해 주세요.'; $('#nameSetupInput').focus(); return; }
  const id = $('#nameSetupModal').dataset.accountId;
  const accounts = JSON.parse(localStorage.getItem('orae-accounts') || '{}');
  accounts[id] = { ...(accounts[id] || {}), name };
  localStorage.setItem('orae-accounts', JSON.stringify(accounts));
  applyDisplayName(name);
  $('#nameSetupModal').hidden = true;
  document.body.style.overflow = '';
  toast(`${name}님, 반가워요.`);
});
$('#nameSetupInput').addEventListener('keydown', event => { if (event.key === 'Enter') $('#saveDisplayName').click(); });

const modal = $('#questionModal');
function setEditorType(type) {
  currentType = type;
  $$('.type-selector button').forEach(button => button.classList.toggle('active', button.dataset.type === type));
  $$('.editor-panel').forEach(panel => panel.classList.toggle('active', panel.dataset.editor === type));
  $('#modalTitle').textContent = `${typeNames[type]} 만들기`;
}
function openModal(type = 'qa') {
  modal.hidden = false; document.body.style.overflow = 'hidden'; setEditorType(type); restoreDraft();
  setTimeout(() => type === 'qa' ? $('#questionInput').focus() : type === 'cloze' ? $('#clozeInput').focus() : null, 50);
}
function closeModal() { modal.hidden = true; document.body.style.overflow = ''; }
$('#createQuestion').addEventListener('click', () => openModal());
$('#mobileCreate').addEventListener('click', () => openModal());
$('#quickQuestion').addEventListener('click', () => openModal('qa'));
$('#quickCloze').addEventListener('click', () => openModal('cloze'));
$('#quickImage').addEventListener('click', () => openModal('image'));
$$('[data-close-modal]').forEach(button => button.addEventListener('click', closeModal));
modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
$$('.type-selector button').forEach(button => button.addEventListener('click', () => setEditorType(button.dataset.type)));

function toast(message) {
  const el = $('#toast'); $('span', el).textContent = message; el.classList.add('show');
  clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

const editorSelections = new WeakMap();
function rememberEditorSelection(editor) {
  const selection = window.getSelection();
  if (selection.rangeCount && !selection.isCollapsed && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) editorSelections.set(editor, selection.getRangeAt(0).cloneRange());
}
function applySelectedColor(control, value) {
  const richEditor = control.closest('[data-rich-editor]');
  const editor = $('.editable', richEditor);
  const range = editorSelections.get(editor);
  if (!range || range.collapsed || !editor.contains(range.commonAncestorContainer)) { toast('색을 바꿀 글자를 먼저 드래그해 주세요.'); return; }
  const mark = document.createElement('span');
  mark.style[control.dataset.command === 'foreColor' ? 'color' : 'backgroundColor'] = value;
  try { range.surroundContents(mark); } catch { mark.appendChild(range.extractContents()); range.insertNode(mark); }
  const plainText = document.createTextNode('\u200B'); mark.after(plainText);
  const selection = window.getSelection(); selection.removeAllRanges(); const caret = document.createRange(); caret.setStartAfter(plainText); caret.collapse(true); selection.addRange(caret);
  editorSelections.delete(editor); editor.focus(); saveDraft();
}
$$('.format-toolbar button[data-command]').forEach(button => button.addEventListener('mousedown', event => {
  event.preventDefault();
  if (button.dataset.command === 'hiliteColor') applySelectedColor(button, button.dataset.value);
  else document.execCommand(button.dataset.command, false, button.dataset.value || null);
}));
$$('.format-toolbar input[type="color"]').forEach(input => input.addEventListener('change', () => applySelectedColor(input, input.value)));
$$('.editable').forEach(editor => {
  editor.addEventListener('pointerdown', () => editor.focus());
  editor.addEventListener('click', () => editor.focus());
  editor.addEventListener('mouseup', () => rememberEditorSelection(editor));
  editor.addEventListener('keyup', () => rememberEditorSelection(editor));
});

function updateClozeCount() {
  const count = $$('.cloze-token', $('#clozeInput')).length;
  const grouped = $('input[name="clozeMode"]:checked').value === 'group';
  $('#clozeCount').textContent = `${count ? (grouped ? 1 : count) : 0}개 생성 예정`;
}
$('#makeCloze').addEventListener('mousedown', event => {
  event.preventDefault();
  const selection = window.getSelection();
  if (!selection.rangeCount || selection.isCollapsed || !$('#clozeInput').contains(selection.anchorNode)) { toast('빈칸으로 만들 텍스트를 먼저 선택해 주세요.'); return; }
  const range = selection.getRangeAt(0); const mark = document.createElement('mark'); mark.className = 'cloze-token'; mark.title = '눌러서 빈칸 해제';
  try { range.surroundContents(mark); } catch { mark.appendChild(range.extractContents()); range.insertNode(mark); }
  selection.removeAllRanges(); updateClozeCount(); saveDraft();
});
$('#clozeInput').addEventListener('click', event => { if (event.target.classList.contains('cloze-token')) { event.target.replaceWith(...event.target.childNodes); updateClozeCount(); saveDraft(); } });
$$('input[name="clozeMode"]').forEach(input => input.addEventListener('change', updateClozeCount));

$('#chooseImage').addEventListener('click', () => $('#imageUpload').click());
$('#imageUpload').addEventListener('change', event => {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('10MB 이하 이미지를 선택해 주세요.'); return; }
  const reader = new FileReader();
  reader.onload = () => { $('#imagePreview').src = reader.result; $('#imageEmpty').hidden = true; $('#imageWorkspace').hidden = false; clearMasks(); };
  reader.readAsDataURL(file);
});
$$('[data-shape]').forEach(button => button.addEventListener('click', () => {
  currentShape = button.dataset.shape;
  $$('[data-shape]').forEach(item => item.classList.toggle('active', item === button));
}));
$('#imageZoom').addEventListener('input', event => { $('#imageStage').style.width = `${event.target.value}%`; });
function getMasks() { return $$('.image-mask', $('#maskLayer')); }
function getSelectedMasks() { return $$('.image-mask.selected', $('#maskLayer')); }
function questionCount() {
  if (!maskTotal) return 0;
  const mode = $('input[name="imageMode"]:checked').value;
  if (mode === 'all') return 1;
  if (mode === 'separate') return maskTotal;
  const groups = new Set(getMasks().map(mask => mask.dataset.group).filter(Boolean));
  const ungrouped = getMasks().filter(mask => !mask.dataset.group).length;
  return groups.size + ungrouped;
}
function updateMaskCount() {
  $('#maskCount').textContent = `${questionCount()}개 질문 생성 예정 · 가림 ${maskTotal}개`;
  const selected = getSelectedMasks().length;
  $('#deleteMask').disabled = selected === 0;
  $('#groupMasks').disabled = selected < 2 || $('input[name="imageMode"]:checked').value !== 'custom';
}
function clearMasks() { $('#maskLayer').innerHTML = ''; maskTotal = 0; maskGroupIndex = 0; updateMaskCount(); }
$$('input[name="imageMode"]').forEach(input => input.addEventListener('change', () => {
  getMasks().forEach(mask => mask.classList.remove('selected'));
  updateMaskCount();
}));
$('#maskColor').addEventListener('input', event => {
  const selected = getSelectedMasks();
  selected.forEach(mask => { mask.style.backgroundColor = event.target.value; mask.dataset.color = event.target.value; });
});
$('#deleteMask').addEventListener('click', () => {
  getSelectedMasks().forEach(mask => mask.remove());
  maskTotal = getMasks().length; updateMaskCount();
});
$('#groupMasks').addEventListener('click', () => {
  const selected = getSelectedMasks(); if (selected.length < 2) return;
  maskGroupIndex += 1;
  selected.forEach(mask => { mask.dataset.group = String(maskGroupIndex); mask.dataset.groupLabel = `묶음 ${maskGroupIndex}`; mask.classList.remove('selected'); });
  updateMaskCount(); toast(`${selected.length}개 영역을 묶음 ${maskGroupIndex}로 만들었습니다.`);
});
function pointerPercent(event, stage) {
  const rect = stage.getBoundingClientRect();
  return { x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)), y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)) };
}
$('#imageStage').addEventListener('pointerdown', event => {
  if (!$('#imagePreview').src || event.target.classList.contains('image-mask')) return;
  event.preventDefault(); const stage = $('#imageStage'); const start = pointerPercent(event, stage);
  const mask = document.createElement('button'); mask.type = 'button'; mask.className = `image-mask ${currentShape}`; mask.title = '선택하거나 드래그해 이동'; mask.dataset.color = $('#maskColor').value; mask.style.backgroundColor = $('#maskColor').value;
  Object.assign(mask.style, { left: `${start.x}%`, top: `${start.y}%`, width: '0', height: '0' });
  $('#maskLayer').appendChild(mask); stage.setPointerCapture(event.pointerId);
  const move = moveEvent => { const point = pointerPercent(moveEvent, stage); Object.assign(mask.style, { left: `${Math.min(start.x, point.x)}%`, top: `${Math.min(start.y, point.y)}%`, width: `${Math.abs(point.x - start.x)}%`, height: `${Math.abs(point.y - start.y)}%` }); };
  const up = upEvent => { stage.releasePointerCapture(upEvent.pointerId); stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); if (parseFloat(mask.style.width) < 2 || parseFloat(mask.style.height) < 2) mask.remove(); else { maskTotal += 1; mask.dataset.number = String(maskTotal); updateMaskCount(); saveDraft(); } };
  stage.addEventListener('pointermove', move); stage.addEventListener('pointerup', up);
});
$('#maskLayer').addEventListener('pointerdown', event => {
  const mask = event.target.closest('.image-mask'); if (!mask) return;
  event.preventDefault(); event.stopPropagation();
  const stage = $('#imageStage'); const start = pointerPercent(event, stage); const originalLeft = parseFloat(mask.style.left); const originalTop = parseFloat(mask.style.top); let moved = false;
  mask.setPointerCapture(event.pointerId);
  const move = moveEvent => { const point = pointerPercent(moveEvent, stage); const dx = point.x - start.x; const dy = point.y - start.y; if (Math.abs(dx) + Math.abs(dy) > .5) moved = true; const maxLeft = 100 - parseFloat(mask.style.width); const maxTop = 100 - parseFloat(mask.style.height); mask.style.left = `${Math.max(0, Math.min(maxLeft, originalLeft + dx))}%`; mask.style.top = `${Math.max(0, Math.min(maxTop, originalTop + dy))}%`; };
  const up = upEvent => { mask.releasePointerCapture(upEvent.pointerId); mask.removeEventListener('pointermove', move); mask.removeEventListener('pointerup', up); if (!moved) { const custom = $('input[name="imageMode"]:checked').value === 'custom'; if (!custom) getMasks().forEach(item => item.classList.remove('selected')); mask.classList.toggle('selected'); } updateMaskCount(); };
  mask.addEventListener('pointermove', move); mask.addEventListener('pointerup', up);
});

function saveDraft() {
  const draft = { qaQuestion: $('#questionInput').innerHTML, qaAnswer: $('#answerInput').innerHTML, cloze: $('#clozeInput').innerHTML, type: currentType, folder: $('#questionFolder').value, tags: $('#questionTags').value };
  localStorage.setItem('orae-draft', JSON.stringify(draft));
  $('#draftStatus').textContent = `방금 ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 저장됨`;
}
function restoreDraft() {
  const draft = JSON.parse(localStorage.getItem('orae-draft') || 'null'); if (!draft) return;
  $('#questionInput').innerHTML = draft.qaQuestion || ''; $('#answerInput').innerHTML = draft.qaAnswer || ''; $('#clozeInput').innerHTML = draft.cloze || ''; $('#questionTags').value = draft.tags || ''; updateClozeCount();
}
$$('.editable, #questionTags').forEach(field => field.addEventListener('input', () => { clearTimeout(window.draftTimer); window.draftTimer = setTimeout(saveDraft, 500); }));
function editorIsEmpty(element) { return !element.textContent.trim() && !element.querySelector('img'); }
function validateQuestion() {
  if (currentType === 'qa' && (editorIsEmpty($('#questionInput')) || editorIsEmpty($('#answerInput')))) return '질문과 정답을 모두 입력해 주세요.';
  if (currentType === 'cloze' && !$('.cloze-token', $('#clozeInput'))) return '텍스트를 선택해 빈칸을 하나 이상 만들어 주세요.';
  if (currentType === 'image' && maskTotal < 1) return '이미지를 올리고 가림 영역을 하나 이상 만들어 주세요.';
  return '';
}
$('#previewQuestion').addEventListener('click', () => {
  const error = validateQuestion(); if (error) { toast(error); return; }
  const content = $('#previewContent'); content.innerHTML = '';
  if (currentType === 'qa') content.innerHTML = `<span class="type-chip">질문·정답</span><h3>${$('#questionInput').innerHTML}</h3><div class="preview-answer"><strong>정답</strong>${$('#answerInput').innerHTML}</div>`;
  if (currentType === 'cloze') { const copy = $('#clozeInput').cloneNode(true); $$('.cloze-token', copy).forEach(mark => { mark.textContent = '＿'; }); content.innerHTML = '<span class="type-chip cloze">빈칸 암기</span>'; content.appendChild(copy); }
  if (currentType === 'image') content.innerHTML = `<span class="type-chip image">이미지 가리기</span><p>가림 영역 ${maskTotal}개에서 ${questionCount()}개의 질문이 생성됩니다.</p>`;
  $('#previewModal').hidden = false;
});
$('#closePreview').addEventListener('click', () => $('#previewModal').hidden = true);
$('#saveQuestion').addEventListener('click', () => {
  const error = validateQuestion(); if (error) { toast(error); return; }
  localStorage.removeItem('orae-draft'); toast(`${typeNames[currentType]} 문제를 저장했습니다.`);
  if (currentType === 'qa') { $('#questionInput').innerHTML = ''; $('#answerInput').innerHTML = ''; }
  if (currentType === 'cloze') $('#clozeInput').innerHTML = '';
  if (currentType === 'image') { clearMasks(); $('#imageWorkspace').hidden = true; $('#imageEmpty').hidden = false; $('#imageUpload').value = ''; }
  $('#hintInput').value = ''; $('#explanationInput').value = ''; $('#sourceInput').value = '';
});

const folderModal = $('#folderModal');
const defaultFolders = [
  { id: 'civil', name: '민법', count: 190, due: 18, children: [
    { id: 'civil-obligation', name: '채권총론', count: 82, due: 9, children: [
      { id: 'civil-default', name: '채무불이행', count: 34, due: 5, children: [] },
      { id: 'civil-damages', name: '손해배상', count: 27, due: 3, children: [] }
    ] },
    { id: 'civil-contract', name: '계약법', count: 61, due: 5, children: [] },
    { id: 'civil-tort', name: '불법행위', count: 47, due: 4, children: [] }
  ] },
  { id: 'criminal', name: '형법', count: 96, due: 7, children: [
    { id: 'criminal-general', name: '형법총론', count: 58, due: 4, children: [] },
    { id: 'criminal-specific', name: '형법각론', count: 38, due: 3, children: [] }
  ] },
  { id: 'constitution', name: '헌법', count: 74, due: 12, children: [
    { id: 'constitution-rights', name: '기본권론', count: 45, due: 8, children: [] },
    { id: 'constitution-government', name: '통치구조', count: 29, due: 4, children: [] }
  ] },
  { id: 'civil-procedure', name: '민사소송법', count: 41, due: 4, children: [] }
];
let folderTree = JSON.parse(localStorage.getItem('orae-folders') || 'null') || defaultFolders;
let selectedFolderId = 'root';
const escapeHtml = value => value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
function findFolder(items, id) {
  for (const item of items) { if (item.id === id) return item; const found = findFolder(item.children, id); if (found) return found; }
  return null;
}
function flattenFolders(items, depth = 0) { return items.flatMap(item => [{ ...item, depth }, ...flattenFolders(item.children, depth + 1)]); }
function renderFolderBranch(items, depth = 0) {
  return items.map(item => `<div class="outline-node" style="--depth:${depth}"><div class="outline-row"><button class="folder-name" data-folder-id="${item.id}"><span class="outline-caret"><i data-lucide="${item.children.length ? 'chevron-down' : 'file'}"></i></span><span class="folder-icon ${depth ? 'blue' : 'mint'}"><i data-lucide="folder"></i></span><span><strong>${escapeHtml(item.name)}</strong><small>${item.count}문제 · 복습 ${item.due}</small></span></button><button class="outline-add" data-add-child="${item.id}" title="하위 폴더 추가" aria-label="${escapeHtml(item.name)}에 하위 폴더 추가"><i data-lucide="folder-plus"></i></button><button class="outline-study" data-study-folder="${item.id}"><i data-lucide="play"></i><span>학습</span></button></div>${item.children.length ? `<div class="outline-children">${renderFolderBranch(item.children, depth + 1)}</div>` : ''}</div>`).join('');
}
function renderFolderOutline() { $('#folderOutline').innerHTML = renderFolderBranch(folderTree); window.lucide?.createIcons(); }
function refreshParentOptions(preferred = selectedFolderId) {
  $('#parentFolderInput').innerHTML = ['<option value="root">최상위</option>', ...flattenFolders(folderTree).map(item => `<option value="${item.id}">${'　'.repeat(item.depth)}${item.name}</option>`)].join('');
  $('#parentFolderInput').value = findFolder(folderTree, preferred) ? preferred : 'root';
}
function openFolderModal(parentId = selectedFolderId) { refreshParentOptions(parentId); folderModal.hidden = false; document.body.style.overflow = 'hidden'; $('#folderError').textContent = ''; $('#folderNameInput').value = ''; setTimeout(() => $('#folderNameInput').focus(), 50); }
function closeFolderModal() { folderModal.hidden = true; document.body.style.overflow = ''; }
$('#newFolderButton').addEventListener('click', () => openFolderModal('root')); $('#libraryNewFolder').addEventListener('click', () => openFolderModal(selectedFolderId));
$$('[data-close-folder]').forEach(button => button.addEventListener('click', closeFolderModal));
$('#saveFolder').addEventListener('click', () => {
  const name = $('#folderNameInput').value.trim();
  if (!name) { $('#folderError').textContent = '폴더 이름을 입력해 주세요.'; $('#folderNameInput').focus(); return; }
  const newFolder = { id: `folder-${Date.now()}`, name, count: 0, due: 0, children: [] };
  const parentId = $('#parentFolderInput').value;
  if (parentId === 'root') folderTree.push(newFolder); else findFolder(folderTree, parentId).children.push(newFolder);
  localStorage.setItem('orae-folders', JSON.stringify(folderTree));
  renderFolderOutline(); closeFolderModal(); toast(`'${name}' 폴더를 만들었습니다.`);
});
$('#folderOutline').addEventListener('click', event => {
  const addButton = event.target.closest('[data-add-child]');
  if (addButton) { openFolderModal(addButton.dataset.addChild); return; }
  const studyButton = event.target.closest('[data-study-folder]');
  if (studyButton) { selectedFolderId = studyButton.dataset.studyFolder; startStudy(); return; }
  const folderButton = event.target.closest('[data-folder-id]');
  if (folderButton) { selectedFolderId = folderButton.dataset.folderId; const folder = findFolder(folderTree, selectedFolderId); $('#libraryTitle').textContent = folder.name; $$('.outline-row').forEach(row => row.classList.toggle('selected', row.contains(folderButton))); }
});
renderFolderOutline();

const searchData = [['채무불이행의 성립 요건은?', '민법 / 채권총론 · 질문·정답'], ['계약 해제의 효과와 원상회복 의무', '민법 / 계약법 · 빈칸 암기'], ['채권자취소권 행사 구조', '민법 / 채권총론 · 이미지 가리기']];
function renderSearch(query) { const container = $('#searchResults'); const value = query.trim(); if (!value) return; const results = searchData.filter(item => item.join(' ').includes(value)); container.innerHTML = results.length ? results.map(item => `<button class="search-result"><strong>${item[0]}</strong><small>${item[1]}</small></button>`).join('') : '<span><i data-lucide="file-question"></i></span><h2>일치하는 문제가 없어요</h2><p>다른 검색어나 필터를 사용해 보세요.</p>'; window.lucide?.createIcons(); }
$('#searchPageInput').addEventListener('input', event => renderSearch(event.target.value));
$('#globalSearch').addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.value.trim()) { showView('search'); $('#searchPageInput').value = event.target.value; renderSearch(event.target.value); } });
document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#globalSearch').focus(); } if (event.key === 'Escape') { if (!modal.hidden) closeModal(); if (!folderModal.hidden) closeFolderModal(); if (!$('#previewModal').hidden) $('#previewModal').hidden = true; if (!$('#studyOverlay').hidden) exitStudy(); } });

const studyQuestions = ['채무불이행의 성립 요건은 무엇인가요?', '이행지체가 성립하기 위한 이행기의 의미를 설명하세요.', '채권자지체의 요건과 효과는 무엇인가요?', '손해배상의 범위를 정하는 민법의 원칙은 무엇인가요?'];
let studyIndex = 0;
const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
let todayStudy = JSON.parse(localStorage.getItem('orae-today-study') || 'null');
if (!todayStudy || todayStudy.date !== todayKey) todayStudy = { date: todayKey, count: 0 };
function updateTodayStudy() { $('#todayStudyCount').textContent = `${todayStudy.count}문제`; $('.quota-bar span').style.width = `${Math.min(todayStudy.count / 50 * 100, 100)}%`; }
updateTodayStudy();
function startStudy() { studyIndex = 0; $('#studyOverlay').hidden = false; document.body.style.overflow = 'hidden'; resetStudyCard(); }
function exitStudy() { $('#studyOverlay').hidden = true; document.body.style.overflow = ''; }
function resetStudyCard() {
  $('#studyQuestion').textContent = studyQuestions[studyIndex % studyQuestions.length];
  $('#hintBox').hidden = true; $('#answerBox').hidden = true; $('#ratings').hidden = true; $('#beforeAnswer').hidden = false;
  $('#studyCurrent').textContent = studyIndex + 1; $('#studyProgressBar').style.width = `${Math.min(((studyIndex + 1) / 18) * 100, 100)}%`;
  $$('[data-rating]').forEach(button => button.classList.remove('selected'));
}
$('#startStudy').addEventListener('click', startStudy); $('#libraryStudy').addEventListener('click', startStudy); $('#startNew').addEventListener('click', startStudy); $('#exitStudy').addEventListener('click', exitStudy);
$('#showHint').addEventListener('click', () => $('#hintBox').hidden = false);
$('#showAnswer').addEventListener('click', () => { $('#answerBox').hidden = false; $('#beforeAnswer').hidden = true; $('#ratings').hidden = false; setTimeout(() => $('#ratings').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50); });
$$('[data-rating]').forEach(button => button.addEventListener('click', () => {
  button.classList.add('selected');
  todayStudy.count += 1; localStorage.setItem('orae-today-study', JSON.stringify(todayStudy)); updateTodayStudy();
  studyIndex += 1;
  if (studyIndex >= 18) { exitStudy(); toast('오늘의 복습을 모두 마쳤어요!'); return; }
  resetStudyCard(); $('#studyOverlay').scrollTo({ top: 0, behavior: 'smooth' });
}));

const activity = $('#activityGrid');
for (let i = 0; i < 84; i += 1) { const cell = document.createElement('span'); const pattern = (i * 7 + i % 5) % 11; cell.dataset.level = pattern > 8 ? 3 : pattern > 5 ? 2 : pattern > 2 ? 1 : 0; cell.title = `${Math.max(0, pattern * 3 - 3)}문제 학습`; activity.appendChild(cell); }
$$('.community-tabs button').forEach(button => button.addEventListener('click', () => { $$('.community-tabs button').forEach(tab => tab.classList.remove('active')); button.classList.add('active'); toast(`${button.textContent} 게시판을 열었습니다.`); }));

