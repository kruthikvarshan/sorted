/**
 * The storyline of a realistic 4-month group chat ("Flat 402 & friends"), written as exact facts so every answer is
 * known. Muse Spark turns each chunk into WhatsApp messages; generate.ts interleaves them by time.
 * All people are fictional.
 */

export interface Person {
  name: string;
  style: string;
}

export const PEOPLE: Person[] = [
  { name: 'Neha', style: 'flatmate, collects the rent and pays the landlord; Telugu in English letters mixed with English; organised, uses "ok" and "pls"' },
  { name: 'Arjun', style: 'flatmate; Hindi in English letters mixed with English ("bhai", "kal", "pakka"); often late with money, books things impulsively' },
  { name: 'Dev', style: 'flatmate; plain English, short messages, emojis; handles the WiFi and practical fixes' },
  { name: 'Priya', style: 'flatmate; Telugu in English letters ("nenu", "ra", "kada"), works long hours, careful with money' },
  { name: 'Ravi', style: 'friend (not a flatmate); Telugu-English; organises Sunday cricket; jokes a lot' },
  { name: 'Sita', style: 'friend (not a flatmate); Hindi-English; getting married in December; collects money for gifts' },
];

export interface Chunk {
  /** True topic this chunk belongs to, used to score topic tagging. "chat" = no topic. */
  topic: string;
  title: string;
  from: string; // YYYY-MM-DD
  to: string;
  count: number;
  who: string[];
  beats: string[];
}

const FLAT = ['Neha', 'Arjun', 'Dev', 'Priya'];
const ALL = PEOPLE.map(p => p.name);

const rentMonth = (topic: string, month: string, from: string, to: string, beats: string[]): Chunk => ({
  topic, title: `Rent & bills, ${month}`, from, to, count: 110, who: FLAT,
  beats: [`Neha reminds everyone the ${month} rent is due; the flat pays 36,000 a month, so 9,000 each, sent to Neha who pays the landlord.`, ...beats],
});

export const CHUNKS: Chunk[] = [
  rentMonth('rent_aug', 'August', '2026-08-01', '2026-08-12', [
    'The electricity bill is 2,800; Neha paid it, so 700 each to Neha. Everyone agrees.',
    'Dev paid the WiFi bill of 1,200 and asks for 300 each.',
    'Dev and Priya say they sent the rent; Arjun says "kal pakka bhej dunga" and pays three days later.',
    'Neha confirms she received everyone\'s rent by the 10th.',
  ]),
  rentMonth('rent_sep', 'September', '2026-09-01', '2026-09-11', [
    'Electricity is 3,200 this month, paid by Neha, 800 each.',
    'Priya says she paid rent and electricity; Neha confirms she got it.',
    'Arjun asks to pay his September rent in two parts, 5,000 now and 4,000 on the 15th; Neha agrees.',
  ]),
  rentMonth('rent_oct', 'October', '2026-10-01', '2026-10-14', [
    'Electricity is 3,600, paid by Neha, 900 each.',
    'Arjun objects: he was away for 10 days, so he wants to pay only 600 for electricity. Dev says a split is a split. It is NOT settled in the chat: no agreement.',
    'Dev and Priya say they paid rent; Neha has not confirmed Dev\'s yet.',
  ]),
  rentMonth('rent_nov', 'November', '2026-11-01', '2026-11-09', [
    'The landlord raises rent to 38,000 from November, so 9,500 each. Everyone agrees, Priya last ("fine ra").',
    'Electricity is 2,400, paid by Neha, 600 each.',
    'Priya says she sent 9,500; Neha says she will check.',
  ]),

  { topic: 'goa', title: 'Goa trip, November', from: '2026-10-05', to: '2026-10-19', count: 150, who: ALL, beats: [
    'Ravi suggests a Goa trip in the second week of November; all six are in.',
    'Arjun finds a 40% sale and books a villa for Friday Nov 7 to Monday Nov 10 for 24,000, non-refundable, before everyone agreed; split six ways that is 4,000 each to Arjun.',
    'Priya says she cannot leave on Friday, she can only leave Saturday morning; she is upset the villa was booked without asking. This stays a real disagreement for days.',
  ]},
  { topic: 'goa', title: 'Goa trip, November', from: '2026-10-20', to: '2026-11-06', count: 150, who: ALL, beats: [
    'The group settles it: everyone else leaves Friday, Priya joins on Saturday by bus, paying her own bus ticket. Priya agrees.',
    'Ravi books train tickets Hyderabad to Goa for the five people leaving Friday, 1,250 each, to be paid to Ravi.',
    'Dev proposes a scuba diving trip at 6,500 each. Ravi says "no way, that is my whole budget"; Neha also says no. It is never agreed.',
    'Sita suggests renting scooters at 400 a day each; people like it but nobody books.',
    'Neha and Sita say they paid Arjun 4,000 for the villa; Arjun confirms Neha\'s payment only.',
  ]},
  { topic: 'goa', title: 'Goa trip, November', from: '2026-11-07', to: '2026-11-12', count: 110, who: ALL, beats: [
    'During the trip: photos, beach plans, a lost charger, Priya arrives Saturday.',
    'Dinner at a shack: Dev pays 4,800 for everyone and says split it six ways, 800 each to Dev.',
    'Back home: Arjun reminds Dev, Priya and Ravi they still owe 4,000 each for the villa.',
  ]},

  { topic: 'birthday', title: "Ravi's birthday gift", from: '2026-09-08', to: '2026-09-21', count: 120, who: ['Neha', 'Arjun', 'Dev', 'Priya', 'Sita'], beats: [
    'Sita starts a secret gift plan for Ravi\'s birthday on September 20 (Ravi is in the group, so they speak in hints and later Sita says "Ravi pls ignore").',
    'They choose JBL headphones costing 3,000; five people chip in, 600 each, to Sita.',
    'Dev says he paid Sita 600; Arjun promises to pay on Friday; Neha and Priya pay and Sita confirms them.',
    'Birthday dinner at Paradise on September 20 at 8 pm, everyone pays for themselves.',
  ]},

  { topic: 'fridge', title: 'Fridge repair', from: '2026-10-02', to: '2026-10-09', count: 90, who: FLAT, beats: [
    'The fridge stops cooling; Priya complains the milk went bad.',
    'Dev calls a mechanic; the repair costs 3,200, Dev pays, and it is split among the 4 flatmates, 800 each to Dev.',
    'Neha pays Dev back and Dev confirms; Arjun says he will pay after salary.',
  ]},

  { topic: 'cricket', title: 'Sunday cricket', from: '2026-08-14', to: '2026-09-28', count: 110, who: ALL, beats: [
    'Ravi organises Sunday turf cricket at 7 am; the turf costs 2,400, split six ways, 400 each to Ravi.',
    'Sita cannot come most Sundays but still plays once; banter about who drops catches.',
  ]},
  { topic: 'cricket', title: 'Sunday cricket', from: '2026-10-08', to: '2026-10-26', count: 90, who: ALL, beats: [
    'Ravi moves the start from 7 am to 6 am because of the heat; Arjun complains but agrees; it is agreed.',
    'Turf is still 2,400, 400 each to Ravi; Dev says he paid Ravi via UPI.',
  ]},

  { topic: 'wedding', title: "Sita's wedding, December", from: '2026-11-13', to: '2026-11-30', count: 170, who: ALL, beats: [
    'Sita invites everyone to her wedding in Vijayawada on December 12.',
    'They plan to drive in Dev\'s car, leaving December 11 at 6 am; fuel and tolls about 6,000 to be split among the five travellers.',
    'The five friends (everyone except Sita) agree on a group gift: 2,000 each, collected by Neha.',
    'Arjun is not sure he can get leave; he says he will confirm by November 25 and then confirms he is coming.',
    'Priya and Ravi pay Neha 2,000 for the gift; Neha confirms.',
  ]},

  ...[
    ['2026-08-01', '2026-08-31'],
    ['2026-09-01', '2026-09-30'],
    ['2026-10-01', '2026-10-31'],
    ['2026-11-01', '2026-11-30'],
  ].map(([from, to]): Chunk => ({
    topic: 'chat', title: 'Small talk', from, to, count: 140, who: ALL,
    beats: ['Everyday chatter with no plans or money: memes, cricket match reactions, food cravings, "who finished my Maggi", traffic, movie talk, good morning messages, inside jokes.'],
  })),
];

/** What the analysis must find. Matched against results by keywords (any) and status. */
export interface LongExpectation {
  id: string;
  topic: string;
  kind: 'decision' | 'commitment' | 'conflict';
  any: string[];
  status?: string[];
  why: string;
}

export const EXPECT: LongExpectation[] = [
  { id: 'rent-9000', topic: 'rent_aug', kind: 'decision', any: ['9000', '9,000'], why: 'August rent 9,000 each' },
  { id: 'elec-aug', topic: 'rent_aug', kind: 'decision', any: ['700', '2800', '2,800'], why: 'August electricity 700 each' },
  { id: 'wifi-aug', topic: 'rent_aug', kind: 'decision', any: ['300', '1200', '1,200'], why: 'WiFi 300 each to Dev' },
  { id: 'elec-sep', topic: 'rent_sep', kind: 'decision', any: ['800', '3200', '3,200'], why: 'September electricity 800 each' },
  { id: 'arjun-instalment', topic: 'rent_sep', kind: 'commitment', any: ['4000', '4,000', '15'], why: 'Arjun pays the rest on the 15th' },
  { id: 'elec-oct-dispute', topic: 'rent_oct', kind: 'conflict', any: ['electric', '600', 'away'], why: 'Arjun disputes his October electricity share' },
  { id: 'rent-9500', topic: 'rent_nov', kind: 'decision', any: ['9500', '9,500', '38000', '38,000'], status: ['confirmed'], why: 'Rent rises to 9,500 each' },
  { id: 'villa', topic: 'goa', kind: 'decision', any: ['villa', '24000', '24,000', '4000', '4,000'], why: 'Villa 24,000, 4,000 each' },
  { id: 'priya-saturday', topic: 'goa', kind: 'conflict', any: ['saturday', 'friday'], why: 'Priya can only leave Saturday' },
  { id: 'train', topic: 'goa', kind: 'decision', any: ['1250', '1,250', 'train'], why: 'Train tickets 1,250 each to Ravi' },
  { id: 'scuba-not-agreed', topic: 'goa', kind: 'decision', any: ['scuba'], status: ['proposed', 'rejected', 'conflicted', 'unresolved'], why: 'Scuba was never agreed' },
  { id: 'shack-dinner', topic: 'goa', kind: 'decision', any: ['800', '4800', '4,800', 'dinner'], why: 'Shack dinner 800 each to Dev' },
  { id: 'gift-600', topic: 'birthday', kind: 'decision', any: ['600', '3000', '3,000', 'jbl', 'headphone'], why: 'Gift 600 each to Sita' },
  { id: 'arjun-gift-friday', topic: 'birthday', kind: 'commitment', any: ['arjun', 'friday'], why: 'Arjun promises to pay on Friday' },
  { id: 'fridge-800', topic: 'fridge', kind: 'decision', any: ['800', '3200', '3,200'], why: 'Fridge repair 800 each to Dev' },
  { id: 'turf-400', topic: 'cricket', kind: 'decision', any: ['400', '2400', '2,400'], why: 'Turf 400 each to Ravi' },
  { id: 'six-am', topic: 'cricket', kind: 'decision', any: ['6 am', '6am', '6:00'], status: ['confirmed'], why: 'Cricket moved to 6 am' },
  { id: 'wedding-date', topic: 'wedding', kind: 'decision', any: ['december 12', 'dec 12', '12 dec', '12th'], why: 'Wedding on December 12' },
  { id: 'wedding-gift', topic: 'wedding', kind: 'decision', any: ['2000', '2,000'], why: 'Group gift 2,000 each to Neha' },
];
