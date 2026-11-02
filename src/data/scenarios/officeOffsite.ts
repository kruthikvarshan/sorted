import { Scenario, scenarioKit } from './types';

const { id, rows } = scenarioKit('of');

/** Plain English at work: reversals, a corrected budget, hedges, deferred items and time zones. */
export const officeOffsite: Scenario = {
  id: 'office_offsite',
  title: 'Q4 Offsite Planning (English)',
  languages: ['English'],
  blurb: 'A team picks a city, then hits a visa problem, a budget correction and a deadline that depends on the time zone.',
  stresses: [
    'a vote that ends in a locked decision',
    'a budget stated as approved, then corrected',
    '"I\'ll try" (hedged) versus "On it" (accepted)',
    'a deliberately deferred item ("let\'s table that")',
    'a maybe-proposal that must stay a proposal',
  ],
  messages: rows([
    ['Dana', 'Offsite options: Lisbon Nov 12-14 or Austin Nov 19-21. Vote by Friday.'],
    ['Marcus', 'Lisbon. Flights from NYC are cheaper.'],
    ['Priya', 'Austin for me, Lisbon visa timing is tight'],
    ['Leo', 'Lisbon works'],
    ['Hannah', 'Lisbon +1'],
    ['Dana', 'Lisbon it is, Nov 12-14, locked.'],
    ['Marcus', "I'll try to get flight quotes by Monday"],
    ['Priya', "I can't do Lisbon, my visa won't clear. Can I join remotely?"],
    ['Dana', "Let's table the remote option until I check with HR"],
    ['Leo', 'Budget is $2,500 per person, approved by finance'],
    ['Hannah', 'Finance told me $2,000 cap, not $2,500. Leo, double check?'],
    ['Leo', "You're right, my bad. Finance email says $2,000."],
    ['Dana', 'Hannah, please book the venue by Wednesday EOD PT'],
    ['Hannah', 'On it'],
    ['Marcus', 'Is that EOD PT? that is 3 hours later than ET'],
    ['Dana', 'Wednesday 5pm ET then'],
    ['Leo', 'Team dinner at that Alfama place?'],
    ['Dana', 'Maybe, depends on budget'],
    ['Marcus', 'Flight quotes are around $620 avg from NYC'],
    ['Priya', 'nice pick on Lisbon lol'],
  ]),
  oracle: [
    { kind: 'decision', topic: 'Offsite location and dates', value: 'Lisbon, Nov 12-14', status: 'confirmed',
      evidence: [{ messageId: id(6), quote: 'Lisbon it is, Nov 12-14, locked' }] },
    { kind: 'decision', topic: 'Budget per person', value: '$2,500', status: 'confirmed',
      evidence: [{ messageId: id(10), quote: 'Budget is $2,500 per person, approved by finance' }] },
    { kind: 'decision', topic: 'Budget per person', value: '$2,000', status: 'confirmed',
      evidence: [{ messageId: id(11), quote: 'Finance told me $2,000 cap' }, { messageId: id(12), quote: 'Finance email says $2,000' }] },
    { kind: 'decision', topic: 'Remote attendance for Priya', value: 'Postponed until HR is consulted', status: 'unresolved',
      evidence: [{ messageId: id(9), quote: "Let's table the remote option until I check with HR" }] },
    // Marcus hedged ("I'll try") and then delivered the quotes himself, so the promise ends completed.
    { kind: 'commitment', ownerName: 'Marcus', description: 'Get flight quotes by Monday', status: 'completed', dueAt: 'Monday',
      evidence: [{ messageId: id(7), quote: "I'll try to get flight quotes by Monday" }, { messageId: id(19), quote: 'Flight quotes are around $620 avg from NYC' }] },
    { kind: 'commitment', ownerName: 'Hannah', description: 'Book the venue', status: 'accepted', dueAt: 'Wednesday 5pm ET',
      evidence: [{ messageId: id(13), quote: 'Hannah, please book the venue by Wednesday EOD PT' }, { messageId: id(14), quote: 'On it' }, { messageId: id(16), quote: 'Wednesday 5pm ET then' }] },
    { kind: 'commitment', ownerName: 'Dana', description: 'Check the remote option with HR', status: 'accepted',
      evidence: [{ messageId: id(9), quote: 'until I check with HR' }] },
    { kind: 'conflict', topic: "Priya's attendance", description: 'Priya cannot attend Lisbon because of a visa, after the location was locked',
      evidence: [{ messageId: id(8), quote: "I can't do Lisbon, my visa won't clear" }] },
  ],
  expect: [
    // Priya's visa puts the locked plan at risk, which marks it conflicted exactly as in the Goa demo.
    { id: 'of-city', kind: 'decision', any: ['lisbon'], status: ['confirmed', 'conflicted'], why: 'Dana locked Lisbon' },
    // Leo corrected his own figure after Hannah pointed it out: an explicit, agreed correction.
    { id: 'of-budget', kind: 'decision', any: ['2,000', '2000'], status: ['confirmed'], why: 'The corrected budget is $2,000' },
    { id: 'of-priya', kind: 'conflict', any: ['priya'], why: "Priya's visa clashes with the locked location" },
    { id: 'of-venue', kind: 'commitment', any: ['venue'], why: 'Hannah accepted the venue booking' },
    { id: 'of-flights', kind: 'commitment', any: ['flight'], status: ['proposed', 'completed'], why: 'A hedged promise that Marcus later fulfilled himself' },
    { id: 'of-remote', kind: 'decision', any: ['remote'], status: ['unresolved'], why: 'Explicitly tabled' },
  ],
  forbid: [
    { id: 'of-no-remote-confirmed', kind: 'decision', any: ['remote'], status: ['confirmed'], why: 'The remote option was deferred' },
    { id: 'of-no-dinner-confirmed', kind: 'decision', any: ['dinner'], status: ['confirmed'], why: 'Dinner was only a maybe' },
  ],
};
