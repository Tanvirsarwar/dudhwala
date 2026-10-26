import type { Request } from 'express';
import type { VerifiedTransaction } from '@dudhwala/shared';

/**
 * Payment gateway port (TRD §5.6). A real Bangladeshi gateway adapter
 * implements this once one is chosen and the merchant account is approved
 * (OPEN_DECISIONS E1). Implemented: the simulator (dev/staging) and an
 * SSLCOMMERZ adapter (sandbox or live, selected by env).
 */
export interface InitiateInput {
  merchantTranId: string;
  amountPoisha: number;
  orderNumber: string;
  customerPhone: string;
  /** Where the customer's browser returns (storefront). Never trusted for status. */
  returnUrl: string;
  /** Server-to-server notification URL (API). */
  ipnUrl: string;
}

export interface CallbackClaim {
  /** Unique id of this notification at the provider — used to de-duplicate replays. */
  providerEventId: string;
  merchantTranId: string;
  signatureValid: boolean;
  payload: Record<string, unknown>;
}

export interface RefundResult {
  providerRefundId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'SUBMITTED';
}

export abstract class PaymentGateway {
  abstract readonly code: string;
  abstract initiate(input: InitiateInput): Promise<{ redirectUrl: string; providerSessionId: string }>;
  /** Server-to-server status query. The ONLY source of truth for "paid". */
  abstract verify(merchantTranId: string): Promise<VerifiedTransaction | null>;
  /** Parses and authenticates a callback/IPN. A claim only says which transaction to verify. */
  abstract parseCallback(req: Request): Promise<CallbackClaim>;
  abstract refund(input: { merchantTranId: string; providerTranId: string; amountPoisha: number; reason: string }): Promise<RefundResult>;
  /** Status of a refund the gateway accepted asynchronously (SUBMITTED). Gateways with instant refunds need not override. */
  async refundStatus(providerRefundId: string): Promise<'SUCCEEDED' | 'SUBMITTED' | 'FAILED'> {
    void providerRefundId;
    return 'SUBMITTED';
  }
}
