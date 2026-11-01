import type { RewriteCheck } from './types.ts';

/** A rewrite Jev did not judge faithful: kept as a variant, but not selected automatically. */
export const isFlagged = (check?: RewriteCheck) => !!check && check.verdict !== 'faithful';

/** Judged faithful, but without much confidence: selected, with a note to look it over. */
export const isUncertain = (check?: RewriteCheck) => !!check && check.verdict === 'faithful' && check.confidence < 0.6;

export const VERDICT_LABELS: Record<RewriteCheck['verdict'], string> = {
	faithful: 'faithful to the original',
	unsupported_claim: 'adds a claim the original does not make',
	changed_number: 'changes a number',
	changed_meaning: 'changes the meaning'
};
