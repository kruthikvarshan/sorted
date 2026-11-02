/**
 * Adds a generated group to ONE account, by its phone number: used for a real group whose people are real (so it is
 * never seeded for other accounts). The account owner takes the seat with their name; the others are added in the app
 * with their numbers.
 *
 *   npx tsx scripts/addGroupToAccount.ts --group=trio --phone=+919876543210 [--replace]
 *
 * --replace swaps out a copy the account already has (for a corrected re-read). Run it with the server stopped.
 */
import { getAccount, normalizePhone, saveAccount } from '../server/live/accounts';
import { createRoom, deleteRoom, joinRoom } from '../server/live/hub';
import { sample, shiftToNow } from '../server/live/http';

const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
const id = arg('group');
const phone = normalizePhone(arg('phone') ?? '');
if (!id || !phone) throw new Error('Usage: --group=<id> --phone=<number>');
const account = getAccount(phone);
if (!account) throw new Error('No account with that number yet: sign up in the app first.');

const s = shiftToNow(sample(id));
const old = account.seats.find(x => x.demo === id);
if (old && !process.argv.includes('--replace')) throw new Error(`${s.title} is already in this account (add --replace to swap it).`);
if (old) {
  deleteRoom(old.roomId);
  account.seats = account.seats.filter(x => x !== old);
  account.scope = account.scope.filter(r => r !== old.roomId);
}
const room = createRoom(s.title, { messages: s.messages, state: s.state, people: s.people, owner: account.username });
const seat = s.people.find(p => p.toLowerCase() === account.name.toLowerCase()) ?? s.people[0];
const member = joinRoom(room.id, seat).member!;
account.seats.unshift({ roomId: room.id, token: member.token, demo: id, owner: true });
account.scope.unshift(room.id);
saveAccount(account);
console.log(`Added "${s.title}" (${s.messages.length} messages) to ${account.name}'s account as ${seat}.`);
