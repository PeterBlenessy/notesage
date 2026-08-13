# Age rating questionnaire

Store submission only. Answered from the app as it ships.

## Expected outcome: 4+

Every content question is **None**: no violence, sexual content, profanity,
horror, gambling, contests, drugs, or medical/treatment information. The app
has no social features, no user-to-user communication, and no content feed —
it renders the user's own files.

## The one judgement call: "Unrestricted Web Access"

**Answer: No.** But know why, because it is the question most likely to be
second-guessed, and answering it wrong is how a 4+ app becomes 17+.

The app has no browser: no address bar, no navigation, no arbitrary URL entry.
Three places touch the web, all narrow:

1. **The HTML viewer** renders `.html` files **already in the user's own
   library**, in a sandboxed frame. Scripts are off by default and behind an
   explicit setting; external resources can be blocked entirely.
2. **Share-sheet capture** fetches the single page the user chose to share, to
   turn it into a note. There is no way to browse onward from it.
3. **Remote images** in a note load from where the note points, like any
   markdown reader.

None of that lets a user navigate the open web from inside the app, which is
what the question is about. If a reviewer disagrees, the fallback is to answer
Yes and accept 17+ rather than argue — but the honest answer is No.

## Other questions

| Question | Answer |
| --- | --- |
| User-generated content | No — the user's own files only, never shared with other users |
| Ability to communicate with other users | No |
| Location sharing | No |
| Third-party advertising | No |
| Gambling / contests | No |
| Made for Kids | No — not aimed at children, though nothing in it is unsuitable |
