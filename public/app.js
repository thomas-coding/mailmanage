const state = {
  accounts: [],
  selectedIds: new Set(),
  activeAccountId: null,
  messages: [],
  search: '',
  group: '',
  importTab: 'text',
  importFile: null,
  syncJob: null,
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

function getFilteredAccounts() {
  return state.accounts.filter((account) => {
    const matchSearch = !state.search || account.email.toLowerCase().includes(state.search.toLowerCase());
    const matchGroup = !state.group || account.group_name === state.group;
    return matchSearch && matchGroup;
  });
}

function renderAccountSummary() {
  renderStats();
  renderGroupFilter();
  renderAccounts();
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
          <button class="action-view" data-view-id="${account.id}">同步查看</button>
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

function renderSyncControls() {
  const syncing = Boolean(state.syncJob?.active);
  $('#syncSelectedBtn').disabled = syncing;
  $('#syncAllBtn').disabled = syncing;
  $('#syncSelectedBtn').textContent = syncing ? '同步中...' : '同步选中';
  $('#syncAllBtn').textContent = syncing ? '同步中...' : '同步全部';
}

async function loadAccounts() {
  const payload = await apiJson('/api/accounts');
  state.accounts = payload.items;

  if (state.activeAccountId && !state.accounts.some((item) => item.id === state.activeAccountId)) {
    state.activeAccountId = null;
    state.messages = [];
  }

  renderAccountSummary();
  renderMessages();
  renderSyncControls();
}

async function loadMessages(accountId) {
  state.activeAccountId = accountId;
  const payload = await apiJson(`/api/accounts/${accountId}/messages?limit=30`);
  state.messages = payload.items;
  renderAccounts();
  renderMessages();
  renderSyncControls();
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
  renderAccountSummary();
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
  renderAccountSummary();
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
  renderAccountSummary();
  renderSyncControls();
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
    renderAccountSummary();

    const targetAccountId = viewAccountId || state.activeAccountId;
    if (targetAccountId) {
      await loadMessages(targetAccountId);
    } else {
      renderSyncControls();
    }

    const failures = result.items.filter((item) => !item.ok);
    const successCount = result.items.length - failures.length;
    setSyncNotice(
      viewAccountId
        ? (
          failures.length
            ? `单账号同步完成，但本次同步失败。已保留表格状态，你仍可查看本地缓存邮件。`
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
    await loadAccounts().catch(() => {});
    if (viewAccountId) {
      await loadMessages(viewAccountId).catch(() => {});
    }
    setSyncNotice(`同步请求失败：${error.message}`, { tone: 'error', autoHideMs: 6000 });
    showToast(error.message);
  } finally {
    state.syncJob = null;
    renderSyncControls();
  }
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
      syncAccounts([Number(target.dataset.viewId)], {
        viewAccountId: Number(target.dataset.viewId),
      });
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
renderSyncControls();
loadAccounts().catch((error) => showToast(error.message));
