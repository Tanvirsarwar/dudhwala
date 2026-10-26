import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { newId } from '../common/crypto.js';
import { Clock } from '../common/clock.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import type { Principal } from '../access/principal.js';
import type { Prisma } from '../generated/prisma/client.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  outletId?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
}

/** Writes append-only audit rows (USER_ROLES_AND_PERMISSIONS §5). Callers pass their transaction. */
@Injectable()
export class AuditService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async record(
    entry: AuditEntry,
    who: { principal?: Principal | null; actorRole?: string; userId?: string | null },
    req?: Request,
    tx: Tx = this.prisma,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        id: newId(),
        actorUserId: who.principal?.userId ?? who.userId ?? null,
        actorRole: who.principal ? principalRole(who.principal) : (who.actorRole ?? 'ANONYMOUS'),
        outletId: entry.outletId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: entry.before ?? undefined,
        after: entry.after ?? undefined,
        ip: req?.ip ?? null,
        userAgent: req?.header('user-agent')?.slice(0, 512) ?? null,
        requestId: req?.requestId ?? null,
        createdAt: this.clock.now(),
      },
    });
  }
}

export function principalRole(p: Principal): string {
  return p.kind === 'CUSTOMER' ? 'CUSTOMER' : p.staff.role;
}
