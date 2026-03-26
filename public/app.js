const GROUP_COLORS = [
  '#4094ff',
  '#72c240',
  '#f2b04b',
  '#f56c6c',
  '#9ea4af',
  '#f564b0',
  '#ab47bc',
  '#29b6b3',
  '#ff9800',
  '#e91e63',
  '#32cd32',
  '#2f86eb',
  '#ff1493',
  '#17bebb',
  '#ffa000',
];

const DEFAULT_GROUP = {
  name: 'default',
  display_name: '默认分组',
  color: '#27c7c4',
};

const state = {
  accounts: [],
  groups: [],
  selectedIds: new Set(),
  activeAccountId: null,
  messages: [],
  search: '',
  group: '',
  importTab: 'text',
  importFile: null,
  syncJob: null,
  copyMenuOpen: false,
  newGroupColor: GROUP_COLORS[0],
};

const $ = (selector) => document.querySelector(selector);

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 2600);
}

function setSyncNotice(message, options = {}) {
  const notice = $('#syncNotice');
  clearTimeout(setSyncNotice.timer);

  if (!message) {
    notice.textContent = '';
    notice.className = 'sync-notice hidden';
    return;
  }

  const tone = options.tone || 'info';
  notice.textContent = message;
  notice.className = `sync-notice ${tone}`;

  if (options.autoHideMs) {
    setSyncNotice.timer = setTimeout(() => {
      notice.textContent = '';
      notice.className = 'sync-notice hidden';
    }, options.autoHideMs);
  }
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || '请求失败');
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function apiBlob(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('下载失败');
  }

  return {
    blob: await response.blob(),
    filename: parseFileName(response.headers.get('Content-Disposition')),
  };
}

function parseFileName(disposition) {
  if (!disposition) {
    return '邮箱账号导出.txt';
  }

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    return decodeURIComponent(utf8Match[1]);
  }

  const plainMatch = disposition.match(/filename="?([^"]+)"?/i);
  return plainMatch ? plainMatch[1] : '邮箱账号导出.txt';
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function statusText(status) {
  return {
    idle: '待同步',
    syncing: '同步中',
    success: '正常',
    error: '失败',
  }[status] || status;
}

function shorten(text, size = 14) {
  const value = String(text || '');
  if (value.length <= size) {
    return value;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatDateTime(value) {
  if (!value) {
    return '-';
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

function hexToRgba(hex, alpha = 0.16) {
  const clean = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    return `rgba(39, 199, 196, ${alpha})`;
  }

  const value = Number.parseInt(clean, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getGroupMeta(name) {
  return state.groups.find((group) => group.name === name)
    || (name === DEFAULT_GROUP.name ? DEFAULT_GROUP : null)
    || {
      name,
      display_name: name || DEFAULT_GROUP.display_name,
      color: GROUP_COLORS[2],
    };
}

function getFilteredAccounts() {
  return state.accounts.filter((account) => {
    const matchSearch = !state.search || account.email.toLowerCase().includes(state.search.toLowerCase());
    const matchGroup = !state.group || account.group_name === state.group;
    return matchSearch && matchGroup;
  });
}

function renderStats() {
  const successCount = state.accounts.filter((item) => item.status === 'success').length;
  $('#stats').innerHTML = `
    <div class="stat-card"><span>账号总数</span><strong>${state.accounts.length}</strong></div>
    <div class="stat-card"><span>OAuth 账号</span><strong>${state.accounts.filter((item) => item.auth_type === 'oauth').length}</strong></div>
    <div class="stat-card"><span>同步正常</span><strong>${successCount}</strong></div>
    <div class="stat-card"><span>分组数</span><strong>${state.groups.length || 1}</strong></div>
  `;
}

function syncSelectOptions(select, options, config = {}) {
  const currentValue = select.value;
  const placeholder = config.placeholder || '';
  const includePlaceholder = Boolean(config.includePlaceholder);
  const html = [];

  if (includePlaceholder) {
    html.push(`<option value="">${escapeHtml(placeholder)}</option>`);
  }

  for (const option of options) {
    html.push(`<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`);
  }

  select.innerHTML = html.join('');

  const allowedValues = new Set(options.map((option) => option.value));
  if (currentValue && allowedValues.has(currentValue)) {
    select.value = currentValue;
  } else if (includePlaceholder) {
    select.value = '';
  } else if (allowedValues.has(DEFAULT_GROUP.name)) {
    select.value = DEFAULT_GROUP.name;
  }
}

function renderGroupFilter() {
  syncSelectOptions(
    $('#groupFilter'),
    state.groups.map((group) => ({ value: group.name, label: group.display_name })),
    { includePlaceholder: true, placeholder: '全部分组' },
  );
  $('#groupFilter').value = state.group;
}

function renderGroupSelects() {
  syncSelectOptions(
    $('#groupName'),
    state.groups.map((group) => ({ value: group.name, label: group.display_name })),
  );

  syncSelectOptions(
    $('#batchGroupSelect'),
    state.groups.map((group) => ({ value: group.name, label: group.display_name })),
    { includePlaceholder: true, placeholder: '请选择分组' },
  );
}

function renderAccounts() {
  const rows = $('#accountRows');
  const accounts = getFilteredAccounts();

  $('#emptyState').classList.toggle('hidden', accounts.length > 0);
  rows.innerHTML = accounts.map((account, index) => {
    const group = getGroupMeta(account.group_name);
    return `
      <tr data-account-row="${account.id}" class="${state.activeAccountId === account.id ? 'active' : ''}">
        <td><input type="checkbox" data-select-id="${account.id}" ${state.selectedIds.has(account.id) ? 'checked' : ''} /></td>
        <td>${index + 1}</td>
        <td>${escapeHtml(account.email)}</td>
        <td class="mono" title="${escapeHtml(account.client_id || '')}">${escapeHtml(shorten(account.client_id || '-'))}</td>
        <td><span class="tag" style="--tag-color:${escapeHtml(group.color)};--tag-bg:${escapeHtml(hexToRgba(group.color))};">${escapeHtml(group.display_name)}</span></td>
        <td>${escapeHtml(formatDateTime(account.expires_at))}</td>
        <td><span class="status-pill ${escapeHtml(account.status || 'idle')}">${statusText(account.status || 'idle')}</span></td>
        <td>${account.message_count || 0}</td>
        <td>
          <div class="table-actions">
            <button class="action-view" data-view-id="${account.id}">同步查看</button>
            <button class="action-edit" data-edit-id="${account.id}">编辑</button>
            <button class="action-delete" data-delete-id="${account.id}">删除</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  const selectAll = $('#selectAll');
  const filteredIds = accounts.map((account) => account.id);
  const selectedVisibleCount = filteredIds.filter((id) => state.selectedIds.has(id)).length;
  selectAll.checked = Boolean(filteredIds.length) && selectedVisibleCount === filteredIds.length;
  selectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < filteredIds.length;
}

function renderMessages() {
  const target = $('#messageList');
  $('#messageHint').textContent = state.activeAccountId
    ? '显示当前账号最近同步到本地数据库的邮件'
    : '点击账号后显示最近同步到本地的邮件';

  if (!state.activeAccountId) {
    target.innerHTML = '<div class="empty">请选择一个账号查看邮件</div>';
    return;
  }

  if (!state.messages.length) {
    target.innerHTML = '<div class="empty">这个账号还没有同步到本地邮件</div>';
    return;
  }

  target.innerHTML = state.messages.map((message) => `
    <article class="message-item">
      <h4>${escapeHtml(message.subject || '(无主题)')}</h4>
      <div class="message-meta">
        <span>${escapeHtml(message.from_name || message.from_address || '未知发件人')}</span>
        <span>${escapeHtml(formatDateTime(message.received_at))}</span>
      </div>
      <p>${escapeHtml(message.from_address || '')}</p>
    </article>
  `).join('');
}

function renderImportTab() {
  document.querySelectorAll('[data-import-tab]').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.importTab === state.importTab);
  });

  document.querySelectorAll('[data-import-pane]').forEach((pane) => {
    pane.classList.toggle('hidden', pane.dataset.importPane !== state.importTab);
  });

  $('#selectedFileName').textContent = state.importFile
    ? `已选择文件: ${state.importFile.name}`
    : '未选择文件';
}

function renderColorPalette() {
  $('#groupColorPalette').innerHTML = GROUP_COLORS.map((color) => `
    <button
      type="button"
      class="color-swatch ${state.newGroupColor === color ? 'active' : ''}"
      data-group-color="${color}"
      style="background:${color};position:relative;"
    >
      <span>${color}</span>
    </button>
  `).join('');
}

function renderToolbarState() {
  const syncing = Boolean(state.syncJob?.active);
  const hasSelection = state.selectedIds.size > 0;
  const hasAccounts = state.accounts.length > 0;

  $('#syncSelectedBtn').disabled = syncing || !hasSelection;
  $('#syncAllBtn').disabled = syncing || !hasAccounts;
  $('#copyMenuBtn').disabled = syncing || !hasSelection;
  $('#openGroupDialogBtn').disabled = syncing || !hasSelection;
  $('#batchDeleteBtn').disabled = syncing || !hasSelection;

  $('#syncSelectedBtn').textContent = syncing ? '同步中...' : '同步选中';
  $('#syncAllBtn').textContent = syncing ? '同步中...' : '同步全部';

  if (syncing || !hasSelection) {
    state.copyMenuOpen = false;
    renderCopyMenu();
  }
}

function renderCopyMenu() {
  $('#copyMenu').classList.toggle('hidden', !state.copyMenuOpen);
}

function renderSelectedGroupCount() {
  $('#selectedGroupCount').textContent = `已选中 ${state.selectedIds.size} 个账号`;
}

function renderAll() {
  renderStats();
  renderGroupFilter();
  renderGroupSelects();
  renderAccounts();
  renderMessages();
  renderToolbarState();
  renderSelectedGroupCount();
  renderColorPalette();
}

async function refreshOverview() {
  const [accountsPayload, groupsPayload] = await Promise.all([
    apiJson('/api/accounts'),
    apiJson('/api/groups'),
  ]);

  state.accounts = accountsPayload.items;
  state.groups = groupsPayload.items;

  if (state.group && !state.groups.some((group) => group.name === state.group)) {
    state.group = '';
  }

  if (state.activeAccountId && !state.accounts.some((item) => item.id === state.activeAccountId)) {
    state.activeAccountId = null;
    state.messages = [];
  }

  renderAll();
}

async function loadMessages(accountId) {
  state.activeAccountId = accountId;
  const payload = await apiJson(`/api/accounts/${accountId}/messages?limit=30`);
  state.messages = payload.items;
  renderAccounts();
  renderMessages();
  renderToolbarState();
}

function fillAccountForm(account = null) {
  $('#accountId').value = account?.id || '';
  $('#email').value = account?.email || '';
  $('#password').value = account?.password || '';
  $('#clientId').value = account?.client_id || '';
  $('#refreshToken').value = account?.refresh_token || '';
  $('#expiresAt').value = account?.expires_at ? account.expires_at.replace('T', ' ').slice(0, 19) : '';
  $('#groupName').value = account?.group_name || DEFAULT_GROUP.name;
  $('#accountDialogTitle').textContent = account ? '编辑账号' : '新增账号';
}

async function saveAccount(event) {
  event.preventDefault();
  const body = {
    email: $('#email').value.trim(),
    username: $('#email').value.trim(),
    password: $('#password').value.trim(),
    client_id: $('#clientId').value.trim(),
    refresh_token: $('#refreshToken').value.trim(),
    expires_at: $('#expiresAt').value.trim(),
    group_name: $('#groupName').value.trim() || DEFAULT_GROUP.name,
    provider: 'outlook',
    auth_type: 'oauth',
    imap_host: 'outlook.office365.com',
    imap_port: 993,
    secure: true,
  };

  const id = $('#accountId').value;
  const url = id ? `/api/accounts/${id}` : '/api/accounts';
  const method = id ? 'PUT' : 'POST';

  await apiJson(url, { method, body: JSON.stringify(body) });
  $('#accountDialog').close();
  showToast(id ? '账号已更新' : '账号已创建');
  await refreshOverview();
}

async function importText(mode) {
  const text = $('#importText').value.trim();
  if (!text) {
    showToast('请先粘贴账号文本');
    return;
  }

  const result = await apiJson('/api/accounts/import-text', {
    method: 'POST',
    body: JSON.stringify({ text, mode }),
  });

  state.accounts = result.accounts;
  $('#importText').value = '';
  $('#importDialog').close();
  await refreshOverview();
  showToast(`${mode === 'replace' ? '覆盖' : '追加'}导入 ${result.count} 个账号`);
}

async function importFile(mode) {
  if (!state.importFile) {
    showToast('请先选择文件');
    return;
  }

  const formData = new FormData();
  formData.append('file', state.importFile);
  formData.append('mode', mode);

  const response = await fetch('/api/accounts/import-file', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || '文件导入失败');
  }

  const result = await response.json();
  state.importFile = null;
  $('#fileInput').value = '';
  $('#importDialog').close();
  renderImportTab();
  await refreshOverview();
  showToast(`${mode === 'replace' ? '覆盖' : '追加'}导入 ${result.count} 个账号`);
}

async function runImport(mode) {
  if (state.importTab === 'file') {
    await importFile(mode);
    return;
  }

  await importText(mode);
}

async function exportAccounts() {
  const ids = Array.from(state.selectedIds);
  const query = ids.length ? `?ids=${ids.join(',')}` : '';
  const { blob, filename } = await apiBlob(`/api/accounts/export${query}`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast(ids.length ? '已导出选中账号' : '已导出全部账号');
}

async function deleteAccount(id) {
  if (!window.confirm('确定删除这个邮箱账号吗？')) {
    return;
  }

  await apiJson(`/api/accounts/${id}`, { method: 'DELETE' });
  state.selectedIds.delete(id);
  if (state.activeAccountId === id) {
    state.activeAccountId = null;
    state.messages = [];
  }
  showToast('账号已删除');
  await refreshOverview();
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

async function copySelectedAccounts(format) {
  if (!state.selectedIds.size) {
    showToast('请先选择账号');
    return;
  }

  const payload = await apiJson('/api/accounts/copy', {
    method: 'POST',
    body: JSON.stringify({
      ids: Array.from(state.selectedIds),
      format,
    }),
  });

  await writeClipboard(payload.text);
  state.copyMenuOpen = false;
  renderCopyMenu();
  showToast(`已复制 ${payload.count} 条数据`);
}

function openBatchGroupDialog() {
  if (!state.selectedIds.size) {
    showToast('请先选择账号');
    return;
  }

  renderSelectedGroupCount();
  renderGroupSelects();
  $('#groupDialog').showModal();
}

function openNewGroupDialog() {
  $('#newGroupName').value = '';
  $('#groupNameCounter').textContent = '0 / 20';
  state.newGroupColor = GROUP_COLORS[0];
  renderColorPalette();
  $('#newGroupDialog').showModal();
}

async function createNewGroup(event) {
  event.preventDefault();

  const name = $('#newGroupName').value.trim();
  if (!name) {
    showToast('请输入分组名称');
    return;
  }

  const result = await apiJson('/api/groups', {
    method: 'POST',
    body: JSON.stringify({
      name,
      color: state.newGroupColor,
    }),
  });

  state.groups = result.items;
  state.accounts = result.accounts;
  renderAll();
  $('#batchGroupSelect').value = name;
  $('#newGroupDialog').close();
  showToast('分组已创建');
}

async function deleteSelectedGroup() {
  const groupName = $('#batchGroupSelect').value;
  if (!groupName) {
    showToast('请先选择分组');
    return;
  }

  if (!window.confirm('删除分组后，该分组下账号会回到默认分组，确定继续吗？')) {
    return;
  }

  const result = await apiJson(`/api/groups/${encodeURIComponent(groupName)}`, {
    method: 'DELETE',
  });

  state.groups = result.items;
  state.accounts = result.accounts;
  renderAll();
  $('#batchGroupSelect').value = '';
  showToast('分组已删除');
}

async function assignSelectedGroup() {
  if (!state.selectedIds.size) {
    showToast('请先选择账号');
    return;
  }

  const groupName = $('#batchGroupSelect').value;
  if (!groupName) {
    showToast('请选择分组');
    return;
  }

  const result = await apiJson('/api/accounts/batch-group', {
    method: 'PUT',
    body: JSON.stringify({
      ids: Array.from(state.selectedIds),
      group_name: groupName,
    }),
  });

  state.accounts = result.accounts;
  state.groups = result.groups;
  renderAll();
  $('#groupDialog').close();
  showToast(`已更新 ${result.count} 个账号分组`);
}

async function deleteSelectedAccounts() {
  if (!state.selectedIds.size) {
    showToast('请先选择账号');
    return;
  }

  if (!window.confirm(`确定删除选中的 ${state.selectedIds.size} 个账号吗？`)) {
    return;
  }

  const selectedIds = Array.from(state.selectedIds);
  const result = await apiJson('/api/accounts/batch-delete', {
    method: 'POST',
    body: JSON.stringify({ ids: selectedIds }),
  });

  for (const id of selectedIds) {
    state.selectedIds.delete(id);
  }

  if (state.activeAccountId && selectedIds.includes(state.activeAccountId)) {
    state.activeAccountId = null;
    state.messages = [];
  }

  state.accounts = result.accounts;
  state.groups = result.groups;
  renderAll();
  showToast(`已删除 ${result.count} 个账号`);
}

async function syncAccounts(ids, options = {}) {
  if (state.syncJob?.active) {
    showToast('已有同步任务正在执行，请等待完成');
    return;
  }

  if (!ids.length) {
    showToast('请先选择账号');
    return;
  }

  const viewAccountId = options.viewAccountId ? Number(options.viewAccountId) : null;
  const syncingIds = new Set(ids);
  state.syncJob = {
    active: true,
    ids: syncingIds,
    startedAt: Date.now(),
  };
  state.accounts = state.accounts.map((account) => (
    syncingIds.has(account.id)
      ? { ...account, status: 'syncing' }
      : account
  ));
  renderAll();
  setSyncNotice(
    viewAccountId
      ? '正在同步当前账号并准备打开最新邮件，完成前这条提示不会消失。'
      : `正在同步 ${ids.length} 个账号。当前按分批串行执行，完成前这条提示不会消失，请以“同步完成”结果提示为准。`,
    { tone: 'info' },
  );

  try {
    const result = await apiJson('/api/accounts/sync', {
      method: 'POST',
      body: JSON.stringify({ ids, limit: 20 }),
    });

    state.accounts = result.accounts;
    renderAll();

    const targetAccountId = viewAccountId || state.activeAccountId;
    if (targetAccountId) {
      await loadMessages(targetAccountId);
    }

    const failures = result.items.filter((item) => !item.ok);
    const successCount = result.items.length - failures.length;
    setSyncNotice(
      viewAccountId
        ? (
          failures.length
            ? '单账号同步完成，但本次同步失败。已保留表格状态，你仍可查看本地缓存邮件。'
            : '单账号同步完成，已打开最新邮件预览。'
        )
        : failures.length
          ? `同步完成：成功 ${successCount} 个，失败 ${failures.length} 个。表格状态已刷新。`
          : `同步完成：${successCount} 个账号全部成功。表格状态已刷新。`,
      { tone: failures.length ? 'warning' : 'success', autoHideMs: 5000 },
    );
    showToast(
      viewAccountId
        ? (failures.length ? '同步失败，已打开本地缓存邮件' : '同步完成，已打开最新邮件')
        : (failures.length ? `同步完成，失败 ${failures.length} 个` : '同步完成'),
    );
  } catch (error) {
    await refreshOverview().catch(() => {});
    if (viewAccountId) {
      await loadMessages(viewAccountId).catch(() => {});
    }
    setSyncNotice(`同步请求失败：${error.message}`, { tone: 'error', autoHideMs: 6000 });
    showToast(error.message);
  } finally {
    state.syncJob = null;
    renderToolbarState();
  }
}

function setImportFile(file) {
  state.importFile = file || null;
  renderImportTab();
}

function toggleCopyMenu(forceValue) {
  state.copyMenuOpen = typeof forceValue === 'boolean' ? forceValue : !state.copyMenuOpen;
  renderCopyMenu();
}

function bindEvents() {
  $('#searchInput').addEventListener('input', (event) => {
    state.search = event.target.value.trim();
    renderAccounts();
  });

  $('#groupFilter').addEventListener('change', (event) => {
    state.group = event.target.value;
    renderAccounts();
  });

  $('#openCreateBtn').addEventListener('click', () => {
    fillAccountForm();
    renderGroupSelects();
    $('#accountDialog').showModal();
  });

  $('#openImportBtn').addEventListener('click', () => {
    state.importTab = 'text';
    state.importFile = null;
    $('#fileInput').value = '';
    renderImportTab();
    $('#importDialog').showModal();
  });

  $('#exportBtn').addEventListener('click', () => {
    exportAccounts().catch((error) => showToast(error.message));
  });

  $('#copyMenuBtn').addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.currentTarget.disabled) {
      return;
    }
    toggleCopyMenu();
  });

  $('#openGroupDialogBtn').addEventListener('click', () => {
    openBatchGroupDialog();
  });

  $('#batchDeleteBtn').addEventListener('click', () => {
    deleteSelectedAccounts().catch((error) => showToast(error.message));
  });

  $('#syncSelectedBtn').addEventListener('click', () => {
    syncAccounts(Array.from(state.selectedIds));
  });

  $('#syncAllBtn').addEventListener('click', () => {
    syncAccounts(state.accounts.map((item) => item.id));
  });

  $('#refreshMessagesBtn').addEventListener('click', () => {
    if (state.activeAccountId) {
      loadMessages(state.activeAccountId).catch((error) => showToast(error.message));
    }
  });

  $('#selectAll').addEventListener('change', (event) => {
    const checked = event.target.checked;
    const filteredIds = getFilteredAccounts().map((item) => item.id);
    for (const id of filteredIds) {
      if (checked) {
        state.selectedIds.add(id);
      } else {
        state.selectedIds.delete(id);
      }
    }
    renderAccounts();
    renderToolbarState();
    renderSelectedGroupCount();
  });

  $('#accountForm').addEventListener('submit', (event) => {
    saveAccount(event).catch((error) => showToast(error.message));
  });

  $('#appendImportBtn').addEventListener('click', () => {
    runImport('append').catch((error) => showToast(error.message));
  });

  $('#replaceImportBtn').addEventListener('click', () => {
    if (window.confirm('覆盖导入会清空当前账号列表，确定继续吗？')) {
      runImport('replace').catch((error) => showToast(error.message));
    }
  });

  $('#confirmBatchGroupBtn').addEventListener('click', () => {
    assignSelectedGroup().catch((error) => showToast(error.message));
  });

  $('#openNewGroupBtn').addEventListener('click', () => {
    openNewGroupDialog();
  });

  $('#deleteGroupBtn').addEventListener('click', () => {
    deleteSelectedGroup().catch((error) => showToast(error.message));
  });

  $('#newGroupForm').addEventListener('submit', (event) => {
    createNewGroup(event).catch((error) => showToast(error.message));
  });

  $('#newGroupName').addEventListener('input', (event) => {
    $('#groupNameCounter').textContent = `${event.target.value.length} / 20`;
  });

  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => {
      $(`#${button.dataset.closeDialog}`).close();
    });
  });

  document.querySelectorAll('[data-import-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.importTab = button.dataset.importTab;
      renderImportTab();
    });
  });

  $('#pickFileBtn').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (event) => setImportFile(event.target.files[0]));

  const dropzone = $('#dropzone');
  ['dragenter', 'dragover'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (event) => {
    const [file] = Array.from(event.dataTransfer?.files || []);
    setImportFile(file);
  });

  document.addEventListener('click', (event) => {
    const target = event.target;

    if (!target.closest('.dropdown')) {
      toggleCopyMenu(false);
    }

    if (target.matches('[data-copy-format]')) {
      event.stopPropagation();
      copySelectedAccounts(target.dataset.copyFormat).catch((error) => showToast(error.message));
      return;
    }

    if (target.matches('[data-group-color]')) {
      event.preventDefault();
      state.newGroupColor = target.dataset.groupColor;
      renderColorPalette();
      return;
    }

    if (target.matches('[data-select-id]')) {
      const id = Number(target.dataset.selectId);
      if (target.checked) {
        state.selectedIds.add(id);
      } else {
        state.selectedIds.delete(id);
      }
      renderAccounts();
      renderToolbarState();
      renderSelectedGroupCount();
      return;
    }

    if (target.matches('[data-view-id]')) {
      event.stopPropagation();
      syncAccounts([Number(target.dataset.viewId)], {
        viewAccountId: Number(target.dataset.viewId),
      });
      return;
    }

    if (target.matches('[data-edit-id]')) {
      event.stopPropagation();
      const account = state.accounts.find((item) => item.id === Number(target.dataset.editId));
      fillAccountForm(account);
      renderGroupSelects();
      $('#accountDialog').showModal();
      return;
    }

    if (target.matches('[data-delete-id]')) {
      event.stopPropagation();
      deleteAccount(Number(target.dataset.deleteId)).catch((error) => showToast(error.message));
      return;
    }

    const row = target.closest('[data-account-row]');
    if (row) {
      loadMessages(Number(row.dataset.accountRow)).catch((error) => showToast(error.message));
    }
  });
}

renderImportTab();
renderCopyMenu();
renderColorPalette();
bindEvents();
refreshOverview().catch((error) => showToast(error.message));
