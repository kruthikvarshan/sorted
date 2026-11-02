/**
 * Replaces the example groups in one account with the latest versions (after a re-read), keeping which ones My Group OS
 * follows. Real groups (and groups added with addGroupToAccount, like Flat 7B) are not touched.
 *
 *   npx tsx scripts/refreshExamples.ts --phone=+919876543210
 */
import { getAccount, normalizePhone, saveAccount } from '../server/live/accounts';
import { createRoom, deleteRoom, joinRoom, roomEntry } from '../server/live/hub';
import { asPerson, DEMO_GROUPS, sample, shiftToNow } from '../server/live/http';

const phone = normalizePhone(process.argv.find(a => a.startsWith('--phone='))?.split('=')[1] ?? '');
const account = phone ? getAccount(phone) : undefined;
if (!account) throw new Error('No account with that number.');
let replaced = 0;
for (const seat of [...account.seats]) {
  if (!seat.demo || !DEMO_GROUPS.includes(seat.demo) || !roomEntry(seat.roomId)?.room.example) continue;
  const followed = account.scope.includes(seat.roomId);
  deleteRoom(seat.roomId);
  const s = shiftToNow(asPerson(sample(seat.demo), account.name));
  const room = createRoom(s.title, { messages: s.messages, state: s.state, people: s.people, example: true, owner: account.username });
  const member = joinRoom(room.id, s.me).member!;
  account.seats = account.seats.map(x => (x === seat ? { roomId: room.id, token: member.token, demo: seat.demo } : x));
  account.scope = account.scope.filter(id => id !== seat.roomId);
  if (followed) account.scope.push(room.id);
  replaced++;
}
saveAccount(account);
console.log(`Refreshed ${replaced} example groups for ${account.name}; ${account.seats.length} groups in total.`);
