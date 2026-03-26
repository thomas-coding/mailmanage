const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const configuredDbPath = process.env.MAIL_DB_PATH
  ? path.resolve(process.env.MAIL_DB_PATH)
  : path.join(__dirname, '..', 'data', 'mail.db');
const dataDir = path.dirname(configuredDbPath);
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(configuredDbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const DEFAULT_GROUP_NAME = 'default';
const DEFAULT_GROUP_LABEL = '默认分组';
const DEFAULT_GROUP_COLOR = '#27c7c4';
const FALLBACK_GROUP_COLOR = '#f2b04b';

db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '${FALLBACK_GROUP_COLOR}',
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    username TEXT,
    password TEXT NOT NULL DEFAULT '',
    provider TEXT,
    group_name TEXT DEFAULT 'default',
    imap_host TEXT NOT NULL DEFAULT 'outlook.office365.com',
    imap_port INTEGER NOT NULL DEFAULT 993,
    secure INTEGER NOT NULL DEFAULT 1,
    auth_type TEXT DEFAULT 'password',
    client_id TEXT,
    refresh_token TEXT,
    expires_at TEXT,
    status TEXT DEFAULT 'idle',
    last_sync_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    mailbox TEXT NOT NULL DEFAULT 'INBOX',
    uid INTEGER NOT NULL,
    message_id TEXT,
    from_name TEXT,
    from_address TEXT,
    subject TEXT,
    received_at TEXT,
    flags TEXT,
    snippet TEXT,
    stored_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    UNIQUE(account_id, mailbox, uid)
  );
`);

function ensureAccountColumn(name, definition) {
  const columns = db.prepare('PRAGMA table_info(accounts)').all();
  if (!columns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE accounts ADD COLUMN ${definition}`);
  }
}

ensureAccountColumn('auth_type', "auth_type TEXT DEFAULT 'password'");
ensureAccountColumn('client_id', 'client_id TEXT');
ensureAccountColumn('refresh_token', 'refresh_token TEXT');
ensureAccountColumn('expires_at', 'expires_at TEXT');

const ensureDefaultGroup = db.prepare(`
  INSERT INTO groups (name, display_name, color, is_system)
  VALUES (@name, @display_name, @color, 1)
  ON CONFLICT(name) DO UPDATE SET
    display_name = excluded.display_name,
    color = excluded.color,
    is_system = 1,
    updated_at = CURRENT_TIMESTAMP
`);

ensureDefaultGroup.run({
  name: DEFAULT_GROUP_NAME,
  display_name: DEFAULT_GROUP_LABEL,
  color: DEFAULT_GROUP_COLOR,
});

const accountSelect = `
  SELECT
    a.*,
    COUNT(m.id) AS message_count,
    COALESCE(MAX(g.display_name), CASE
      WHEN a.group_name = '${DEFAULT_GROUP_NAME}' THEN '${DEFAULT_GROUP_LABEL}'
      ELSE a.group_name
    END) AS group_label,
    COALESCE(MAX(g.color), '${DEFAULT_GROUP_COLOR}') AS group_color
  FROM accounts a
  LEFT JOIN messages m ON m.account_id = a.id
  LEFT JOIN groups g ON g.name = a.group_name
`;

const selectAllAccounts = db.prepare(`
  ${accountSelect}
  GROUP BY a.id
  ORDER BY a.id ASC
`);

const selectAccountById = db.prepare(`
  ${accountSelect}
  WHERE a.id = ?
  GROUP BY a.id
`);

const selectAccountByEmail = db.prepare(`
  ${accountSelect}
  WHERE a.email = ?
  GROUP BY a.id
`);

const insertAccount = db.prepare(`
  INSERT INTO accounts (
    email, username, password, provider, group_name,
    imap_host, imap_port, secure, auth_type,
    client_id, refresh_token, expires_at, status, last_error
  ) VALUES (
    @email, @username, @password, @provider, @group_name,
    @imap_host, @imap_port, @secure, @auth_type,
    @client_id, @refresh_token, @expires_at, 'idle', NULL
  )
`);

const updateAccount = db.prepare(`
  UPDATE accounts
  SET
    email = @email,
    username = @username,
    password = @password,
    provider = @provider,
    group_name = @group_name,
    imap_host = @imap_host,
    imap_port = @imap_port,
    secure = @secure,
    auth_type = @auth_type,
    client_id = @client_id,
    refresh_token = @refresh_token,
    expires_at = @expires_at,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = @id
`);

const deleteAccount = db.prepare('DELETE FROM accounts WHERE id = ?');
const deleteAllMessages = db.prepare('DELETE FROM messages');
const deleteAllAccounts = db.prepare('DELETE FROM accounts');
const deleteGroupByName = db.prepare('DELETE FROM groups WHERE name = ?');
const selectAllGroups = db.prepare(`
  SELECT
    name,
    display_name,
    color,
    is_system
  FROM groups
  ORDER BY
    CASE WHEN name = '${DEFAULT_GROUP_NAME}' THEN 0 ELSE 1 END,
    display_name COLLATE NOCASE ASC
`);
const selectGroupByName = db.prepare(`
  SELECT
    name,
    display_name,
    color,
    is_system
  FROM groups
  WHERE name = ?
`);
const insertGroup = db.prepare(`
  INSERT INTO groups (name, display_name, color, is_system)
  VALUES (@name, @display_name, @color, @is_system)
`);
const updateGroup = db.prepare(`
  UPDATE groups
  SET
    display_name = @display_name,
    color = @color,
    updated_at = CURRENT_TIMESTAMP
  WHERE name = @name
`);
const updateAccountsGroup = db.prepare(`
  UPDATE accounts
  SET
    group_name = @group_name,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = @id
`);
const moveAccountsToDefaultGroup = db.prepare(`
  UPDATE accounts
  SET
    group_name = '${DEFAULT_GROUP_NAME}',
    updated_at = CURRENT_TIMESTAMP
  WHERE group_name = ?
`);

const updateAccountStatus = db.prepare(`
  UPDATE accounts
  SET
    status = @status,
    last_sync_at = @last_sync_at,
    last_error = @last_error,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = @id
`);

const updateAccountTokens = db.prepare(`
  UPDATE accounts
  SET
    refresh_token = COALESCE(@refresh_token, refresh_token),
    expires_at = COALESCE(@expires_at, expires_at),
    updated_at = CURRENT_TIMESTAMP
  WHERE id = @id
`);

const insertMessage = db.prepare(`
  INSERT INTO messages (
    account_id, mailbox, uid, message_id, from_name, from_address,
    subject, received_at, flags, snippet
  ) VALUES (
    @account_id, @mailbox, @uid, @message_id, @from_name, @from_address,
    @subject, @received_at, @flags, @snippet
  )
  ON CONFLICT(account_id, mailbox, uid) DO UPDATE SET
    message_id = excluded.message_id,
    from_name = excluded.from_name,
    from_address = excluded.from_address,
    subject = excluded.subject,
    received_at = excluded.received_at,
    flags = excluded.flags,
    snippet = excluded.snippet,
    stored_at = CURRENT_TIMESTAMP
`);

const listMessagesForAccount = db.prepare(`
  SELECT *
  FROM messages
  WHERE account_id = ?
  ORDER BY datetime(COALESCE(received_at, stored_at)) DESC
  LIMIT ?
`);

function normalizeGroupName(value) {
  const text = String(value || '').trim();
  if (!text || text === DEFAULT_GROUP_NAME || text === DEFAULT_GROUP_LABEL) {
    return DEFAULT_GROUP_NAME;
  }

  return text;
}

function normalizeGroupDisplayName(name) {
  return name === DEFAULT_GROUP_NAME ? DEFAULT_GROUP_LABEL : name;
}

function validateGroupName(name) {
  if (name === DEFAULT_GROUP_NAME) {
    return;
  }

  if (!name) {
    throw new Error('分组名称不能为空');
  }

  if (name.length > 20) {
    throw new Error('分组名称不能超过 20 个字符');
  }
}

function validateGroupColor(color) {
  if (!/^#[0-9a-fA-F]{6}$/.test(String(color || ''))) {
    throw new Error('分组颜色格式不合法');
  }
}

function ensureGroupExists(name, color = FALLBACK_GROUP_COLOR) {
  const normalizedName = normalizeGroupName(name);
  const existing = selectGroupByName.get(normalizedName);
  if (existing) {
    return existing;
  }

  insertGroup.run({
    name: normalizedName,
    display_name: normalizeGroupDisplayName(normalizedName),
    color: normalizedName === DEFAULT_GROUP_NAME ? DEFAULT_GROUP_COLOR : color,
    is_system: normalizedName === DEFAULT_GROUP_NAME ? 1 : 0,
  });

  return selectGroupByName.get(normalizedName);
}

function normalizeAccountInput(input) {
  const provider = String(input.provider || 'outlook').trim() || 'outlook';
  const hasOAuth = Boolean(String(input.client_id || '').trim() && String(input.refresh_token || '').trim());
  const normalizedGroupName = normalizeGroupName(input.group_name);

  return {
    id: input.id ? Number(input.id) : undefined,
    email: String(input.email || '').trim(),
    username: String(input.username || input.email || '').trim(),
    password: String(input.password || '').trim(),
    provider,
    group_name: normalizedGroupName,
    imap_host: String(input.imap_host || defaultImapHost(provider)).trim() || defaultImapHost(provider),
    imap_port: Number(input.imap_port || 993),
    secure: input.secure === false || input.secure === 0 || input.secure === '0' ? 0 : 1,
    auth_type: String(input.auth_type || (hasOAuth ? 'oauth' : 'password')).trim() || 'password',
    client_id: String(input.client_id || '').trim() || null,
    refresh_token: String(input.refresh_token || '').trim() || null,
    expires_at: normalizeDateTime(input.expires_at),
  };
}

function defaultImapHost(provider) {
  const presets = {
    outlook: 'outlook.office365.com',
    gmail: 'imap.gmail.com',
    qq: 'imap.qq.com',
    yahoo: 'imap.mail.yahoo.com',
  };

  return presets[String(provider || '').toLowerCase()] || 'outlook.office365.com';
}

function normalizeDateTime(value) {
  if (!value) {
    return null;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

function validateAccountInput(account) {
  if (!account.email) {
    throw new Error('邮箱地址不能为空');
  }
  if (!account.imap_host) {
    throw new Error('IMAP 地址不能为空');
  }
  if (!Number.isInteger(account.imap_port) || account.imap_port <= 0) {
    throw new Error('IMAP 端口不合法');
  }
  if (account.auth_type === 'oauth') {
    if (!account.client_id) {
      throw new Error('Client ID 不能为空');
    }
    if (!account.refresh_token) {
      throw new Error('刷新令牌不能为空');
    }
  } else if (!account.password) {
    throw new Error('密码不能为空');
  }
}

function getAccounts() {
  return selectAllAccounts.all();
}

function getAccountById(id) {
  return selectAccountById.get(id);
}

function saveAccount(input) {
  const account = normalizeAccountInput(input);
  validateAccountInput(account);
  ensureGroupExists(account.group_name);

  if (!account.id) {
    const existing = selectAccountByEmail.get(account.email);
    if (existing) {
      account.id = existing.id;
    }
  }

  if (account.id) {
    updateAccount.run(account);
    return getAccountById(account.id);
  }

  const result = insertAccount.run(account);
  return getAccountById(result.lastInsertRowid);
}

function removeAccount(id) {
  return deleteAccount.run(id);
}

const removeAccounts = db.transaction((ids) => {
  let count = 0;
  for (const id of ids) {
    const result = deleteAccount.run(id);
    count += result.changes;
  }
  return count;
});

const replaceAccounts = db.transaction((items) => {
  deleteAllMessages.run();
  deleteAllAccounts.run();
  const accounts = [];
  for (const item of items) {
    accounts.push(saveAccount(item));
  }
  return accounts;
});

function setAccountStatus(id, status, lastError = null, syncedAt = null) {
  updateAccountStatus.run({
    id,
    status,
    last_error: lastError,
    last_sync_at: syncedAt,
  });
}

function setAccountTokens(id, payload) {
  updateAccountTokens.run({
    id,
    refresh_token: payload.refresh_token || null,
    expires_at: payload.expires_at || null,
  });
}

const upsertMessages = db.transaction((accountId, mailbox, messages) => {
  for (const message of messages) {
    insertMessage.run({
      account_id: accountId,
      mailbox,
      uid: message.uid,
      message_id: message.messageId || null,
      from_name: message.fromName || null,
      from_address: message.fromAddress || null,
      subject: message.subject || '(无主题)',
      received_at: message.receivedAt || null,
      flags: JSON.stringify(message.flags || []),
      snippet: message.snippet || null,
    });
  }
});

function getMessagesForAccount(accountId, limit = 30) {
  return listMessagesForAccount.all(accountId, limit);
}

function getGroups() {
  return selectAllGroups.all();
}

function createGroup(input) {
  const normalizedName = normalizeGroupName(input.name);
  const color = String(input.color || FALLBACK_GROUP_COLOR).trim() || FALLBACK_GROUP_COLOR;
  validateGroupName(normalizedName);
  validateGroupColor(color);

  if (normalizedName === DEFAULT_GROUP_NAME) {
    return selectGroupByName.get(DEFAULT_GROUP_NAME);
  }

  const existing = selectGroupByName.get(normalizedName);
  if (existing) {
    throw new Error('分组名称已存在');
  }

  insertGroup.run({
    name: normalizedName,
    display_name: normalizeGroupDisplayName(normalizedName),
    color,
    is_system: 0,
  });
  return selectGroupByName.get(normalizedName);
}

function deleteGroup(name) {
  const normalizedName = normalizeGroupName(name);
  if (normalizedName === DEFAULT_GROUP_NAME) {
    throw new Error('默认分组不能删除');
  }

  const existing = selectGroupByName.get(normalizedName);
  if (!existing) {
    throw new Error('分组不存在');
  }

  moveAccountsToDefaultGroup.run(normalizedName);
  deleteGroupByName.run(normalizedName);
}

const assignGroupToAccounts = db.transaction((ids, groupName) => {
  const normalizedName = normalizeGroupName(groupName);
  ensureGroupExists(normalizedName);

  let count = 0;
  for (const id of ids) {
    const result = updateAccountsGroup.run({
      id,
      group_name: normalizedName,
    });
    count += result.changes;
  }
  return count;
});

module.exports = {
  db,
  DEFAULT_GROUP_NAME,
  DEFAULT_GROUP_LABEL,
  DEFAULT_GROUP_COLOR,
  getAccounts,
  getAccountById,
  getGroups,
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
};
