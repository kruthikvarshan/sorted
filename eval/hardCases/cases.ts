/**
 * Hard money cases: short real-looking chats, each built around one trap that broke Sorted before or could. Each has
 * the exact balances a careful person would write down. Run with eval/hardCases/run.ts against the real Meta pipeline.
 */
export interface HardCase {
  id: string;
  trap: string;
  people: string[];
  chat: [string, string][];
  /** [who owes, to whom, amount] after everything in the chat; empty means everyone is settled. */
  expect: [string, string, number][];
  currency?: string;
}

export const CASES: HardCase[] = [
  {
    id: 'equal-split',
    trap: 'A plain split, the payer collects',
    people: ['Kruthik', 'Aniket', 'Swapnil'],
    chat: [['Kruthik', 'dinner ka bill 2400 aaya, maine pay kar diya'], ['Kruthik', '800 each bhej do'], ['Aniket', 'ok'], ['Swapnil', 'done kal bhejta hu']],
    expect: [['Aniket', 'Kruthik', 800], ['Swapnil', 'Kruthik', 800]],
  },
  {
    id: 'two-in-one-transfer',
    trap: 'One transfer pays two bills ("18000 rent + 1000 light")',
    people: ['Kruthik', 'Aniket', 'Swapnil'],
    chat: [
      ['Kruthik', 'rent 54000 owner ko bhej diya, 18000 each mujhe'],
      ['Kruthik', 'light bill 3000 bhi maine bhara, 1000 each'],
      ['Aniket', '18000 rent + 1000 light = 19000 bhej diya'],
      ['Kruthik', 'haan aa gaya 19000'],
    ],
    expect: [['Swapnil', 'Kruthik', 19000]],
  },
  {
    id: 'part-payments',
    trap: 'Paid in two halves on different days',
    people: ['Kruthik', 'Aniket'],
    chat: [
      ['Kruthik', 'Aniket tera rent share 18000 pending hai'],
      ['Aniket', 'bhai 9k bhej diya abhi, baki kal'],
      ['Kruthik', 'haan 9k aaya'],
      ['Aniket', 'baki 9k bhi bhej diya'],
      ['Kruthik', 'mil gaya, 18k done'],
    ],
    expect: [],
  },
  {
    id: 'remaining-later',
    trap: 'Half paid, "the rest after my bonus" is not a second debt',
    people: ['Kruthik', 'Aniket', 'Swapnil'],
    chat: [
      ['Kruthik', 'AC 36000 ka liya, 12000 each mujhe dena'],
      ['Swapnil', '12000 bhej diya'],
      ['Kruthik', 'aa gaya Swapnil'],
      ['Aniket', '6000 bhej diya abhi, baki 6000 bonus ke baad pakka'],
      ['Kruthik', 'haan 6k mila'],
    ],
    expect: [['Aniket', 'Kruthik', 6000]],
  },
  {
    id: 'loan-repaid-partly',
    trap: 'A loan, then a part repayment',
    people: ['Kruthik', 'Aniket', 'Swapnil'],
    chat: [
      ['Swapnil', 'bike repair 15000 ka hai, koi help karo'],
      ['Aniket', 'chal mai deta hu, 15000 bhej diya'],
      ['Swapnil', 'mil gaya, thanks bhai, wapas dunga pakka'],
      ['Swapnil', '10,000 bheja Aniket ko'],
      ['Aniket', 'haan aagaya 10000'],
      ['Swapnil', 'abhi 5000 baki hai, next month'],
    ],
    expect: [['Swapnil', 'Aniket', 5000]],
  },
  {
    id: 'recap-not-new',
    trap: 'A later "settling up" recap repeats the bill',
    people: ['Arjun', 'Rohan', 'Neha'],
    chat: [
      ['Arjun', 'villa booked, 18600 total, 6200 each to me'],
      ['Neha', 'sent 6200 Arjun'],
      ['Arjun', 'got it Neha'],
      ['Arjun', 'settling up: villa 6200 each to me, Neha done, Rohan pending'],
      ['Rohan', 'will pay next week'],
    ],
    expect: [['Rohan', 'Arjun', 6200]],
  },
  {
    id: 'outsider-payee',
    trap: 'Paying the owner is not a debt inside the group',
    people: ['Kruthik', 'Aniket', 'Swapnil'],
    chat: [['Kruthik', 'owner ko 54000 bhej diya rent ka'], ['Kruthik', 'tum dono 18000 each mujhe bhej do'], ['Aniket', 'ok bhai'], ['Swapnil', 'kal pakka']],
    expect: [['Aniket', 'Kruthik', 18000], ['Swapnil', 'Kruthik', 18000]],
  },
  {
    id: 'name-not-a-member',
    trap: 'A cricketer named in passing is not part of the bet',
    people: ['Kruthik', 'Aniket', 'Swapnil'],
    chat: [
      ['Kruthik', 'Rohit form me hai aaj, MI jeetega'],
      ['Aniket', '200 ki shart, CSK jeetega'],
      ['Swapnil', 'mai bhi MI, 200'],
      ['Kruthik', 'MI jeet gaya 😂 Aniket 200 mujhe aur 200 Swapnil ko'],
      ['Aniket', 'haan haan de dunga'],
    ],
    expect: [['Aniket', 'Kruthik', 200], ['Aniket', 'Swapnil', 200]],
  },
  {
    id: 'each-pays-own',
    trap: '"Apna apna" is no shared bill',
    people: ['Kruthik', 'Aniket'],
    chat: [['Kruthik', 'cult.fit 6 months 9000 each hai'], ['Kruthik', 'apna apna pay karo, hisab me confusion nahi'], ['Aniket', 'done, 9000 paid'], ['Kruthik', 'maine bhi kar diya']],
    expect: [],
  },
  {
    id: 'disputed-split',
    trap: 'A split one person disputes is not counted until settled',
    people: ['Neha', 'Arjun', 'Dev', 'Priya'],
    chat: [
      ['Neha', 'electricity 3600 this month, I paid, 900 each'],
      ['Arjun', 'I was away 10 days, I will pay only 600'],
      ['Dev', 'a split is a split Arjun'],
      ['Arjun', 'no way, 600 max'],
    ],
    expect: [],
  },
  {
    id: 'claim-not-confirmed',
    trap: '"I paid" without the receiver confirming is still owed',
    people: ['Kruthik', 'Aniket'],
    chat: [['Kruthik', 'movie tickets 1600, I paid, 800 each'], ['Aniket', 'paid you 800']],
    expect: [['Aniket', 'Kruthik', 800]],
  },
  {
    id: 'claim-confirmed',
    trap: 'The receiver confirms: settled',
    people: ['Kruthik', 'Aniket'],
    chat: [['Kruthik', 'movie tickets 1600, I paid, 800 each'], ['Aniket', 'paid you 800'], ['Kruthik', 'got it, thanks']],
    expect: [],
  },
  {
    id: 'running-total',
    trap: 'A running tally of bets: the latest total counts',
    people: ['Kruthik', 'Aniket', 'Swapnil'],
    chat: [
      ['Kruthik', '200 per match, loser pays winner'],
      ['Aniket', 'gaya 200 😂'],
      ['Swapnil', 'Aniket ka 400 ho gaya mujhe'],
      ['Aniket', 'phir gaya 200'],
      ['Swapnil', 'ab 600 ho gaya Aniket, bhej de'],
      ['Aniket', 'haan haan kal pakka'],
    ],
    expect: [['Aniket', 'Swapnil', 600]],
  },
  {
    id: 'telugu-english',
    trap: 'Telugu in English letters: "nenu kattanu", "pampanu", "vachindi"',
    people: ['Kiran', 'Ravi', 'Sita'],
    chat: [
      ['Kiran', 'dinner bill 3000, nenu kattanu, 1000 each pampandi'],
      ['Ravi', '1000 pampanu Kiran'],
      ['Kiran', 'vachindi Ravi'],
      ['Sita', 'repu pampistanu'],
    ],
    expect: [['Sita', 'Kiran', 1000]],
  },
  {
    id: 'amount-changed',
    trap: 'The amount changes and everyone agrees',
    people: ['Kruthik', 'Aniket', 'Swapnil'],
    chat: [
      ['Kruthik', 'cab 1200, 400 each, I paid'],
      ['Kruthik', 'sorry total 1500 tha, toll bhi, 500 each ok?'],
      ['Aniket', 'ok 500'],
      ['Swapnil', 'theek hai 500'],
    ],
    expect: [['Aniket', 'Kruthik', 500], ['Swapnil', 'Kruthik', 500]],
  },
  {
    id: 'surname-in-payment',
    trap: '"Priya" in the bill, "Priya Sharma" in the payment: one person',
    people: ['Neha', 'Priya Sharma'],
    chat: [['Neha', 'groceries 1000, I paid, Priya 500 to me'], ['Priya Sharma', 'sent 500 Neha'], ['Neha', 'received Priya']],
    expect: [],
  },
  {
    id: 'two-bills-netted',
    trap: 'Each paid one bill: only the difference is owed',
    people: ['Kruthik', 'Aniket'],
    chat: [['Kruthik', 'dinner 1200, I paid, split 2'], ['Aniket', 'movie 800 maine diya, split 2'], ['Kruthik', 'ok so tu mujhe 600, mai tujhe 400']],
    expect: [['Aniket', 'Kruthik', 200]],
  },
  {
    id: 'dollars',
    trap: 'A trip abroad in dollars stays in dollars',
    people: ['Kruthik', 'Aniket', 'Swapnil'],
    chat: [['Kruthik', 'dinner in Bangkok $60, I paid, $20 each'], ['Aniket', 'ok'], ['Swapnil', 'will pay in INR later? no, $20 kal']],
    expect: [['Aniket', 'Kruthik', 20], ['Swapnil', 'Kruthik', 20]],
    currency: 'USD',
  },
  {
    id: 'cancelled-plan',
    trap: 'A plan that was called off owes nothing',
    people: ['Kruthik', 'Aniket', 'Swapnil'],
    chat: [['Kruthik', 'saturday dinner, 600 each, I will book'], ['Aniket', 'ok'], ['Kruthik', 'plan cancel ho gaya bhai, restaurant band hai'], ['Swapnil', 'koi na next week']],
    expect: [],
  },
  {
    id: 'same-promise-twice',
    trap: 'The same debt said again later is still one debt',
    people: ['Kruthik', 'Aniket', 'Swapnil'],
    chat: [
      ['Aniket', 'Swapnil ko 3000 diye the uske phone ke liye'],
      ['Swapnil', 'haan mila, wapas dunga 3000'],
      ['Kruthik', 'yaad rakhna Swapnil, Aniket ka 3000 tere pe hai'],
      ['Swapnil', 'haan haan 3000 dunga Aniket ko'],
    ],
    expect: [['Swapnil', 'Aniket', 3000]],
  },
];
