import { z } from 'zod';

/** 케이스 판정 (docs/product/execution.md, docs/product/results.md). `check` = 확인필요. */
export const Verdict = z.enum(['pass', 'fail', 'blocked', 'check', 'nt', 'na']);
export type Verdict = z.infer<typeof Verdict>;

export const VERDICT_LABEL: Record<Verdict, string> = {
  pass: 'Pass',
  fail: 'Fail',
  blocked: 'Blocked',
  check: '확인필요',
  nt: 'N/T',
  na: 'N/A',
};
