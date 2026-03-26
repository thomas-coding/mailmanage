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
const {
  db,
  getAccounts,
  getGroups,
  getMessagesForAccount,
} = require('../src/db');

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
  db.exec("DELETE FROM messages; DELETE FROM accounts; DELETE FROM groups WHERE name != 'default';");
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

  it('retries rate-limited sync and eventually succeeds', async () => {
    let attempts = 0;
    const sleepCalls = [];
    const app = createApp({
      syncPolicy: {
        maxRetries: 2,
        baseRetryDelayMs: 10,
        maxRetryDelayMs: 20,
        batchSize: 1,
        interBatchDelayMs: 0,
      },
      sleepImpl: async (ms) => {
        sleepCalls.push(ms);
      },
      syncInboxImpl: async () => {
        attempts += 1;
        if (attempts < 2) {
          throw new Error('AADSTS90055: The server has terminated the request due to excessive request rate.');
        }

        return {
          total: 1,
          tokenUpdate: null,
          messages: [
            {
              uid: 7,
              subject: 'Retried OK',
              fromName: 'Retry Sender',
              fromAddress: 'retry@example.com',
              receivedAt: '2026-03-26T10:00:00.000Z',
              flags: [],
            },
          ],
        };
      },
    });

    const createRes = await request(app)
      .post('/api/accounts')
      .send(oauthPayload({ email: 'retry@example.com' }))
      .expect(201);

    const syncRes = await request(app)
      .post('/api/accounts/sync')
      .send({ ids: [createRes.body.id], limit: 2 })
      .expect(200);

    expect(syncRes.body.items[0]).toEqual(
      expect.objectContaining({
        email: 'retry@example.com',
        ok: true,
        synced: 1,
        attempts: 2,
      }),
    );
    expect(sleepCalls).toEqual([10]);
    expect(getAccounts()[0].status).toBe('success');
  });

  it('paces batches between multiple accounts', async () => {
    const sleepCalls = [];
    const app = createApp({
      syncPolicy: {
        batchSize: 1,
        interBatchDelayMs: 25,
        maxRetries: 0,
      },
      sleepImpl: async (ms) => {
        sleepCalls.push(ms);
      },
      syncInboxImpl: async (account) => ({
        total: 1,
        tokenUpdate: null,
        messages: [
          {
            uid: account.email === 'first@example.com' ? 1 : 2,
            subject: account.email,
            fromName: 'Sender',
            fromAddress: 'sender@example.com',
            receivedAt: '2026-03-26T10:00:00.000Z',
            flags: [],
          },
        ],
      }),
    });

    const first = await request(app).post('/api/accounts').send(oauthPayload({ email: 'first@example.com' })).expect(201);
    const second = await request(app).post('/api/accounts').send(oauthPayload({ email: 'second@example.com' })).expect(201);

    const syncRes = await request(app)
      .post('/api/accounts/sync')
      .send({ ids: [first.body.id, second.body.id], limit: 2 })
      .expect(200);

    expect(syncRes.body.items.filter((item) => item.ok)).toHaveLength(2);
    expect(sleepCalls).toEqual([25]);
  });

  it('creates groups, assigns them in batch, and falls back to default on delete', async () => {
    const app = createApp();
    const first = await request(app).post('/api/accounts').send(oauthPayload({ email: 'group-first@example.com' })).expect(201);
    const second = await request(app).post('/api/accounts').send(oauthPayload({ email: 'group-second@example.com' })).expect(201);

    const createGroupRes = await request(app)
      .post('/api/groups')
      .send({ name: 'test', color: '#f2b04b' })
      .expect(201);

    expect(createGroupRes.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'default' }),
        expect.objectContaining({ name: 'test', display_name: 'test', color: '#f2b04b' }),
      ]),
    );

    const assignRes = await request(app)
      .put('/api/accounts/batch-group')
      .send({ ids: [first.body.id, second.body.id], group_name: 'test' })
      .expect(200);

    expect(assignRes.body.count).toBe(2);
    expect(assignRes.body.accounts.filter((item) => item.group_name === 'test')).toHaveLength(2);

    const deleteGroupRes = await request(app)
      .delete('/api/groups/test')
      .expect(200);

    expect(deleteGroupRes.body.items).toEqual([expect.objectContaining({ name: 'default' })]);
    expect(getAccounts().every((item) => item.group_name === 'default')).toBe(true);
    expect(getGroups()).toEqual([expect.objectContaining({ name: 'default' })]);
  });

  it('copies selected accounts in multiple batch formats', async () => {
    const app = createApp();
    const first = await request(app)
      .post('/api/accounts')
      .send(oauthPayload({ email: 'copy-first@example.com', password: 'copy-pass-1' }))
      .expect(201);
    const second = await request(app)
      .post('/api/accounts')
      .send(oauthPayload({ email: 'copy-second@example.com', password: 'copy-pass-2' }))
      .expect(201);

    const accountRes = await request(app)
      .post('/api/accounts/copy')
      .send({ ids: [first.body.id, second.body.id], format: 'account' })
      .expect(200);
    expect(accountRes.body.text).toBe('copy-first@example.com\ncopy-second@example.com');

    const passwordRes = await request(app)
      .post('/api/accounts/copy')
      .send({ ids: [first.body.id, second.body.id], format: 'password' })
      .expect(200);
    expect(passwordRes.body.text).toBe('copy-pass-1\ncopy-pass-2');

    const pairRes = await request(app)
      .post('/api/accounts/copy')
      .send({ ids: [first.body.id, second.body.id], format: 'account-password' })
      .expect(200);
    expect(pairRes.body.text).toBe(
      'copy-first@example.com----copy-pass-1\ncopy-second@example.com----copy-pass-2',
    );
  });

  it('batch deletes selected accounts', async () => {
    const app = createApp();
    const first = await request(app).post('/api/accounts').send(oauthPayload({ email: 'delete-first@example.com' })).expect(201);
    const second = await request(app).post('/api/accounts').send(oauthPayload({ email: 'delete-second@example.com' })).expect(201);
    await request(app).post('/api/accounts').send(oauthPayload({ email: 'delete-third@example.com' })).expect(201);

    const deleteRes = await request(app)
      .post('/api/accounts/batch-delete')
      .send({ ids: [first.body.id, second.body.id] })
      .expect(200);

    expect(deleteRes.body.count).toBe(2);
    expect(deleteRes.body.accounts).toHaveLength(1);
    expect(deleteRes.body.accounts[0].email).toBe('delete-third@example.com');
  });
});
