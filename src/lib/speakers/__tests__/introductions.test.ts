import { describe, it, expect } from 'vitest';
import {
  INTRODUCTION_WINDOW_SECS,
  findIntroductions,
  type IntroductionSegment,
} from '@/lib/speakers/introductions';

/** One line said by `speaker` at `start` seconds. */
function line(text: string, speaker: string | null = 'speaker-1', start = 0): IntroductionSegment {
  return { start, end: start + 4, text, speaker };
}

/** The names found in one line, in order. */
function namesIn(text: string): string[] {
  return findIntroductions([line(text)]).map((intro) => intro.name);
}

describe('findIntroductions — English', () => {
  it.each([
    ['Hi everyone, my name is Anna Berg and I lead the design team.', 'Anna Berg'],
    ['My name is Erik.', 'Erik'],
    ["My name's Priya Natarajan, I joined last month.", 'Priya Natarajan'],
    ['Hello, this is Anna from marketing.', 'Anna'],
    ['This is Erik Lund speaking.', 'Erik Lund'],
    ['Okay, this is Jean-Pierre.', 'Jean-Pierre'],
    ["Hi, I'm Sara, I work with Erik on the backend.", 'Sara'],
    ['I am Maria Lopez Garcia and this is my first week.', 'Maria Lopez Garcia'],
    ["Good morning. I'm O'Brien from the Dublin office.", "O'Brien"],
    ['Anna here.', 'Anna'],
    ['Hi, Anna here from the Stockholm office.', 'Anna'],
    ['Yes, Erik here, can you hear me?', 'Erik'],
    ['Thanks for that. Sara here, I have a question.', 'Sara'],
    ['Hello everyone, Johan here.', 'Johan'],
    ['And Erik here, hello.', 'Erik'],
  ])('%s → %s', (text, name) => {
    expect(namesIn(text)).toEqual([name]);
  });

  it.each([
    'This is great, thanks.',
    'this is really important for the budget',
    'This is Monday we are talking about.',
    'I think this is March, not April.',
    "I'm sorry, could you repeat that?",
    "I'm Swedish, so bear with my English.",
    "I'm not sure this is right.",
    "I'm OK with that.",
    'I am Head of Sales in the Nordics.',
    "This is Anna's idea, not mine.",
    "I'm Erik's manager.",
    'This is Anna, our new designer.',
    'This is Erik who joined us last week.',
    'This is Sweden we are talking about.',
    'This is Stockholm calling.',
    'This is Teams, not Zoom.',
    'Is everyone here?',
    'Right here.',
    'Over here, look.',
    'Come here.',
    'Nobody here has seen it.',
    'Still here.',
    'Everyone here agrees.',
    'We are all here.',
    'Anna here will show you the numbers.',
    'And Anna here will show you the numbers.',
    'And everyone here knows that.',
    'So here we are.',
    'I gave Anna here the report.',
    'My name is on the list already.',
    'What this is About is the budget.',
    'This is the plan.',
    'I AM HERE.',
  ])('finds nobody in: %s', (text) => {
    expect(namesIn(text)).toEqual([]);
  });

  it('takes at most three name words, and only capitalised ones', () => {
    expect(namesIn('My name is Anna Maria Berg Lindqvist and I am new.')).toEqual(['Anna Maria Berg']);
    expect(namesIn('My name is Anna and I am new.')).toEqual(['Anna']);
    expect(namesIn('my name is anna')).toEqual([]);
  });

  it('is more certain of "my name is" than of "this is", and of "this is X speaking" than of a bare "this is X"', () => {
    const [named] = findIntroductions([line('My name is Anna.')]);
    const [bare] = findIntroductions([line('This is Anna.')]);
    const [speaking] = findIntroductions([line('This is Anna speaking.')]);
    expect(named.confidence).toBeGreaterThan(speaking.confidence);
    expect(speaking.confidence).toBeGreaterThan(bare.confidence);
    expect(bare.confidence).toBeGreaterThan(0);
    expect(named.confidence).toBeLessThanOrEqual(1);
  });
});

describe('findIntroductions — Swedish', () => {
  it.each([
    ['Hej, jag heter Anna Berg och jobbar med design.', 'Anna Berg'],
    ['Jag heter Åsa.', 'Åsa'],
    ['Hej allihopa, mitt namn är Örjan Ek.', 'Örjan Ek'],
    ['Mitt namn är Erik Lund och jag är ny här.', 'Erik Lund'],
    ['Hej, det här är Anna från ekonomi.', 'Anna'],
    ['Ja, det här är Björn.', 'Björn'],
    ['Det här är Ann-Sofie och jag ringer från Göteborg.', 'Ann-Sofie'],
    ['Anna här.', 'Anna'],
    ['Hej, Erik här.', 'Erik'],
    ['Hej alla, Åsa här från supporten.', 'Åsa'],
    ['Tack för det. Johan här, jag har en fråga.', 'Johan'],
    ['Och Erik här, hej.', 'Erik'],
  ])('%s → %s', (text, name) => {
    expect(namesIn(text)).toEqual([name]);
  });

  it.each([
    'Det här är bra, tack.',
    'det här är viktigt för budgeten',
    'Det här är Annas förslag.',
    'Det här är Sverige vi pratar om.',
    'Det här är Stockholm.',
    'Det här är Anna, vår nya designer.',
    'Det här är Erik som började förra veckan.',
    'Kom här.',
    'Titta här.',
    'Alla här håller med.',
    'Ingen här har sett den.',
    'Vi är här.',
    'Redan här?',
    'Jag är här.',
    'Här är rapporten.',
    'Jag heter inte så.',
    'Mitt namn är inte med på listan.',
    'Anna här kommer att visa siffrorna.',
    'Det är måndag idag.',
    'Det här är Måndagens möte.',
  ])('finds nobody in: %s', (text) => {
    expect(namesIn(text)).toEqual([]);
  });

  it('keeps Swedish letters in the name exactly as written', () => {
    const [intro] = findIntroductions([line('Jag heter Göran Åkesson.')]);
    expect(intro.name).toBe('Göran Åkesson');
  });
});

describe('findIntroductions — attribution', () => {
  it('attributes the name to the label of the segment it was said in', () => {
    const found = findIntroductions([
      line('Welcome everybody.', 'me', 0),
      line('Hi, this is Anna from marketing.', 'speaker-2', 5),
      line('Jag heter Erik.', 'speaker-1', 12),
    ]);
    expect(found).toEqual([
      { speaker: 'speaker-2', name: 'Anna', segmentIndex: 1, confidence: expect.any(Number) },
      { speaker: 'speaker-1', name: 'Erik', segmentIndex: 2, confidence: expect.any(Number) },
    ]);
  });

  it('skips a segment nobody is credited with', () => {
    expect(findIntroductions([line('My name is Anna.', null)])).toEqual([]);
    expect(findIntroductions([{ start: 0, end: 2, text: 'My name is Anna.' }])).toEqual([]);
  });

  it('reads only the first ten minutes of each speaker, counted from that speaker’s own first words', () => {
    const late = INTRODUCTION_WINDOW_SECS + 30;
    const found = findIntroductions([
      line('Let us start.', 'speaker-1', 0),
      // speaker-1 said this 10.5 minutes after their first words: ignored.
      line('My name is Anna.', 'speaker-1', late),
      // speaker-2 only joined at minute 20: their first words count from there.
      line('Sorry I am late.', 'speaker-2', 1200),
      line('My name is Erik.', 'speaker-2', 1205),
    ]);
    expect(found.map((intro) => [intro.speaker, intro.name])).toEqual([['speaker-2', 'Erik']]);
  });

  it('reports a name once per speaker, at the best confidence it was heard, at its first position', () => {
    const found = findIntroductions([
      line('This is Anna.', 'speaker-1', 0),
      line('As I said, my name is Anna.', 'speaker-1', 20),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ speaker: 'speaker-1', name: 'Anna', segmentIndex: 0 });
    expect(found[0].confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('reports the same name for two speakers separately (the user decides)', () => {
    const found = findIntroductions([line('My name is Anna.', 'speaker-1', 0), line('This is Anna.', 'speaker-2', 9)]);
    expect(found.map((intro) => intro.speaker)).toEqual(['speaker-1', 'speaker-2']);
  });

  it('finds two introductions in one segment', () => {
    expect(namesIn('Jag heter Anna. And my name is Erik.').sort()).toEqual(['Anna', 'Erik']);
  });

  it('returns nothing for no segments, empty text, or text with no names', () => {
    expect(findIntroductions([])).toEqual([]);
    expect(findIntroductions([line('')])).toEqual([]);
    expect(findIntroductions([line('so the numbers are up, which is good')])).toEqual([]);
  });

  it('is fast on an hour of transcript', () => {
    const many: IntroductionSegment[] = Array.from({ length: 4000 }, (_, i) =>
      line('This is the part where we go through the quarterly numbers in some detail, Anna.', `speaker-${(i % 4) + 1}`, i),
    );
    const started = Date.now();
    expect(findIntroductions(many)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
