import { DEMO_BRANDING } from '@/components/developer-credit';
import { demoOrderService } from './demo-orders';
import { liveOrderService } from './live-orders';

/** UI code imports services from here only. The local demo (NEXT_PUBLIC_DEMO_BRANDING=1) uses the mock API; otherwise the real API. */
export const orderService = DEMO_BRANDING ? demoOrderService : liveOrderService;
export { outletService } from './outlets';
export * from './types';
export * from './my-orders';
