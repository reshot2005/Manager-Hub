/**
 * Pluggable alert delivery — always persist to `alerts` first (caller does that).
 * Channels are optional and fail soft.
 *
 * Env:
 *   ALERT_SLACK_WEBHOOK_URL — Slack incoming webhook
 *   ALERT_EMAIL_WEBHOOK_URL — generic POST endpoint that accepts JSON email payload
 */

export async function notifyAlert(alert) {
  const jobs = [];
  const slack = process.env.ALERT_SLACK_WEBHOOK_URL;
  if (slack) {
    jobs.push(
      fetch(slack, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `[${alert.severity}] ${alert.alert_type}: ${alert.message}`,
        }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(`Slack ${r.status}`);
      })
    );
  }

  const emailHook = process.env.ALERT_EMAIL_WEBHOOK_URL;
  if (emailHook) {
    jobs.push(
      fetch(emailHook, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.ALERT_EMAIL_WEBHOOK_TOKEN
            ? { Authorization: `Bearer ${process.env.ALERT_EMAIL_WEBHOOK_TOKEN}` }
            : {}),
        },
        body: JSON.stringify({
          subject: `[Hub AI] ${alert.severity}: ${alert.alert_type}`,
          body: alert.message,
          alert,
        }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(`Email webhook ${r.status}`);
      })
    );
  }

  if (!jobs.length) return { delivered: false, reason: 'no_channel_configured' };
  await Promise.allSettled(jobs);
  return { delivered: true };
}
