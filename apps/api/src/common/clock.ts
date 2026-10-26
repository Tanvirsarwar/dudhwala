/** Injectable clock so tests control time (QA_TEST_PLAN §1). */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
