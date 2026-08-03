import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';

import { AlertService, EAlertSeverity } from '@/common/alerts/alert.service';

function build(webhookUrl = '', telegramChatId = '') {
  const config = {
    get: (key: string) =>
      ({
        ALERT_WEBHOOK_URL: webhookUrl,
        ALERT_TELEGRAM_CHAT_ID: telegramChatId,
        APP_NAME: 'wdk-backend',
      })[key],
  } as unknown as ConfigService;
  const http = {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    post: jest.fn((_url: string, _body: unknown, _options?: unknown) =>
      of({ data: {} }),
    ),
  };
  const service = new AlertService(config as never, http as never);
  const logged: string[] = [];
  jest
    .spyOn(service['logger'], 'error')
    .mockImplementation((msg) => logged.push(String(msg)));
  jest
    .spyOn(service['logger'], 'warn')
    .mockImplementation((msg) => logged.push(String(msg)));
  return { service, http, logged };
}

describe('AlertService', () => {
  it('always names its subject — no bare "something failed"', async () => {
    const { service, logged } = build();

    await service.raise({
      code: 'settlement.unknown_payment_ref',
      severity: EAlertSeverity.CRITICAL,
      subject: '0xdeadbeef',
      message: 'Claimed event for an unknown paymentRef',
      context: { txHash: '0xtx' },
    });

    expect(logged[0]).toContain(
      'security_event=settlement.unknown_payment_ref',
    );
    expect(logged[0]).toContain('subject=0xdeadbeef');
    expect(logged[0]).toContain('"0xtx"');
  });

  it('delivers to the webhook when one is configured', async () => {
    const { service, http } = build('https://pager.example/hook');

    await service.raise({
      code: 'monitor.supply_divergence',
      severity: EAlertSeverity.CRITICAL,
      subject: 'utl:0xabc',
      message: 'divergence',
    });

    expect(http.post).toHaveBeenCalledWith(
      'https://pager.example/hook',
      expect.objectContaining({ source: 'wdk-backend', subject: 'utl:0xabc' }),
      expect.anything(),
    );
  });

  it('rewrites the payload into Bot API shape for a Telegram webhook', async () => {
    const { service, http } = build(
      'https://api.telegram.org/bot123:ABC/sendMessage',
      '-1001234567890',
    );

    await service.raise({
      code: 'monitor.supply_divergence',
      severity: EAlertSeverity.CRITICAL,
      subject: 'utl:0xabc',
      message: 'minted > attested',
      context: { diff: '5' },
    });

    const body = http.post.mock.calls[0][1] as Record<string, string>;
    expect(body.chat_id).toBe('-1001234567890');
    expect(body.parse_mode).toBe('HTML');
    expect(body.text).toContain('monitor.supply_divergence');
    expect(body.text).toContain('utl:0xabc');
    expect(body.text).toContain('minted &gt; attested');
    expect(body).not.toHaveProperty('severity');
  });

  it('keeps the raw shape for a non-Telegram webhook', async () => {
    const { service, http } = build('https://pager.example/hook', '-100');

    await service.raise({
      code: 'monitor.paused',
      severity: EAlertSeverity.CRITICAL,
      subject: 'utl:0xabc',
      message: 'paused',
    });

    expect(http.post.mock.calls[0][1]).toHaveProperty('severity', 'critical');
  });

  it('survives a pager that is down — the log line is the durable copy', async () => {
    const { service, http, logged } = build('https://pager.example/hook');
    http.post.mockReturnValue(throwError(() => new Error('pager down')));

    await expect(
      service.raise({
        code: 'monitor.paused',
        severity: EAlertSeverity.CRITICAL,
        subject: 'utl:0xabc',
        message: 'paused',
      }),
    ).resolves.toBeUndefined();

    expect(logged.join()).toContain('security_event=monitor.paused');
    expect(logged.join()).toContain('Alert delivery failed');
  });
});
