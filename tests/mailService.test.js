const { syncInbox, resolveAuth } = require('../src/mailService');

class FakeImapFlow {
  constructor(options) {
    this.options = options;
    this.usable = true;
    this.mailbox = { exists: 2 };
  }

  async connect() {}

  async getMailboxLock() {
    return {
      release() {},
    };
  }

  async mailboxOpen() {
    return this.mailbox;
  }

  async *fetch() {
    yield {
      uid: 101,
      envelope: {
        messageId: 'mid-101',
        subject: 'Older',
        from: [{ name: 'One', mailbox: 'one', host: 'example.com' }],
      },
      internalDate: '2026-03-25T10:00:00.000Z',
      flags: new Set(['\\Seen']),
    };

    yield {
      uid: 102,
      envelope: {
        messageId: 'mid-102',
        subject: 'Newer',
        from: [{ name: 'Two', mailbox: 'two', host: 'example.com' }],
      },
      internalDate: '2026-03-26T10:00:00.000Z',
      flags: new Set(),
    };
  }

  async logout() {}

  close() {}
}

describe('mailService', () => {
  it('builds password auth for non-oauth accounts', async () => {
    const auth = await resolveAuth({
      auth_type: 'password',
      username: 'user@example.com',
      password: 'secret',
    });

    expect(auth).toEqual({
      auth: {
        user: 'user@example.com',
        pass: 'secret',
      },
      tokenUpdate: null,
    });
  });

  it('builds oauth auth from refreshed token', async () => {
    const getToken = vi.fn().mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token-new',
      expiresAt: '2026-03-26T11:00:00.000Z',
    });

    const auth = await resolveAuth({
      auth_type: 'oauth',
      email: 'oauth@example.com',
      client_id: 'client-id',
      refresh_token: 'refresh-token-old',
    }, {
      getOutlookAccessToken: getToken,
    });

    expect(getToken).toHaveBeenCalled();
    expect(auth).toEqual({
      auth: {
        user: 'oauth@example.com',
        accessToken: 'access-token',
        method: 'XOAUTH2',
      },
      tokenUpdate: {
        refresh_token: 'refresh-token-new',
        expires_at: '2026-03-26T11:00:00.000Z',
      },
    });
  });

  it('syncs inbox messages and sorts them newest first', async () => {
    const result = await syncInbox({
      auth_type: 'password',
      email: 'user@example.com',
      username: 'user@example.com',
      password: 'secret',
      imap_host: 'outlook.office365.com',
      imap_port: 993,
      secure: 1,
    }, {
      limit: 2,
      mailbox: 'INBOX',
    }, {
      ImapFlowClass: FakeImapFlow,
    });

    expect(result.total).toBe(2);
    expect(result.messages[0]).toMatchObject({
      uid: 102,
      subject: 'Newer',
      fromAddress: 'two@example.com',
    });
    expect(result.messages[1]).toMatchObject({
      uid: 101,
      subject: 'Older',
      fromAddress: 'one@example.com',
    });
  });
});
