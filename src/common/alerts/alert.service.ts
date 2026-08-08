import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

import type { Env } from '@/config/env';

export enum EAlertSeverity {
  CRITICAL = 'critical',
  ERROR = 'error',
  WARNING = 'warning',
  // Not a problem — a lifecycle fact. A channel that only ever carries bad news
  // is indistinguishable from a broken channel until the day you need it.
  INFO = 'info',
}

export interface IAlert {
  code: string;
  severity: EAlertSeverity;
  subject: string;
  message: string;
  context?: Record<string, unknown>;
}

const SEVERITY_ICON: Record<EAlertSeverity, string> = {
  [EAlertSeverity.CRITICAL]: '🚨',
  [EAlertSeverity.ERROR]: '❗',
  [EAlertSeverity.WARNING]: '⚠️',
  [EAlertSeverity.INFO]: 'ℹ️',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private readonly webhookUrl: string;
  private readonly source: string;
  private readonly telegramChatId: string;

  constructor(
    configService: ConfigService<Env, true>,
    @Optional() private readonly http?: HttpService,
  ) {
    this.webhookUrl = configService.get('ALERT_WEBHOOK_URL');
    this.source = configService.get('APP_NAME');
    this.telegramChatId = configService.get('ALERT_TELEGRAM_CHAT_ID');

    if (this.webhookUrl.includes('api.telegram.org') && !this.telegramChatId) {
      this.logger.warn(
        'ALERT_WEBHOOK_URL points at Telegram but ALERT_TELEGRAM_CHAT_ID is empty — ' +
          'every alert will be rejected by the Bot API',
      );
    }
  }

  async raise(alert: IAlert): Promise<void> {
    const line =
      `security_event=${alert.code} severity=${alert.severity} ` +
      `subject=${alert.subject} message="${alert.message}"` +
      (alert.context ? ` context=${JSON.stringify(alert.context)}` : '');

    if (alert.severity === EAlertSeverity.INFO) this.logger.log(line);
    else if (alert.severity === EAlertSeverity.WARNING) this.logger.warn(line);
    else this.logger.error(line);

    if (!this.webhookUrl || !this.http) return;
    try {
      await firstValueFrom(
        this.http.post(this.webhookUrl, this.payload(alert), {
          timeout: 5_000,
        }),
      );
    } catch (err) {
      this.logger.error(
        `Alert delivery failed for ${alert.code}: ${String(err)}`,
      );
    }
  }

  private payload(alert: IAlert): Record<string, unknown> {
    if (!this.isTelegram()) return { source: this.source, ...alert };
    return {
      chat_id: this.telegramChatId,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      text: this.telegramText(alert),
    };
  }

  private isTelegram(): boolean {
    return (
      this.webhookUrl.includes('api.telegram.org') && !!this.telegramChatId
    );
  }

  private telegramText(alert: IAlert): string {
    const lines = [
      `${SEVERITY_ICON[alert.severity]} <b>${escapeHtml(alert.code)}</b>`,
      `<i>${escapeHtml(this.source)}</i> · ${alert.severity}`,
      `subject: <code>${escapeHtml(alert.subject)}</code>`,
      escapeHtml(alert.message),
    ];
    if (alert.context) {
      lines.push(
        `<pre>${escapeHtml(JSON.stringify(alert.context, null, 2))}</pre>`,
      );
    }
    return lines.join('\n').slice(0, 4000);
  }
}
