const path = require('path');
const XLSX = require('xlsx');

function parseTextAccounts(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseTextLine);
}

function parseTextLine(line) {
  const delimiter = line.includes('\t')
    ? '\t'
    : line.includes('----')
      ? '----'
      : line.includes(',')
        ? ','
        : null;

  if (!delimiter) {
    throw new Error(`无法识别导入格式: ${line}`);
  }

  const parts = line.split(delimiter).map((item) => item.trim());
  if (parts.length < 4) {
    throw new Error(`字段不足 4 个: ${line}`);
  }

  const [email, password, client_id, refresh_token, expires_at = '', group_name = 'default'] = parts;

  return normalizeImportedAccount({
    email,
    password,
    client_id,
    refresh_token,
    expires_at,
    group_name,
  });
}

function parseSpreadsheet(buffer, filename) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
    header: 1,
    raw: false,
    defval: '',
  });

  return rows
    .filter((row) => row.some((cell) => String(cell || '').trim()))
    .map((row) => normalizeRow(row, filename))
    .filter(Boolean);
}

function normalizeRow(row, filename) {
  const email = String(row[0] || '').trim();
  const password = String(row[1] || '').trim();
  const client_id = String(row[2] || '').trim();
  const refresh_token = String(row[3] || '').trim();
  const expires_at = String(row[4] || '').trim();
  const group_name = String(row[5] || 'default').trim() || 'default';

  if (!email && !password && !client_id && !refresh_token) {
    return null;
  }

  const lowerEmail = email.toLowerCase();
  if (lowerEmail === '邮箱' || lowerEmail === 'email') {
    return null;
  }

  if (!email || !client_id || !refresh_token) {
    throw new Error(`${path.basename(filename)} 中存在不完整行，至少需要邮箱、Client ID、刷新令牌`);
  }

  return normalizeImportedAccount({
    email,
    password,
    client_id,
    refresh_token,
    expires_at,
    group_name,
  });
}

function normalizeImportedAccount(record) {
  return {
    email: String(record.email || '').trim(),
    username: String(record.email || '').trim(),
    password: String(record.password || '').trim(),
    client_id: String(record.client_id || '').trim(),
    refresh_token: String(record.refresh_token || '').trim(),
    expires_at: String(record.expires_at || '').trim(),
    group_name: String(record.group_name || 'default').trim() || 'default',
    provider: 'outlook',
    auth_type: 'oauth',
    imap_host: 'outlook.office365.com',
    imap_port: 993,
    secure: 1,
  };
}

function exportAccountsAsText(accounts) {
  return accounts
    .map((account) => [
      account.email || '',
      account.password || '',
      account.client_id || '',
      account.refresh_token || '',
    ].join('\t'))
    .join('\n');
}

module.exports = {
  parseTextAccounts,
  parseSpreadsheet,
  exportAccountsAsText,
};
