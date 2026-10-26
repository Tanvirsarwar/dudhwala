import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { formatTaka, maskPhone } from '@dudhwala/shared';
import { Clock } from '../common/clock.js';
import { DataCipher, newId } from '../common/crypto.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { SmsSender } from '../auth/sms.js';
import { dhakaDate } from '../delivery/slots.js';

export const NOTIFY_JOB = 'notify.send';

type SmsEvent = 'PLACED' | 'CONFIRMED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'DELIVERY_FAILED' | 'REFUNDED';

/** Bangla SMS texts. Kept short: one SMS segment where possible (cost, SECURITY_REVIEW §7). */
const TEMPLATES: Record<SmsEvent, (o: { orderNumber: string; total: string; slot: string }) => string> = {
  PLACED: (o) => `দুধওয়ালা: অর্ডার ${o.orderNumber} গ্রহণ করা হয়েছে। মোট ${o.total}। ডেলিভারি: ${o.slot}।`,
  CONFIRMED: (o) => `দুধওয়ালা: অর্ডার ${o.orderNumber} নিশ্চিত করা হয়েছে।`,
  OUT_FOR_DELIVERY: (o) => `দুধওয়ালা: অর্ডার ${o.orderNumber} ডেলিভারির পথে।`,
  DELIVERED: (o) => `দুধওয়ালা: অর্ডার ${o.orderNumber} পৌঁছে দেওয়া হয়েছে। ধন্যবাদ!`,
  DELIVERY_FAILED: (o) => `দুধওয়ালা: অর্ডার ${o.orderNumber} ডেলিভারি করা যায়নি। আমরা শীঘ্রই যোগাযোগ করব।`,
  REFUNDED: (o) => `দুধওয়ালা: অর্ডার ${o.orderNumber}-এর রিফান্ড প্রক্রিয়া করা হয়েছে।`,
};

/**
 * Transactional outbox (TRD §5.8): the notification row and its send job are
 * written in the business transaction; sending happens later and can never
 * roll back or block an order. Recipient numbers are stored encrypted.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger('Notifications');
  private readonly cipher: DataCipher;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(SmsSender) private readonly sms: SmsSender,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.cipher = new DataCipher(env.DATA_ENCRYPTION_KEY, env.DATA_ENCRYPTION_KEY_ID);
  }

  onModuleInit(): void {
    this.jobs.register(NOTIFY_JOB, async (payload) => this.send((payload as { id: string }).id));
  }

  async orderEvent(tx: Tx, orderId: string, status: string): Promise<void> {
    const enabled = (await this.settings.get('sms.events', null, tx)) as readonly string[];
    if (!enabled.includes(status) || !(status in TEMPLATES)) return;
    const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const slot = `${dhakaDate(o.slotStartsAt)} ${o.slotStartsAt.toLocaleTimeString('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit' })}`;
    const text = TEMPLATES[status as SmsEvent]({ orderNumber: o.orderNumber, total: formatTaka(o.totalPoisha, 'bn'), slot });
    const id = newId();
    await tx.notificationRecord.create({
      data: { id, channel: 'SMS', template: `order.${status.toLowerCase()}`, toMasked: maskPhone(o.shipPhone), toEnc: this.cipher.encrypt(JSON.stringify({ to: o.shipPhone, text })), orderId },
    });
    await this.jobs.enqueue(NOTIFY_JOB, { id }, { tx });
  }

  /** Called by the job runner; throwing makes the runner retry with back-off. */
  async send(id: string): Promise<void> {
    const rec = await this.prisma.notificationRecord.findUnique({ where: { id } });
    if (!rec || rec.status !== 'QUEUED') return; // already sent or cancelled — idempotent
    const today = dhakaDate(this.clock.now());
    const sentToday = await this.prisma.notificationRecord.count({
      where: { channel: 'SMS', status: 'SENT', updatedAt: { gte: new Date(`${today}T00:00:00+06:00`) } },
    });
    if (sentToday >= this.env.SMS_DAILY_CAP) {
      await this.prisma.notificationRecord.update({ where: { id }, data: { status: 'FAILED', lastError: 'Daily SMS cap reached' } });
      this.logger.warn('Daily SMS cap reached; notification not sent');
      return;
    }
    const { to, text } = JSON.parse(this.cipher.decrypt(rec.toEnc)) as { to: string; text: string };
    try {
      const r = await this.sms.send(to, text);
      await this.prisma.notificationRecord.update({ where: { id }, data: { status: 'SENT', providerMessageId: r.providerMessageId, attempts: { increment: 1 }, updatedAt: this.clock.now() } });
    } catch (e) {
      await this.prisma.notificationRecord.update({ where: { id }, data: { attempts: { increment: 1 }, lastError: String(e).slice(0, 500) } });
      throw e;
    }
  }
}
