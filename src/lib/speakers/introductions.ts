/**
 * People who say their own name: "Hi, this is Anna from marketing", "Jag
 * heter Erik". A pure pattern match over the transcript, in English and
 * Swedish, used ONLY to seed name suggestions for the voice that spoke the
 * line. Nothing here names anybody: the user picks a suggestion or does not.
 *
 * No language model is involved. The patterns are deliberately narrow: a
 * missed introduction costs a suggestion, a false one puts a wrong name in
 * front of the user.
 */

export interface IntroductionSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
}

export interface Introduction {
  /** The LABEL of whoever spoke the line (`speaker-2`, `me`). */
  speaker: string;
  /** The name as it was said, 1 to 3 capitalised words. */
  name: string;
  /** Index into the `segments` that were passed in. */
  segmentIndex: number;
  /** 0..1. "My name is" is near certain; "this is" may be introducing someone else. */
  confidence: number;
}

/** Only this far into a speaker's own first words: people introduce themselves early. */
export const INTRODUCTION_WINDOW_SECS = 600;

/**
 * A phrase as a pattern that ignores case, without the `i` flag: under `i`
 * the "uppercase letter" class that recognises a name would match any letter.
 */
function phrase(words: string): string {
  return words
    .split(' ')
    .map((word) =>
      [...word]
        .map((ch) => {
          if (ch === "'") return "['’]";
          const lower = ch.toLowerCase();
          const upper = ch.toUpperCase();
          return lower === upper ? ch : `[${lower}${upper}]`;
        })
        .join(''),
    )
    .join(String.raw`\s+`);
}
function anyOf(phrases: string[]): string {
  return `(?:${phrases.map(phrase).join('|')})`;
}

// One name word: an uppercase letter, then letters (inner ' or - allowed: O'Brien, Ann-Sofie).
const WORD = String.raw`\p{Lu}\p{L}*(?:['’-]\p{L}+)*`;
const NAME = String.raw`(${WORD}(?:[ \t]+${WORD}){0,2})`;
// Where a sentence (or a clause after a greeting) can begin.
const SENTENCE_START = String.raw`(?:^|[.!?…]\s+|[,;:–—]\s+)`;
const GREETING = String.raw`(?:${anyOf([
  'hi',
  'hello',
  'hey',
  'okay',
  'ok',
  'yes',
  'yeah',
  'hej',
  'hejsan',
  'hallå',
  'tjena',
  'ja',
  'okej',
  'and',
  'so',
  'och',
  'så',
])}(?:\s+${anyOf(['everyone', 'everybody', 'all', 'alla', 'allihopa'])})?[,!.]?\s+)?`;
// What may follow a name for a weaker pattern to count: the clause ends, or it
// goes on the way an introduction does ("… from marketing", "… och jag …").
const AFTER_EN = String.raw`(?=\s*(?:$|[.,!?;:…]|(?:and|from|here|speaking|at|with|calling|in)(?![\p{L}])))`;
const AFTER_SV = String.raw`(?=\s*(?:$|[.,!?;:…]|(?:och|från|här|på|som|i)(?![\p{L}])))`;
// "This is Anna, our new designer": somebody else is being introduced.
const THIRD_PERSON_EN = /^\s*,?\s*(?:our|my|the|a|an|who|she|he|they|his|her)(?![\p{L}])/iu;
const THIRD_PERSON_SV = /^\s*,?\s*(?:vår|vårt|våra|min|mitt|mina|som|hon|han|den|en|ett)(?![\p{L}])/iu;
const BOOST = /^\s*(?:here|speaking|calling|from|här|från)(?![\p{L}])/iu;
// A letter must not come right before a trigger. Written as a consumed
// character rather than a lookbehind, which older WebKit cannot parse.
const WORD_START = String.raw`(?:^|[^\p{L}])`;

interface Pattern {
  regex: RegExp;
  confidence: number;
  /** Raised to this when the name is followed by "here" / "speaking" / "from …". */
  boosted?: number;
  thirdPerson?: RegExp;
}

const PATTERNS: Pattern[] = [
  // English
  { regex: new RegExp(String.raw`${WORD_START}${anyOf(['my name is', "my name's"])}\s+${NAME}`, 'gu'), confidence: 0.9 },
  {
    regex: new RegExp(String.raw`${WORD_START}${phrase('this is')}\s+${NAME}${AFTER_EN}`, 'gu'),
    confidence: 0.55,
    boosted: 0.8,
    thirdPerson: THIRD_PERSON_EN,
  },
  {
    regex: new RegExp(String.raw`${WORD_START}(?:I['’]m|I\s+am)\s+${NAME}${AFTER_EN}`, 'gu'),
    confidence: 0.7,
    thirdPerson: THIRD_PERSON_EN,
  },
  { regex: new RegExp(String.raw`${SENTENCE_START}${GREETING}${NAME}\s+here${AFTER_EN}`, 'gu'), confidence: 0.6 },
  // Swedish
  { regex: new RegExp(String.raw`${WORD_START}${phrase('jag heter')}\s+${NAME}`, 'gu'), confidence: 0.9 },
  { regex: new RegExp(String.raw`${WORD_START}${phrase('mitt namn är')}\s+${NAME}`, 'gu'), confidence: 0.9 },
  {
    regex: new RegExp(String.raw`${WORD_START}${phrase('det här är')}\s+${NAME}${AFTER_SV}`, 'gu'),
    confidence: 0.55,
    boosted: 0.8,
    thirdPerson: THIRD_PERSON_SV,
  },
  { regex: new RegExp(String.raw`${SENTENCE_START}${GREETING}${NAME}\s+här${AFTER_SV}`, 'gu'), confidence: 0.6 },
];

/**
 * Capitalised words that are not a person's name where a name would stand.
 * Lower case. Days, months, pronouns, nationalities and languages, words that
 * start a sentence before "here" / "här", places and products that turn up in
 * "this is …".
 */
const NOT_A_NAME = new Set(
  [
    // days, months (en + sv; Swedish ones are capitalised by some transcribers)
    'monday tuesday wednesday thursday friday saturday sunday',
    'january february march april may june july august september october november december',
    'måndag tisdag onsdag torsdag fredag lördag söndag',
    'januari februari mars maj juni juli augusti oktober',
    // pronouns and determiners
    'me my we us our you your he him his she her they them their it its this that these those there here',
    'jag mig min mitt mina vi oss vår vårt våra du dig din ditt ni er han honom hans hon henne hennes de dem dom deras det den detta denna dessa där här man',
    'everyone everybody anyone anybody someone somebody nobody all both nothing something everything who what where when why how',
    'alla allihopa ingen någon inget något allt båda vem vad var när hur varför',
    // nationalities, languages, titles
    'swedish english american british german french norwegian danish finnish european spanish italian dutch polish',
    'svensk svenska engelsk engelska norsk dansk finsk tysk fransk',
    'mr mrs ms dr sir madam',
    // sentence-initial words before "here" / "här", and common openers
    'right over come look still not stay sit sign click press up down in out back already almost now just so and but well',
    'yes no okay ok thanks thank welcome good great nice sorry please hello hi hey wait stop start move put get go bring listen see',
    'live work works been was is are am were be being done ready happy glad sure fine also only even really very too',
    'kom titta redan fortfarande inte just precis sitt stanna klicka tryck bor jobbar är finns kvar nu och men så ja nej okej',
    'tack välkommen välkomna bra hej hejsan vänta stopp börja lägg ställ sätt skriv kolla se lyssna inne ute uppe nere borta hemma klar färdig ledsen också bara',
    // places, companies and products people point at
    'sweden sverige stockholm göteborg gothenburg malmö norway norge denmark danmark finland europe europa america usa london',
    'teams zoom google microsoft apple slack notesage meet skype',
    // things "this is" is said about
    'bad true false important interesting amazing awesome perfect correct wrong',
  ]
    .join(' ')
    .split(' '),
);

function isNameWord(word: string): boolean {
  if (word.length < 2) return false;
  // ALL CAPS is an abbreviation ("OK", "CEO", "HR"), not a name.
  if (word === word.toUpperCase()) return false;
  return !NOT_A_NAME.has(word.toLowerCase());
}

/**
 * The leading run of real name words. `null` when the first word is not one,
 * or when any captured word is a possessive ("Anna's idea" names nobody).
 */
function cleanCapturedName(raw: string): string | null {
  const words = raw.trim().split(/[ \t]+/);
  if (words.some((word) => /['’]s$/i.test(word))) return null;
  const kept: string[] = [];
  for (const word of words) {
    if (!isNameWord(word)) break;
    kept.push(word);
  }
  return kept.length > 0 ? kept.join(' ') : null;
}

/**
 * Self-introductions in a transcript.
 *
 * Each is attributed to the label of the segment it was said in, so the name
 * is suggested for that voice. Only a speaker's first ten minutes are read. A
 * name is reported once per speaker, with the best confidence it was heard at.
 */
export function findIntroductions(segments: readonly IntroductionSegment[]): Introduction[] {
  const firstStart = new Map<string, number>();
  for (const segment of segments) {
    const speaker = segment.speaker?.trim();
    if (!speaker) continue;
    const seen = firstStart.get(speaker);
    if (seen === undefined || segment.start < seen) firstStart.set(speaker, segment.start);
  }

  const best = new Map<string, Introduction>();
  segments.forEach((segment, segmentIndex) => {
    const speaker = segment.speaker?.trim();
    if (!speaker) return;
    if (segment.start - (firstStart.get(speaker) ?? 0) > INTRODUCTION_WINDOW_SECS) return;
    const text = segment.text.normalize('NFC');

    for (const pattern of PATTERNS) {
      for (const match of text.matchAll(pattern.regex)) {
        const captured = match[1];
        if (!captured) continue;
        const name = cleanCapturedName(captured);
        if (!name) continue;
        // What follows the name as it was kept.
        const nameAt = (match.index ?? 0) + match[0].lastIndexOf(captured);
        const rest = text.slice(nameAt + name.length);
        if (/^['’]s(?![\p{L}])/iu.test(rest)) continue;
        if (pattern.thirdPerson?.test(rest)) continue;
        const confidence = pattern.boosted !== undefined && BOOST.test(rest) ? pattern.boosted : pattern.confidence;
        const key = `${speaker}\u0000${name.toLocaleLowerCase()}`;
        const existing = best.get(key);
        if (!existing || confidence > existing.confidence) {
          best.set(key, {
            speaker,
            name,
            segmentIndex: existing ? Math.min(existing.segmentIndex, segmentIndex) : segmentIndex,
            confidence,
          });
        }
      }
    }
  });

  return [...best.values()].sort((a, b) => a.segmentIndex - b.segmentIndex || b.confidence - a.confidence);
}
