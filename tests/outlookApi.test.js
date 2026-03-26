const { syncOutlookInbox } = require('../src/outlookApi');

describe('outlookApi', () => {
  it('fetches inbox messages from Outlook REST API', async () => {
    const getToken = vi.fn().mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token-new',
      expiresAt: '2026-03-26T11:00:00.000Z',
    });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        value: [
          {
            Id: 'msg-1',
            InternetMessageId: '<msg-1@example.com>',
            Subject: 'Subject 1',
            ReceivedDateTime: '2026-03-26T10:00:00.000Z',
            From: {
              EmailAddress: {
                Name: 'Sender',
                Address: 'sender@example.com',
              },
            },
          },
        ],
      }),
    });

    const result = await syncOutlookInbox({
      email: 'demo@example.com',
      client_id: 'client-id',
      refresh_token: 'refresh-token-old',
    }, {
      limit: 5,
    }, {
      getOutlookAccessToken: getToken,
      fetchImpl,
    });

    expect(getToken).toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('$top=5'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
        }),
      }),
    );
    expect(result).toEqual({
      total: 1,
      tokenUpdate: {
        refresh_token: 'refresh-token-new',
        expires_at: '2026-03-26T11:00:00.000Z',
      },
      messages: [
        {
          uid: 1,
          messageId: '<msg-1@example.com>',
          fromName: 'Sender',
          fromAddress: 'sender@example.com',
          subject: 'Subject 1',
          receivedAt: '2026-03-26T10:00:00.000Z',
          flags: [],
        },
      ],
    });
  });

  it('surfaces outlook api failures', async () => {
    await expect(syncOutlookInbox({
      email: 'demo@example.com',
    }, {}, {
      getOutlookAccessToken: async () => ({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: null,
      }),
      fetchImpl: async () => ({
        ok: false,
        json: async () => ({
          error: { message: 'Mailbox unavailable' },
        }),
      }),
    })).rejects.toThrow('Mailbox unavailable');
  });
});
