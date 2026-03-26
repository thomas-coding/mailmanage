const { getOutlookAccessToken } = require('./oauth');

async function syncOutlookInbox(account, options = {}, deps = {}) {
  const limit = Number(options.limit || 20);
  const getToken = deps.getOutlookAccessToken || getOutlookAccessToken;
  const fetchImpl = deps.fetchImpl || fetch;

  const token = await getToken(account);
  const url = `https://outlook.office.com/api/v2.0/me/mailfolders/inbox/messages?$top=${limit}&$select=Id,Subject,ReceivedDateTime,From,InternetMessageId`;

  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      Accept: 'application/json',
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || 'Outlook 邮件接口请求失败';
    throw new Error(message);
  }

  const messages = Array.isArray(payload.value)
    ? payload.value.map((item, index) => ({
      uid: index + 1,
      messageId: item.InternetMessageId || item.Id || null,
      fromName: item.From?.EmailAddress?.Name || '',
      fromAddress: item.From?.EmailAddress?.Address || '',
      subject: item.Subject || '(无主题)',
      receivedAt: item.ReceivedDateTime || null,
      flags: [],
    }))
    : [];

  return {
    total: messages.length,
    messages,
    tokenUpdate: {
      refresh_token: token.refreshToken,
      expires_at: token.expiresAt,
    },
  };
}

module.exports = {
  syncOutlookInbox,
};
