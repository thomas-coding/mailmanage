const path = require('path');
const multer = require('multer');
const express = require('express');
const {
  getAccounts,
  getAccountById,
  saveAccount,
  removeAccount,
  replaceAccounts,
  setAccountStatus,
  setAccountTokens,
  upsertMessages,
  getMessagesForAccount,
} = require('./src/db');
const { syncInbox } = require('./src/mailService');
const { parseTextAccounts, parseSpreadsheet, exportAccountsAsText } = require('./src/importExport');

const PORT = process.env.PORT || 3060;

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
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

function createApp(options = {}) {
  const syncInboxImpl = options.syncInboxImpl || syncInbox;
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

  app.post('/api/accounts', asyncHandler(async (req, res) => {
    const account = saveAccount(req.body);
    res.status(201).json(account);
  }));

  app.put('/api/accounts/:id', asyncHandler(async (req, res) => {
    const account = saveAccount({ ...req.body, id: req.params.id });
    res.json(account);
  }));

  app.delete('/api/accounts/:id', asyncHandler(async (req, res) => {
    removeAccount(req.params.id);
    res.status(204).end();
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

    const results = [];
    for (const id of ids) {
      const account = getAccountById(id);
      if (!account) {
        results.push({ id, ok: false, error: '账号不存在' });
        continue;
      }

      setAccountStatus(account.id, 'syncing', null, account.last_sync_at);

      try {
        const synced = await syncInboxImpl(account, { limit, mailbox: 'INBOX' });
        if (synced.tokenUpdate) {
          setAccountTokens(account.id, synced.tokenUpdate);
        }
        upsertMessages(account.id, 'INBOX', synced.messages);

        const syncedAt = new Date().toISOString();
        setAccountStatus(account.id, 'success', null, syncedAt);
        results.push({
          id: account.id,
          email: account.email,
          ok: true,
          synced: synced.total,
          syncedAt,
        });
      } catch (error) {
        setAccountStatus(account.id, 'error', error.message, account.last_sync_at);
        results.push({
          id: account.id,
          email: account.email,
          ok: false,
          error: error.message,
        });
      }
    }

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
};
