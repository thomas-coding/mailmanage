async function getOutlookAccessToken(account) {
  if (!account.client_id || !account.refresh_token) {
    throw new Error('当前账号缺少 Client ID 或刷新令牌');
  }

  const body = new URLSearchParams({
    client_id: account.client_id,
    grant_type: 'refresh_token',
    refresh_token: account.refresh_token,
    scope: 'https://outlook.office.com/IMAP.AccessAsUser.All offline_access',
  });

  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || '刷新 access token 失败');
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || account.refresh_token,
    expiresAt: payload.expires_in
      ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
      : null,
  };
}

module.exports = {
  getOutlookAccessToken,
};
