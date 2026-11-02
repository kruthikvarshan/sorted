import { Chunk, Person } from './story';

/**
 * Five more real-size groups for the demo phone. Neha is in every one of them (flat, trip, family, office, college,
 * housing society), so her private Group OS has real money and plans to follow across groups. All fictional.
 */

export interface GroupStory {
  id: string;
  title: string;
  people: Person[];
  chunks: Chunk[];
  /** How this group writes, when not the usual Hyderabad Telugu-Hindi-English mix. */
  voice?: string;
}

const chat = (who: string[], months: [string, string][], count: number, flavour: string): Chunk[] =>
  months.map(([from, to]) => ({ topic: 'chat', title: 'Small talk', from, to, count, who, beats: [`Everyday chatter with no plans or money: ${flavour}`] }));

const M = (y: number, m: number) => {
  const mm = String(m).padStart(2, '0');
  const last = new Date(y, m, 0).getDate();
  return [`${y}-${mm}-01`, `${y}-${mm}-${last}`] as [string, string];
};
const months = (from: [number, number], n: number) => Array.from({ length: n }, (_, i) => M(from[0] + Math.floor((from[1] - 1 + i) / 12), ((from[1] - 1 + i) % 12) + 1));

/* ---------------- Goa trip (about 1,500) ---------------- */
const goaPeople: Person[] = [
  { name: 'Neha', style: 'organised, Telugu-English, keeps track of money' },
  { name: 'Arjun', style: 'Hindi-English, impulsive booker' },
  { name: 'Kavya', style: 'English, budget conscious, vegetarian' },
  { name: 'Rohan', style: 'Hindi-English, jokes a lot, always late to pay' },
  { name: 'Meera', style: 'Tamil-English mix, plans activities' },
  { name: 'Sid', style: 'short English replies, drives' },
];
const goa = goaPeople.map(p => p.name);
const goaTrip: GroupStory = {
  id: 'goa2026', title: 'Goa Trip 2026 🏖️', people: goaPeople,
  chunks: [
    { topic: 'dates', title: 'Trip dates', from: '2026-08-20', to: '2026-09-05', count: 140, who: goa, beats: ['Long back-and-forth on dates; Kavya can only do the long weekend Oct 2-5; Rohan wants Diwali; they finally agree Oct 2 to Oct 5, everyone confirms.'] },
    { topic: 'stay', title: 'Villa booking', from: '2026-09-06', to: '2026-09-20', count: 160, who: goa, beats: ['Comparing villas in Anjuna; Meera shortlists three.', 'Arjun books Casa Azul for 36,000 for 3 nights, 6,000 each to Arjun.', 'Kavya says it is above her budget of 5,000; the group agrees Kavya pays 5,000 and the others cover the rest equally (6,200 each for the other five).'] },
    { topic: 'travel', title: 'Travel to Goa', from: '2026-09-10', to: '2026-09-28', count: 150, who: goa, beats: ['Flight vs train debate; Sid offers to drive his car with 3 people.', 'Decided: Neha, Kavya, Meera fly (IndiGo, 4,800 each, Neha books and the other two pay her); Arjun, Rohan, Sid drive.', 'Fuel and tolls about 6,000 split among the three drivers, paid to Sid.'] },
    { topic: 'activities', title: 'Activities plan', from: '2026-09-15', to: '2026-10-01', count: 140, who: goa, beats: ['Meera proposes a dolphin boat trip 1,200 each; agreed by all.', 'Rohan proposes parasailing 2,500 each; Kavya and Neha refuse; never agreed.', 'Dinner at Thalassa on Oct 3 at 8 pm agreed.'] },
    { topic: 'during', title: 'During the trip', from: '2026-10-02', to: '2026-10-05', count: 260, who: goa, beats: ['Photos, lost sunglasses, beach plans.', 'Thalassa dinner bill 12,600 paid by Arjun, split six ways, 2,100 each to Arjun.', 'Scooter rentals 600 each per day for 3 days, each person paid their own.', 'Sid pays fuel 5,400 total.'] },
    { topic: 'settle', title: 'Settling up after Goa', from: '2026-10-06', to: '2026-10-25', count: 200, who: goa, beats: ['Neha posts a summary of who owes whom.', 'Kavya and Meera pay Neha 4,800 each for flights; Neha confirms.', 'Rohan keeps promising to pay Arjun "next week"; still owes for villa and dinner.', 'Meera says she paid Arjun 8,300; Arjun confirms.'] },
    ...chat(goa, [M(2026, 9), M(2026, 10), M(2026, 11)], 150, 'memes, Goa reels, office complaints, cricket, food cravings, good morning messages'),
  ],
};

/* ---------------- Rao family (about 5,000) ---------------- */
const famPeople: Person[] = [
  { name: 'Neha', style: 'daughter working in Hyderabad, Telugu in English letters and English' },
  { name: 'Amma', style: 'mother, Telugu script and Telugu in English letters, voice-note style long messages, blessings' },
  { name: 'Nanna', style: 'father, short Telugu-English messages, asks about money and health' },
  { name: 'Vamsi', style: "Neha's brother in Bangalore, Telugu-English, jokes" },
  { name: 'Lakshmi', style: 'aunt, Telugu script, forwards, festival plans' },
  { name: 'Srinu', style: 'uncle, Telugu-English, handles property and bills' },
  { name: 'Pinky', style: 'teenage cousin, emojis, English' },
];
const fam = famPeople.map(p => p.name);
const famMonths = months([2026, 6], 6);
const raoFamily: GroupStory = {
  id: 'raofamily', title: 'Rao Family 🏡', people: famPeople,
  chunks: [
    ...famMonths.map(([from, to], i): Chunk => ({
      topic: `home_${from.slice(0, 7)}`, title: `Home expenses, ${from.slice(0, 7)}`, from, to, count: 110, who: ['Neha', 'Vamsi', 'Nanna', 'Amma'],
      beats: [`Neha and Vamsi each send 10,000 to Nanna for home expenses this month; Nanna confirms receiving${i === 3 ? " Neha's but says Vamsi's has not come" : ''}.`, 'Talk about the electricity bill and the maid salary.'],
    })),
    { topic: 'surgery', title: "Nanna's knee surgery", from: '2026-07-10', to: '2026-08-05', count: 320, who: fam, beats: ["Nanna needs knee surgery at Apollo, estimate 2,40,000; insurance covers 1,50,000.", 'Neha and Vamsi agree to split the remaining 90,000 equally, 45,000 each, paid to the hospital directly by Neha; Vamsi will pay Neha his half.', 'Surgery date fixed July 28; Lakshmi offers to stay with Amma.', 'Vamsi pays Neha 25,000 and promises the remaining 20,000 by August 15.'] },
    { topic: 'wedding', title: "Pinky's sister's wedding", from: '2026-08-15', to: '2026-10-20', count: 420, who: fam, beats: ['Wedding in Guntur on November 20; muhurtham 10:30 am.', 'Family gift: a gold chain, 60,000, split among Neha, Vamsi, Srinu and Lakshmi, 15,000 each, collected by Srinu.', 'Travel by train on November 19; Srinu books 7 tickets, 900 each.', 'Amma insists everyone wears the same saree colour; long debate; decided maroon.'] },
    { topic: 'diwali', title: 'Diwali at home', from: '2026-10-01', to: '2026-11-10', count: 300, who: fam, beats: ['Everyone coming home for Diwali Nov 8; Vamsi can only come Nov 9.', 'Crackers budget 8,000 split between Neha and Vamsi, Neha buys.', 'Lakshmi makes sweets; Amma asks Neha to bring a new pressure cooker.'] },
    { topic: 'property', title: 'Village land papers', from: '2026-06-15', to: '2026-09-30', count: 260, who: ['Nanna', 'Srinu', 'Neha', 'Vamsi'], beats: ['Srinu handles land registration fee 36,000, to be split three ways between Nanna, Srinu and Vamsi.', 'Disagreement: Vamsi says Neha should also share; Nanna says no, it is decided.'] },
    ...chat(fam, months([2026, 6], 6), 380, 'good morning images, Telugu forwards, health tips, Pinky exam results, recipes, temple visits, cricket, weather in Vijayawada').map(c => ({ ...c, count: 520 })),
  ],
};

/* ---------------- Office (about 1,200) ---------------- */
const offPeople: Person[] = [
  { name: 'Neha', style: 'product manager, crisp English' },
  { name: 'Rahul', style: 'engineering manager, decisive' },
  { name: 'Fatima', style: 'designer, friendly, emojis' },
  { name: 'Joel', style: 'backend engineer, dry humour' },
  { name: 'Ananya', style: 'QA, very organised' },
  { name: 'Karthik', style: 'intern, enthusiastic' },
];
const off = offPeople.map(p => p.name);
const office: GroupStory = {
  id: 'productsquad', title: 'Product Squad 💼', people: offPeople,
  chunks: [
    { topic: 'offsite', title: 'Team offsite', from: '2026-09-01', to: '2026-09-25', count: 220, who: off, beats: ['Offsite in Coorg on Oct 16-17 agreed; budget 4,000 per person from the company, extra paid by each person.', 'Rahul books the homestay; Ananya makes the agenda.', 'Joel cannot come on 16th morning; joins evening.'] },
    { topic: 'farewell', title: "Karthik's farewell gift", from: '2026-10-20', to: '2026-11-05', count: 150, who: ['Neha', 'Rahul', 'Fatima', 'Joel', 'Ananya'], beats: ['Secret gift for Karthik leaving on Nov 6; AirPods 15,000, 3,000 each, collected by Fatima.', 'Joel says he paid Fatima; Fatima confirms. Rahul pays later.'] },
    { topic: 'lunch', title: 'Friday team lunch', from: '2026-08-01', to: '2026-11-15', count: 180, who: off, beats: ['Monthly team lunch: rotating payer; Neha pays 4,800 in September split six ways, 800 each to Neha.', 'October lunch paid by Rahul 5,400, 900 each.'] },
    { topic: 'release', title: 'Release v2.4 plan', from: '2026-09-10', to: '2026-10-10', count: 220, who: off, beats: ['Release date Oct 1, moved to Oct 8 after QA finds a payment bug; Rahul and Neha agree.', 'Ananya owns regression testing; Joel promises the fix by Oct 4.'] },
    ...chat(off, months([2026, 8], 4), 110, 'standup jokes, coffee runs, memes about Jira, weekend plans, cricket scores'),
  ],
};

/* ---------------- College batch (about 3,000) ---------------- */
const colPeople: Person[] = [
  { name: 'Neha', style: 'Telugu-English' },
  { name: 'Sandeep', style: 'Telugu, organiser of reunions' },
  { name: 'Harsha', style: 'Telugu-English, in the US, joins late at night IST' },
  { name: 'Divya', style: 'English, married, busy' },
  { name: 'Imran', style: 'Hindi-English, cricket fanatic' },
  { name: 'Pooja', style: 'Hindi-English, birthday planner' },
  { name: 'Venky', style: 'Telugu, sarcastic' },
];
const col = colPeople.map(p => p.name);
const college: GroupStory = {
  id: 'iiitbatch', title: 'IIIT Batch 2019 🎓', people: colPeople,
  chunks: [
    { topic: 'reunion', title: 'Reunion trip to Coorg', from: '2026-07-01', to: '2026-08-30', count: 520, who: col, beats: ['Sandeep proposes a reunion; long date debate; agreed Aug 22-24 in Coorg.', 'Resort 42,000 split seven ways, 6,000 each, paid by Sandeep.', 'Harsha joins online only (in the US), so he pays nothing for the resort; group agrees 6 people pay 7,000 each instead.', 'Imran and Venky drive; fuel 4,200 split among the 4 riders in their cars.'] },
    { topic: 'bday_divya', title: "Divya's birthday surprise", from: '2026-09-01', to: '2026-09-18', count: 260, who: ['Neha', 'Sandeep', 'Harsha', 'Imran', 'Pooja', 'Venky'], beats: ['Pooja organises a surprise video plus a gift hamper for Divya on Sep 18; 6,000 split six ways, 1,000 each to Pooja.', 'Harsha pays Pooja via Wise; Pooja confirms.'] },
    { topic: 'cricket', title: 'Asia Cup bets', from: '2026-09-05', to: '2026-10-05', count: 360, who: col, beats: ['Friendly bets on India matches, 500 each loser pays winner; Imran wins three bets, Venky owes Imran 1,500.', 'Venky disputes one result (rain-affected match); never settled.'] },
    { topic: 'wedding_imran', title: "Imran's wedding", from: '2026-10-10', to: '2026-11-30', count: 460, who: col, beats: ["Imran's wedding in Lucknow on Dec 14; everyone invited.", 'Group gift 21,000 split among the other six, 3,500 each, collected by Neha.', 'Flights Hyderabad to Lucknow, each books their own; Sandeep and Neha on the same flight Dec 13.'] },
    ...chat(col, months([2026, 7], 5), 290, 'college memories, old photos, job switches, US vs India debates, cricket, Telugu movie reviews'),
  ],
};

/* ---------------- Housing society (about 2,500) ---------------- */
const socPeople: Person[] = [
  { name: 'Neha', style: 'tenant in B-402, polite English' },
  { name: 'Mr. Reddy', style: 'society secretary, formal English with Telugu, long notices' },
  { name: 'Mrs. Iyer', style: 'B-302, detailed complaints, English' },
  { name: 'Faisal', style: 'B-201, Hindi-English, handles the lift committee' },
  { name: 'Gupta ji', style: 'B-305, Hindi, argues about money' },
  { name: 'Swathi', style: 'B-101, organises events, Telugu-English' },
];
const soc = socPeople.map(p => p.name);
const society: GroupStory = {
  id: 'greenmeadows', title: 'Green Meadows Block B 🏢', people: socPeople,
  chunks: [
    ...months([2026, 7], 5).map(([from, to]): Chunk => ({
      topic: `maint_${from.slice(0, 7)}`, title: `Maintenance, ${from.slice(0, 7)}`, from, to, count: 120, who: soc,
      beats: ['Mr. Reddy reminds everyone that monthly maintenance of 3,500 per flat is due by the 10th, paid to the society account (outside the group).', 'Several residents say they paid; Gupta ji always late.'],
    })),
    { topic: 'lift', title: 'Lift repair', from: '2026-08-05', to: '2026-09-20', count: 380, who: soc, beats: ['Lift breaks down; Faisal gets quotes; repair 1,20,000.', 'Agreed: 6 flats in this group pay 20,000 each, collected by Faisal.', 'Gupta ji refuses, says the builder should pay; real disagreement for weeks.', 'Neha and Swathi pay Faisal; Faisal confirms.'] },
    { topic: 'diwali_event', title: 'Diwali event', from: '2026-10-01', to: '2026-11-10', count: 320, who: soc, beats: ['Swathi plans a Diwali event on Nov 7 at 7 pm in the clubhouse; 1,000 per flat, collected by Swathi.', 'Mrs. Iyer wants no loud crackers after 10 pm; agreed.', 'Gupta ji says he will pay at the event.'] },
    { topic: 'water', title: 'Water tanker issue', from: '2026-07-10', to: '2026-08-20', count: 260, who: soc, beats: ['Water shortage; Mr. Reddy books tankers; 2,400 per flat extra for July, paid to the society account.', 'Mrs. Iyer disputes the amount, asks for bills; Mr. Reddy shares bills.'] },
    ...chat(soc, months([2026, 7], 5), 150, 'parking complaints, lost and found, dog walking, security guard issues, good morning, festival greetings'),
  ],
};

/* ---------------- Gym (about 900) ---------------- */
const gymPeople: Person[] = [
  { name: 'Neha', style: 'Telugu-English, consistent at the gym' },
  { name: 'Tarun', style: 'trainer-type, motivational, Hindi-English' },
  { name: 'Aisha', style: 'English, nutrition nerd' },
  { name: 'Bhavya', style: 'Telugu, often skips' },
  { name: 'Manoj', style: 'Hindi-English, bulk-buys supplements' },
];
const gymWho = gymPeople.map(p => p.name);
const gym: GroupStory = {
  id: 'gymsquad', title: 'Gym Squad 💪', people: gymPeople,
  chunks: [
    ...months([2026, 8], 4).map(([from, to]): Chunk => ({ topic: `trainer_${from.slice(0, 7)}`, title: `Personal trainer, ${from.slice(0, 7)}`, from, to, count: 70, who: gymWho, beats: ['The group shares a personal trainer at 10,000 a month split five ways, 2,000 each, paid to Tarun who pays the trainer.', 'Some say they paid Tarun; Tarun confirms most of them.'] })),
    { topic: 'whey', title: 'Bulk whey order', from: '2026-09-05', to: '2026-09-25', count: 140, who: gymWho, beats: ['Manoj orders 5 tubs of whey for 17,500, 3,500 each, paid to Manoj.', 'Bhavya cancels her tub; Manoj keeps it; the other four pay 3,500 each.'] },
    { topic: 'marathon', title: 'Hyderabad 10K run', from: '2026-10-01', to: '2026-11-02', count: 160, who: gymWho, beats: ['Hyderabad 10K on Nov 1 at 5:30 am; registration 1,200 each, Aisha registers everyone and asks for 1,200 each.', 'Bhavya drops out; Aisha says the fee is non-refundable so Bhavya still owes.'] },
    ...chat(gymWho, months([2026, 8], 4), 75, 'workout selfies, diet jokes, protein recipes, motivation quotes, skipping leg day'),
  ],
};

/* ---------------- Foodies (about 800) ---------------- */
const foodPeople: Person[] = [
  { name: 'Neha', style: 'Telugu-English, loves biryani' },
  { name: 'Zoya', style: 'Hindi-English, food blogger' },
  { name: 'Kiran', style: 'Telugu, picks restaurants' },
  { name: 'Abhi', style: 'English, always pays first' },
  { name: 'Ritu', style: 'Hindi-English, vegetarian' },
];
const foodWho = foodPeople.map(p => p.name);
const foodies: GroupStory = {
  id: 'hydfoodies', title: 'Hyderabad Foodies 🍛', people: foodPeople,
  chunks: [
    { topic: 'biryani', title: 'Biryani crawl', from: '2026-08-10', to: '2026-08-30', count: 150, who: foodWho, beats: ['Biryani crawl on Aug 23 across Paradise, Shah Ghouse and Bawarchi; Abhi pays all three bills, 7,500 total, 1,500 each to Abhi.', 'Ritu only ate veg biryani at two places; the group agrees she pays 1,000 instead; the other four pay 1,625 each.'] },
    { topic: 'cafe', title: 'Cafe hopping, Jubilee Hills', from: '2026-09-15', to: '2026-10-05', count: 140, who: foodWho, beats: ['Sunday cafe hopping on Sep 27; Zoya books tables.', 'Kiran pays 4,200 at the last cafe, split five ways, 840 each to Kiran.'] },
    { topic: 'diwali_food', title: 'Diwali sweets order', from: '2026-10-20', to: '2026-11-08', count: 140, who: foodWho, beats: ['Bulk order from Almond House for Diwali, 9,000 total, Neha orders, each person takes a box worth 1,800, paid to Neha.', 'Abhi and Zoya pay Neha; Neha confirms.'] },
    ...chat(foodWho, months([2026, 8], 4), 95, 'food photos, restaurant reviews, Zomato offers, street food cravings, recipe debates'),
  ],
};


/* ---------------- Kruthik, Aniket, Swapnil: flatmates, Hinglish (about 7,300) ---------------- */
// A real group for the owner's own account only (never seeded for other accounts). Messages are generated; the
// people's real phone numbers are added in the app, never here.
const trioPeople: Person[] = [
  { name: 'Kruthik', style: 'Hinglish, organised, tracks money, sends long voice-note style messages, uses "bhai" and "yaar"' },
  { name: 'Aniket', style: 'Hinglish, chill, lazy about paying back, lots of "😂" and "haan haan kal pakka"' },
  { name: 'Swapnil', style: 'Hinglish with some Marathi words ("kay re", "chal"), plans trips, argues about money but fair' },
];
const trioWho = trioPeople.map(p => p.name);
/**
 * What is left at the end if every event happens as written (the right answer for this group):
 * Aniket owes Kruthik 11,500 (AC 6,000 + Manali flights 5,500); Swapnil owes Aniket 5,000 (bike loan);
 * Aniket owes Swapnil 1,000 (cleaning) plus IPL bets 1,000, of which he disputes 200. Monthly flat bills are all settled.
 */
export const TRIO_EXPECTED = { aniketToKruthik: 11500, swapnilToAniketBeforeOffsets: 5000, aniketToSwapnil: [1800, 2000] as const };
const trio: GroupStory = {
  id: 'trio', title: 'Flat 7B – K A S 🏠', people: trioPeople,
  voice: 'Write like three young flatmates in Hyderabad texting in Hinglish: Hindi in English letters mixed with English ("bhai rent bhej de", "kal pakka", "scene kya hai"), short messages, typos, emojis, replies like "ok", "done", "😂", several messages in a row from one person.',
  chunks: [
    ...months([2026, 5], 7).map(([from, to]): Chunk => ({
      topic: `flat_${from.slice(0, 7)}`, title: `Flat expenses, ${from.slice(0, 7)}`, from, to, count: 250, who: trioWho,
      beats: [
        'Kruthik pays the owner the full rent of 54,000 and asks Aniket and Swapnil for 18,000 each. Wifi 1,200 is paid by Aniket (400 each to Aniket); maid 4,500 is paid by Swapnil (1,500 each to Swapnil).',
        'Swapnil sends Kruthik 18,000 for rent and Kruthik replies that he received it. Kruthik sends Aniket 400 for wifi and Swapnil 1,500 for maid; each confirms. Swapnil sends Aniket 400 for wifi; Aniket confirms.',
        'Electricity bill of 3,000 paid by Kruthik, 1,000 each. Aniket says "kal pakka" and sends Kruthik 18,000 rent plus 1,000 electricity a few days late; Kruthik confirms. Swapnil sends Kruthik 1,000 electricity; Kruthik confirms. Aniket sends Swapnil 1,500 maid; Swapnil confirms. By the end everyone is settled for this month.',
      ],
    })),
    { topic: 'ac', title: 'New AC for the hall', from: '2026-05-10', to: '2026-06-05', count: 400, who: trioWho, beats: ['Summer heat; long debate on window vs split AC.', 'Kruthik buys a 1.5 ton split AC for 36,000 on EMI; split three ways, 12,000 each to Kruthik.', 'Swapnil pays Kruthik 12,000; Kruthik confirms.', 'Aniket pays 6,000 and promises the other 6,000 after his bonus in August.'] },
    { topic: 'ipl', title: 'IPL bets', from: '2026-05-01', to: '2026-05-31', count: 300, who: trioWho, beats: ['Friendly IPL bets, 200 per match, loser pays winner.', 'By the final Aniket owes Swapnil 1,000; Aniket says one match was fixed and refuses to pay 200 of it; never settled.'] },
    { topic: 'bday_swapnil', title: "Swapnil's birthday", from: '2026-07-01', to: '2026-07-20', count: 400, who: ['Kruthik', 'Aniket'], beats: ['Kruthik and Aniket plan a surprise for Swapnil on July 15 at 12 am: cake and a Bluetooth speaker.', 'Speaker 4,800 and cake 1,200, total 6,000, Kruthik pays, Aniket owes Kruthik 3,000.', 'Aniket pays Kruthik 3,000; Kruthik confirms.'] },
    { topic: 'bike_loan', title: "Swapnil's bike repair loan", from: '2026-08-01', to: '2026-09-15', count: 350, who: trioWho, beats: ['Swapnil has a small bike accident (he is fine); repair 15,000.', 'Aniket lends Swapnil 15,000.', 'Swapnil pays Aniket back 10,000; still owes 5,000, promises by September 30.'] },
    { topic: 'gym', title: 'Gym membership', from: '2026-08-15', to: '2026-09-10', count: 300, who: trioWho, beats: ['Kruthik and Aniket join cult.fit, 6-month plan 9,000 each, each pays their own.', 'Swapnil refuses to join and keeps mocking them; no money involved for him.'] },
    { topic: 'diwali_clean', title: 'Diwali deep cleaning', from: '2026-10-10', to: '2026-10-25', count: 300, who: trioWho, beats: ['Deep cleaning of the flat before Diwali on Oct 18 at 10 am, 3,000 total, Swapnil books Urban Company and pays.', 'Split three ways, 1,000 each to Swapnil. Kruthik sends Swapnil 1,000 and Swapnil confirms; Aniket has not paid his 1,000 yet.', 'Everyone goes home for Diwali: Kruthik leaves Oct 30, Aniket and Swapnil leave Oct 31.'] },
    { topic: 'manali_dates', title: 'Manali trip: dates', from: '2026-09-20', to: '2026-10-20', count: 350, who: trioWho, beats: ['Swapnil proposes a Manali trip in December.', 'Aniket wants Dec 24-31 for New Year; Kruthik can only take leave Dec 18-24; long debate.', 'Finally agreed: Dec 19 to Dec 25, all three confirm.'] },
    { topic: 'manali_travel', title: 'Manali trip: travel', from: '2026-10-15', to: '2026-11-15', count: 350, who: trioWho, beats: ['Flight Hyderabad to Chandigarh vs to Delhi plus Volvo; decided: fly Hyderabad to Chandigarh on Dec 19, then taxi to Manali.', 'Kruthik books 3 flights for 16,500 total, 5,500 each to Kruthik.', 'Swapnil pays Kruthik 5,500; Aniket has not paid yet.'] },
    { topic: 'manali_stay', title: 'Manali trip: stay and budget', from: '2026-10-25', to: '2026-11-20', count: 350, who: trioWho, beats: ['Budget agreed: about 25,000 per person all-in.', 'Swapnil shortlists hostels in Old Manali; Aniket wants a private cottage; not decided yet.', 'Snow trek to Solang Valley on Dec 22 agreed by all; cost not fixed yet.'] },
    ...chat(trioWho, months([2026, 5], 7), 410, 'Hinglish banter between flatmates: office rants, cricket, Swiggy orders, who finished the milk, Netflix, weekend plans, memes, mom calls'),
  ],
};

export const GROUPS: GroupStory[] = [goaTrip, raoFamily, office, college, society, gym, foodies, trio];
