// Which payment stages one invoice may cover. Pure, so the rules are unit-tested.
//
// Several unbilled stages can go on ONE invoice ("Bill together", e.g. progress payments 2
// and 3 when the work went faster). Every stage on it records the same Xero invoice ID and
// number, each with its own amount.
//
// An attempt in flight (a number stored, no invoice recorded: lib/clientAcceptance.mjs
// attemptInFlight) belongs to every stage holding that number. Its retry must cover exactly
// those stages: a different selection could build a different invoice under a number Xero
// may already have used.

import { attemptInFlight } from './clientAcceptance.mjs';

/** Selected ids → unique ids, in the order given. Accepts an array or "ST-1,ST-2". */
export function parseStageIds(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  return [...new Set(list.map(s => String(s).trim()).filter(Boolean))];
}

/**
 * `schedule` stages (describeSchedule order) and the selected ids →
 *   { stages, missing, retryNumber, problem }
 * `stages` are the selected ones in schedule order. `retryNumber` is the number of the
 * unfinished attempt this selection retries, if any. `problem` is a reason in words, or ''.
 */
export function selectStages(scheduleStages, ids) {
  const want = new Set(ids);
  const stages = scheduleStages.filter(s => want.has(s.id));
  const missing = ids.filter(id => !stages.some(s => s.id === id));
  if (missing.length || !stages.length) return { stages, missing, retryNumber: '', problem: '' };

  const numbers = [...new Set(stages.filter(attemptInFlight).map(s => s.xeroInvoiceNumber))];
  if (numbers.length > 1) {
    return { stages, missing, retryNumber: '', problem: `These stages have separate unfinished attempts (${numbers.join(', ')}). Retry each one on its own first.` };
  }
  if (numbers.length === 1) {
    const group = scheduleStages.filter(s => attemptInFlight(s) && s.xeroInvoiceNumber === numbers[0]);
    const same = group.length === stages.length && group.every(s => want.has(s.id));
    if (!same) {
      return {
        stages, missing, retryNumber: '',
        problem: `${group.map(s => s.name).join(' + ')} ${group.length === 1 ? 'has' : 'have'} an unfinished attempt as ${numbers[0]}. Press Retry bill on ${group.length === 1 ? 'it' : 'them together'} first, so the app can check Xero.`,
      };
    }
    return { stages, missing, retryNumber: numbers[0], problem: '' };
  }
  return { stages, missing, retryNumber: '', problem: '' };
}

/** The stages that go with `stage` when its Retry is pressed: everyone holding its number. */
export function retryGroup(scheduleStages, stage) {
  if (!attemptInFlight(stage)) return [stage];
  return scheduleStages.filter(s => attemptInFlight(s) && s.xeroInvoiceNumber === stage.xeroInvoiceNumber);
}

/** "Deposit + Progress payment 1" */
export const stagesLabel = stages => stages.map(s => s.name).join(' + ');
