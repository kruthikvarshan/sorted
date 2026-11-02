import { Scenario } from './types';
import { teluguFriends } from './teluguFriends';
import { teluguFamily } from './teluguFamily';
import { hinglishFlat } from './hinglishFlat';
import { officeOffsite } from './officeOffsite';
import { multilingualStress } from './multilingualStress';
import { adversarial } from './adversarial';

export const SCENARIOS: Scenario[] = [teluguFriends, teluguFamily, hinglishFlat, officeOffsite, multilingualStress, adversarial];

/** Render a scenario as a WhatsApp "Export chat" text file, so the importer path can be tried with it. */
export function toWhatsAppExport(scenario: Scenario): string {
  return scenario.messages
    .map(m =>
      m.type === 'system'
        ? `10/24/24, ${m.time} - ${m.text}`
        : `10/24/24, ${m.time} - ${m.speaker}: ${m.text}`
    )
    .join('\n');
}

export type { Scenario } from './types';
