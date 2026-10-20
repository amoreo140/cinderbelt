// Every language registered up front, without a download: unit tests (vitest setup) and the UI kit, which
// switch languages synchronously. The game itself loads only the active language (index.ts).
import { registerTexts } from './index';
import { deTexts } from './textsDe';
import { enTexts } from './textsEn';
import { skTexts } from './textsSk';

registerTexts('sk', skTexts);
registerTexts('en', enTexts);
registerTexts('de', deTexts);
