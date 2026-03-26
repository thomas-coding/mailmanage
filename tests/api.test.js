const fs = require('fs');
const path = require('path');
const request = require('supertest');

const tempDir = path.join(__dirname, '.tmp');
const dbPath = path.join(tempDir, 'mail.test.db');

fs.mkdirSync(tempDir, { recursive: true });
if (fs.existsSync(dbPath)) {
  fs.rmSync(dbPath, { force: true });
}
process.env.MAIL_DB_PATH = dbPath;

const { createApp } = require('../server');
const { db, getAccounts, getMessagesForAccount } = require('../src/db');

function oauthPayload(overrides = {}) {
  return {
    email: 'demo@example.com',
    username: 'demo@example.com',
    password: 'pass',
    client_id: 'client-id',
    refresh_token: 'refresh-token',
    expires_at: '2026-06-01 10:00:00',
    group_name: 'default',
    provider: 'outlook',
    auth_type: 'oauth',
    imap_host: 'outlook.office365.com',
    imap_port: 993,
    secure: true,
    ...overrides,
  };
}

beforeAll(() => {
  db.pragma('foreign_keys = ON');
});

beforeEach(() => {
  db.exec('DELETE FROM messages; DELETE FROM accounts;');
});

afterAll(() => {
  db.close();
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { force: true });
  }
});

describe('api', () => {
  it('imports text data with append and replace modes', async () => {
    const app = createApp();

    const appendRes = await request(app)
      .post('/api/accounts/import-text')
      .send({
        mode: 'append',
        text: [
          'first@example.com\tpass1\tclient-1\trefresh-1\t2026-04-01 10:00:00\talpha',
          'second@example.com----pass2----client-2----refresh-2',
        ].join('\n'),
      })
      .expect(201);

    expect(appendRes.body.count).toBe(2);
    expect(appendRes.body.accounts).toHaveLength(2);

    const replaceRes = await request(app)
      .post('/api/accounts/import-text')
      .send({
        mode: 'replace',
        text: 'only@example.com\tpass3\tclient-3\trefresh-3\t2026-07-01 10:00:00\tops',
      })
      .expect(201);

    expect(replaceRes.body.count).toBe(1);
    expect(replaceRes.body.accounts).toHaveLength(1);
    expect(replaceRes.body.accounts[0].email).toBe('only@example.com');
  });

  it('imports text file uploads and exports selected accounts', async () => {
    const app = createApp();

    await request(app)
      .post('/api/accounts/import-file')
      .field('mode', 'append')
      .attach(
        'file',
        Buffer.from('one@example.com\tpass1\tclient-1\trefresh-1\nsecond@example.com\tpass2\tclient-2\trefresh-2'),
        'accounts.txt',
      )
      .expect(201);

    const accounts = getAccounts();
    expect(accounts).toHaveLength(2);

    const exportRes = await request(app)
      .get(`/api/accounts/export?ids=${accounts[0].id}`)
      .expect(200);

    expect(exportRes.text.trim()).toBe('one@example.com\tpass1\tclient-1\trefresh-1');
    expect(exportRes.headers['content-disposition']).toContain('.txt');
  });

  it('syncs accounts, stores messages and updates token fields', async () => {
    const fakeSyncInbox = async (account, options) => ({
      total: 1,
      tokenUpdate: {
        refresh_token: `${account.refresh_token}-updated`,
        expires_at: '2026-08-01T10:00:00.000Z',
      },
      messages: [
        {
          uid: 101,
          messageId: 'mid-101',
          fromName: 'Tester',
          fromAddress: 'sender@example.com',
          subject: `Hello ${options.limit}`,
          receivedAt: '2026-03-26T10:00:00.000Z',
          flags: ['\\Seen'],
        },
      ],
    });
    const app = createApp({ syncInboxImpl: fakeSyncInbox });

    const createRes = await request(app)
      .post('/api/accounts')
      .send(oauthPayload())
      .expect(201);

    const syncRes = await request(app)
      .post('/api/accounts/sync')
      .send({ ids: [createRes.body.id], limit: 5 })
      .expect(200);

    expect(syncRes.body.items).toEqual([
      expect.objectContaining({
        id: createRes.body.id,
        ok: true,
        synced: 1,
      }),
    ]);

    const account = getAccounts()[0];
    expect(account.status).toBe('success');
    expect(account.refresh_token).toBe('refresh-token-updated');
    expect(account.expires_at).toBe('2026-08-01T10:00:00.000Z');

    const messages = getMessagesForAccount(createRes.body.id, 10);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      subject: 'Hello 5',
      from_address: 'sender@example.com',
    });
  });

  it('returns sync errors without crashing the batch', async () => {
    const failingApp = createApp({
      syncInboxImpl: async () => {
        throw new Error('Authentication failed');
      },
    });

    const createRes = await request(failingApp)
      .post('/api/accounts')
      .send(oauthPayload({ email: 'fail@example.com' }))
      .expect(201);

    const syncRes = await request(failingApp)
      .post('/api/accounts/sync')
      .send({ ids: [createRes.body.id], limit: 2 })
      .expect(200);

    expect(syncRes.body.items[0]).toEqual(
      expect.objectContaining({
        email: 'fail@example.com',
        ok: false,
        error: 'Authentication failed',
      }),
    );
    expect(getAccounts()[0].status).toBe('error');
  });
});
