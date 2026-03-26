const XLSX = require('xlsx');
const {
  parseTextAccounts,
  parseSpreadsheet,
  exportAccountsAsText,
} = require('../src/importExport');

describe('importExport', () => {
  it('parses tab and dashed text formats', () => {
    const text = [
      'user1@example.com\tpass1\tclient-1\trefresh-1\t2026-04-01 10:00:00\talpha',
      'user2@example.com----pass2----client-2----refresh-2',
    ].join('\n');

    const accounts = parseTextAccounts(text);

    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({
      email: 'user1@example.com',
      password: 'pass1',
      client_id: 'client-1',
      refresh_token: 'refresh-1',
      expires_at: '2026-04-01 10:00:00',
      group_name: 'alpha',
      auth_type: 'oauth',
    });
    expect(accounts[1]).toMatchObject({
      email: 'user2@example.com',
      client_id: 'client-2',
      refresh_token: 'refresh-2',
      group_name: 'default',
    });
  });

  it('parses spreadsheet rows and skips header', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['邮箱', '密码', 'ClientID', '刷新令牌', '过期时间', '分组'],
      ['excel@example.com', 'pass3', 'client-3', 'refresh-3', '2026-05-01 12:00:00', 'ops'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const accounts = parseSpreadsheet(buffer, 'sample.xlsx');

    expect(accounts).toEqual([
      expect.objectContaining({
        email: 'excel@example.com',
        password: 'pass3',
        client_id: 'client-3',
        refresh_token: 'refresh-3',
        expires_at: '2026-05-01 12:00:00',
        group_name: 'ops',
      }),
    ]);
  });

  it('exports accounts as tab separated text', () => {
    const output = exportAccountsAsText([
      {
        email: 'user@example.com',
        password: 'pass',
        client_id: 'client',
        refresh_token: 'token',
      },
    ]);

    expect(output).toBe('user@example.com\tpass\tclient\ttoken');
  });
});
