const state = {
  accounts: [],
  selectedIds: new Set(),
  activeAccountId: null,
  messages: [],
  search: '',
  group: '',
  importTab: 'text',
  importFile: null,
};

const $ = (selector) => document.querySelector(selector);

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 2600);
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

function getFilteredAccounts() {
  return state.accounts.filter((account) => {
    const matchSearch = !state.search || account.email.toLowerCase().includes(state.search.toLowerCase());
    const matchGroup = !state.group || account.group_name === state.group;
    return matchSearch && matchGroup;
  });
}

function renderStats() {
  const groups = new Set(state.accounts.map((item) => item.group_name));
  const oauthCount = state.accounts.filter((item) => item.auth_type === 'oauth').length;
  const successCount = state.accounts.filter((item) => item.status === 'success').length;
  $('#stats').innerHTML = `
    <div class="stat-card"><span>账号总数</span><strong>${state.accounts.length}</strong></div>
    <div class="stat-card"><span>OAuth 账号</span><strong>${oauthCount}</strong></div>
    <div class="stat-card"><span>同步正常</span><strong>${successCount}</strong></div>
    <div class="stat-card"><span>分组数</span><strong>${groups.size}</strong></div>
  `;
}

function renderGroupFilter() {
  const select = $('#groupFilter');
  const groups = Array.from(new Set(state.accounts.map((item) => item.group_name))).filter(Boolean);
  select.innerHTML = '<option value="">全部分组</option>' +
    groups.map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join('');
  select.value = state.group;
}

function renderAccounts() {
  const rows = $('#accountRows');
  const accounts = getFilteredAccounts();

  $('#emptyState').classList.toggle('hidden', accounts.length > 0);
  rows.innerHTML = accounts.map((account, index) => `
    <tr data-account-row="${account.id}" class="${state.activeAccountId === account.id ? 'active' : ''}">
      <td><input type="checkbox" data-select-id="${account.id}" ${state.selectedIds.has(account.id) ? 'checked' : ''} /></td>
      <td>${index + 1}</td>
      <td>${escapeHtml(account.email)}</td>
      <td class="mono" title="${escapeHtml(account.client_id || '')}">${escapeHtml(shorten(account.client_id || '-'))}</td>
      <td><span class="tag">${escapeHtml(account.group_name || 'default')}</span></td>
      <td>${escapeHtml(formatDateTime(account.expires_at))}</td>
      <td><span class="status-pill ${escapeHtml(account.status || 'idle')}">${statusText(account.status || 'idle')}</span></td>
      <td>${account.message_count || 0}</td>
      <td>
        <div class="table-actions">
          <button class="action-view" data-view-id="${account.id}">查看</button>
          <button class="action-edit" data-edit-id="${account.id}">编辑</button>
          <button class="action-delete" data-delete-id="${account.id}">删除</button>
        </div>
      </td>
    </tr>
  `).join('');
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

async function loadAccounts() {
  const payload = await apiJson('/api/accounts');
  state.accounts = payload.items;

  if (state.activeAccountId && !state.accounts.some((item) => item.id === state.activeAccountId)) {
    state.activeAccountId = null;
    state.messages = [];
  }

  renderStats();
  renderGroupFilter();
  renderAccounts();
  renderMessages();
}

async function loadMessages(accountId) {
  state.activeAccountId = accountId;
  const payload = await apiJson(`/api/accounts/${accountId}/messages?limit=30`);
  state.messages = payload.items;
  renderAccounts();
  renderMessages();
}

function fillAccountForm(account = null) {
  $('#accountId').value = account?.id || '';
  $('#email').value = account?.email || '';
  $('#password').value = account?.password || '';
  $('#clientId').value = account?.client_id || '';
  $('#refreshToken').value = account?.refresh_token || '';
  $('#expiresAt').value = account?.expires_at ? account.expires_at.replace('T', ' ').slice(0, 19) : '';
  $('#groupName').value = account?.group_name || 'default';
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
    group_name: $('#groupName').value.trim() || 'default',
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
  await loadAccounts();
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
  renderStats();
  renderGroupFilter();
  renderAccounts();
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
  state.accounts = result.accounts;
  state.importFile = null;
  $('#fileInput').value = '';
  $('#importDialog').close();
  renderImportTab();
  renderStats();
  renderGroupFilter();
  renderAccounts();
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
  await loadAccounts();
}

async function syncAccounts(ids) {
  if (!ids.length) {
    showToast('请先选择账号');
    return;
  }

  showToast('开始同步收件箱');
  const result = await apiJson('/api/accounts/sync', {
    method: 'POST',
    body: JSON.stringify({ ids, limit: 20 }),
  });

  state.accounts = result.accounts;
  renderStats();
  renderGroupFilter();
  renderAccounts();

  if (state.activeAccountId) {
    await loadMessages(state.activeAccountId);
  }

  const failures = result.items.filter((item) => !item.ok);
  showToast(failures.length ? `同步完成，失败 ${failures.length} 个` : '同步完成');
}

function setImportFile(file) {
  state.importFile = file || null;
  renderImportTab();
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

  $('#syncSelectedBtn').addEventListener('click', () => {
    syncAccounts(Array.from(state.selectedIds)).catch((error) => showToast(error.message));
  });

  $('#syncAllBtn').addEventListener('click', () => {
    syncAccounts(state.accounts.map((item) => item.id)).catch((error) => showToast(error.message));
  });

  $('#refreshMessagesBtn').addEventListener('click', () => {
    if (state.activeAccountId) {
      loadMessages(state.activeAccountId).catch((error) => showToast(error.message));
    }
  });

  $('#selectAll').addEventListener('change', (event) => {
    const checked = event.target.checked;
    state.selectedIds = checked
      ? new Set(getFilteredAccounts().map((item) => item.id))
      : new Set();
    renderAccounts();
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

    if (target.matches('[data-select-id]')) {
      const id = Number(target.dataset.selectId);
      if (target.checked) {
        state.selectedIds.add(id);
      } else {
        state.selectedIds.delete(id);
      }
      return;
    }

    if (target.matches('[data-view-id]')) {
      event.stopPropagation();
      loadMessages(Number(target.dataset.viewId)).catch((error) => showToast(error.message));
      return;
    }

    if (target.matches('[data-edit-id]')) {
      event.stopPropagation();
      const account = state.accounts.find((item) => item.id === Number(target.dataset.editId));
      fillAccountForm(account);
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
bindEvents();
loadAccounts().catch((error) => showToast(error.message));
