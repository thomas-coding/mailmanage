const { getOutlookAccessToken } = require('../src/oauth');

describe('oauth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests a new access token from Microsoft', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-token',
        refresh_token: 'refresh-token-new',
        expires_in: 3600,
      }),
    });

    const result = await getOutlookAccessToken({
      client_id: 'client-id',
      refresh_token: 'refresh-token-old',
    });

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token-new');
    expect(result.expiresAt).toMatch(/T/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('login.microsoftonline.com/common/oauth2/v2.0/token');
  });

  it('surfaces oauth failures with provider error text', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({
        error_description: 'refresh token expired',
      }),
    });

    await expect(getOutlookAccessToken({
      client_id: 'client-id',
      refresh_token: 'bad-token',
    })).rejects.toThrow('refresh token expired');
  });
});
