const { ImapFlow } = require('imapflow');
const { getOutlookAccessToken } = require('./oauth');
const { syncOutlookInbox } = require('./outlookApi');

async function syncInbox(account, options = {}, deps = {}) {
  if (account.auth_type === 'oauth' && String(account.provider || '').toLowerCase() === 'outlook') {
    return syncOutlookInbox(account, options, deps);
  }

  const limit = Number(options.limit || 20);
  const mailboxName = options.mailbox || 'INBOX';
  const { auth, tokenUpdate } = await resolveAuth(account, deps);
  const ImapFlowClass = deps.ImapFlowClass || ImapFlow;
  const client = new ImapFlowClass({
    host: account.imap_host,
    port: account.imap_port,
    secure: Boolean(account.secure),
    auth,
    logger: false,
  });

  const messages = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock(mailboxName);

    try {
      const mailbox = await client.mailboxOpen(mailboxName);
      if (!mailbox.exists) {
        return { total: 0, messages: [] };
      }

      const start = Math.max(1, mailbox.exists - limit + 1);
      const range = `${start}:${mailbox.exists}`;

      for await (const message of client.fetch(range, {
        uid: true,
        envelope: true,
        internalDate: true,
        flags: true,
      })) {
        const from = Array.isArray(message.envelope?.from) ? message.envelope.from[0] : null;
        messages.push({
          uid: message.uid,
          messageId: message.envelope?.messageId || null,
          fromName: from?.name || '',
          fromAddress: [from?.mailbox, from?.host].filter(Boolean).join('@'),
          subject: message.envelope?.subject || '(无主题)',
          receivedAt: message.internalDate ? new Date(message.internalDate).toISOString() : null,
          flags: message.flags ? Array.from(message.flags) : [],
        });
      }
    } finally {
      lock.release();
    }

    messages.sort((a, b) => {
      const left = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
      const right = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
      return right - left;
    });

    return { total: messages.length, messages, tokenUpdate };
  } finally {
    if (client.usable) {
      await client.logout();
    } else {
      try {
        client.close();
      } catch (error) {
        // Ignore close errors during cleanup so the original sync error is preserved.
      }
    }
  }
}

async function resolveAuth(account, deps = {}) {
  if (account.auth_type === 'oauth') {
    const getToken = deps.getOutlookAccessToken || getOutlookAccessToken;
    const token = await getToken(account);
    return {
      auth: {
        user: account.username || account.email,
        accessToken: token.accessToken,
        method: 'XOAUTH2',
      },
      tokenUpdate: {
        refresh_token: token.refreshToken,
        expires_at: token.expiresAt,
      },
    };
  }

  return {
    auth: {
      user: account.username || account.email,
      pass: account.password,
    },
    tokenUpdate: null,
  };
}

module.exports = {
  syncInbox,
  resolveAuth,
};
