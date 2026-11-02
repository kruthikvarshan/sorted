import { IntelligenceRun } from '../types/groupOs';
import { ProposalResult, summarizeProposal } from './eventReducer';

/** Counts and the list of what changed, for the run card. Shared by live runs and replayed recordings. */
export function summarizeResults(results: ProposalResult[]): Pick<
  IntelligenceRun,
  'created' | 'updated' | 'reinforced' | 'unchanged' | 'conflictsRaised' | 'changes'
> {
  const count = (outcome: string) => results.filter(r => r.outcome === outcome).length;
  return {
    created: count('created'),
    updated: count('updated'),
    reinforced: count('reinforced'),
    unchanged: count('unchanged'),
    conflictsRaised: count('conflict_raised'),
    changes: results
      .filter(r => r.accepted && r.outcome && r.outcome !== 'unchanged')
      .map(r => ({ label: summarizeProposal(r.proposal), outcome: r.outcome as IntelligenceRun['changes'][number]['outcome'] })),
  };
}
