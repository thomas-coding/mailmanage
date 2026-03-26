const path = require('path');
const multer = require('multer');
const express = require('express');
const {
  getGroups,
  getAccounts,
  getAccountById,
  saveAccount,
  removeAccount,
  removeAccounts,
  replaceAccounts,
  createGroup,
  deleteGroup,
  assignGroupToAccounts,
  setAccountStatus,
  setAccountTokens,
  upsertMessages,
  getMessagesForAccount,
} = require('./src/db');
const { syncInbox } = require('./src/mailService');
const { parseTextAccounts, parseSpreadsheet, exportAccountsAsText } = require('./src/importExport');

const PORT = process.env.PORT || 3060;
const DEFAULT_SYNC_POLICY = {
  batchSize: 1,
  interAccountDelayMs: 0,
  interBatchDelayMs: 4000,
  maxRetries: 3,
  baseRetryDelayMs: 8000,
  maxRetryDelayMs: 45000,
};

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableSyncError(error) {
  const message = String(error?.message || '');
  return /AADSTS90055|excessive request rate|throttl|temporar|timeout|ETIMEDOUT|ECONNRESET|fetch failed|network/i.test(message);
}

function getRetryDelayMs(error, attempt, policy) {
  const message = String(error?.message || '');
  const millisecondsMatch = message.match(/(\d+)\s*milliseconds/i);
  if (millisecondsMatch) {
    return Math.min(Number(millisecondsMatch[1]), policy.maxRetryDelayMs);
  }

  const secondsMatch = message.match(/(\d+)\s*seconds/i);
  if (secondsMatch) {
    return Math.min(Number(secondsMatch[1]) * 1000, policy.maxRetryDelayMs);
  }

  return Math.min(policy.baseRetryDelayMs * (2 ** Math.max(0, attempt - 1)), policy.maxRetryDelayMs);
}

function importAccounts(records, mode) {
  if (!Array.isArray(records) || !records.length) {
    throw new Error('没有可导入的账号数据');
  }

  if (mode === 'replace') {
    return replaceAccounts(records);
  }

  return records.map((record) => saveAccount(record));
}

function selectedAccounts(ids) {
  const items = getAccounts();
  if (!ids.length) {
    return items;
  }

  const wanted = new Set(ids.map(Number));
  return items.filter((item) => wanted.has(item.id));
}

function parseIds(ids) {
  if (!Array.isArray(ids)) {
    return [];
  }

  return ids
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function buildCopyText(accounts, format) {
  const normalizedFormat = String(format || 'account').trim();
  const formatter = {
    account: (account) => account.email || '',
    password: (account) => account.password || '',
    'account-password': (account) => `${account.email || ''}----${account.password || ''}`,
  }[normalizedFormat];

  if (!formatter) {
    throw new Error('不支持的复制格式');
  }

  return accounts.map((account) => formatter(account)).join('\n');
}

async function syncSingleAccount(account, options) {
  const {
    limit,
    syncInboxImpl,
    sleepImpl,
    policy,
  } = options;
  let attempt = 0;
  let lastError = null;

  setAccountStatus(account.id, 'syncing', null, account.last_sync_at);

  while (attempt <= policy.maxRetries) {
    attempt += 1;

    try {
      const synced = await syncInboxImpl(account, { limit, mailbox: 'INBOX' });
      if (synced.tokenUpdate) {
        setAccountTokens(account.id, synced.tokenUpdate);
      }
      upsertMessages(account.id, 'INBOX', synced.messages);

      const syncedAt = new Date().toISOString();
      setAccountStatus(account.id, 'success', null, syncedAt);
      return {
        id: account.id,
        email: account.email,
        ok: true,
        synced: synced.total,
        syncedAt,
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;
      const canRetry = attempt <= policy.maxRetries && isRetryableSyncError(error);
      if (!canRetry) {
        break;
      }

      const retryDelayMs = getRetryDelayMs(error, attempt, policy);
      await sleepImpl(retryDelayMs);
    }
  }

  setAccountStatus(account.id, 'error', lastError?.message || '同步失败', account.last_sync_at);
  return {
    id: account.id,
    email: account.email,
    ok: false,
    error: lastError?.message || '同步失败',
    attempts: attempt,
  };
}

async function syncAccountsInBatches(accounts, options) {
  const {
    limit,
    syncInboxImpl,
    sleepImpl,
    policy,
  } = options;
  const results = [];

  for (let start = 0; start < accounts.length; start += policy.batchSize) {
    const batch = accounts.slice(start, start + policy.batchSize);

    for (const account of batch) {
      results.push(await syncSingleAccount(account, {
        limit,
        syncInboxImpl,
        sleepImpl,
        policy,
      }));
      if (policy.interAccountDelayMs > 0 && account !== batch[batch.length - 1]) {
        await sleepImpl(policy.interAccountDelayMs);
      }
    }

    const hasMoreBatches = start + policy.batchSize < accounts.length;
    if (hasMoreBatches && policy.interBatchDelayMs > 0) {
      await sleepImpl(policy.interBatchDelayMs);
    }
  }

  return results;
}

function createApp(options = {}) {
  const syncInboxImpl = options.syncInboxImpl || syncInbox;
  const sleepImpl = options.sleepImpl || sleep;
  const syncPolicy = {
    ...DEFAULT_SYNC_POLICY,
    ...(options.syncPolicy || {}),
  };
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 8 * 1024 * 1024,
    },
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/accounts', (req, res) => {
    res.json({ items: getAccounts() });
  });

  app.get('/api/groups', (req, res) => {
    res.json({ items: getGroups() });
  });

  app.post('/api/groups', asyncHandler(async (req, res) => {
    const group = createGroup(req.body || {});
    res.status(201).json({ item: group, items: getGroups(), accounts: getAccounts() });
  }));

  app.delete('/api/groups/:name', asyncHandler(async (req, res) => {
    deleteGroup(decodeURIComponent(req.params.name));
    res.json({ items: getGroups(), accounts: getAccounts() });
  }));

  app.post('/api/accounts', asyncHandler(async (req, res) => {
    const account = saveAccount(req.body);
    res.status(201).json(account);
  }));

  app.put('/api/accounts/batch-group', asyncHandler(async (req, res) => {
    const ids = parseIds(req.body.ids);
    if (!ids.length) {
      throw new Error('请先选择账号');
    }

    const count = assignGroupToAccounts(ids, req.body.group_name);
    res.json({ count, accounts: getAccounts(), groups: getGroups() });
  }));

  app.put('/api/accounts/:id', asyncHandler(async (req, res) => {
    const account = saveAccount({ ...req.body, id: req.params.id });
    res.json(account);
  }));

  app.delete('/api/accounts/:id', asyncHandler(async (req, res) => {
    removeAccount(req.params.id);
    res.status(204).end();
  }));

  app.post('/api/accounts/batch-delete', asyncHandler(async (req, res) => {
    const ids = parseIds(req.body.ids);
    if (!ids.length) {
      throw new Error('请先选择账号');
    }

    const count = removeAccounts(ids);
    res.json({ count, accounts: getAccounts(), groups: getGroups() });
  }));

  app.post('/api/accounts/copy', asyncHandler(async (req, res) => {
    const ids = parseIds(req.body.ids);
    if (!ids.length) {
      throw new Error('请先选择账号');
    }

    const items = selectedAccounts(ids);
    if (!items.length) {
      throw new Error('账号不存在');
    }

    res.json({
      count: items.length,
      format: req.body.format || 'account',
      text: buildCopyText(items, req.body.format),
    });
  }));

  app.post('/api/accounts/import-text', asyncHandler(async (req, res) => {
    const records = parseTextAccounts(req.body.text);
    const mode = req.body.mode === 'replace' ? 'replace' : 'append';
    const items = importAccounts(records, mode);
    res.status(201).json({ count: items.length, mode, items, accounts: getAccounts() });
  }));

  app.post('/api/accounts/import-file', upload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new Error('请选择要上传的文件');
    }

    const mode = req.body.mode === 'replace' ? 'replace' : 'append';
    const ext = path.extname(req.file.originalname).toLowerCase();
    let records;

    if (ext === '.txt') {
      records = parseTextAccounts(req.file.buffer.toString('utf8'));
    } else if (ext === '.xlsx' || ext === '.xls') {
      records = parseSpreadsheet(req.file.buffer, req.file.originalname);
    } else {
      throw new Error('仅支持 .txt / .xlsx / .xls 文件');
    }

    const items = importAccounts(records, mode);
    res.status(201).json({ count: items.length, mode, items, accounts: getAccounts() });
  }));

  app.get('/api/accounts/export', asyncHandler(async (req, res) => {
    const ids = String(req.query.ids || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const items = selectedAccounts(ids);
    const content = exportAccountsAsText(items);
    const today = new Date().toISOString().slice(0, 10);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`邮箱账号导出_${today}.txt`)}`);
    res.send(content);
  }));

  app.get('/api/accounts/:id/messages', asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit || 30);
    res.json({ items: getMessagesForAccount(req.params.id, limit) });
  }));

  app.post('/api/accounts/sync', asyncHandler(async (req, res) => {
    const ids = Array.isArray(req.body.ids) && req.body.ids.length
      ? req.body.ids.map(Number)
      : getAccounts().map((item) => item.id);
    const limit = Number(req.body.limit || 20);
    const accounts = ids.map((id) => getAccountById(id)).filter(Boolean);
    const missingResults = ids
      .filter((id) => !accounts.some((account) => account.id === id))
      .map((id) => ({ id, ok: false, error: '账号不存在', attempts: 0 }));
    const results = [
      ...missingResults,
      ...await syncAccountsInBatches(accounts, {
        limit,
        syncInboxImpl,
        sleepImpl,
        policy: syncPolicy,
      }),
    ];

    res.json({ items: results, accounts: getAccounts() });
  }));

  app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ error: error.message || '服务器错误' });
  });

  return app;
}

const app = createApp();
let server = null;

function startServer(port = PORT) {
  if (server) {
    return server;
  }

  server = app.listen(port, () => {
    console.log(`Mail manager running at http://localhost:${port}`);
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  createApp,
  startServer,
  DEFAULT_SYNC_POLICY,
  buildCopyText,
  isRetryableSyncError,
  getRetryDelayMs,
};
