#!/usr/bin/env python3
"""Generate the fictional saved articles the iOS demo library is seeded with.

Everything here is INVENTED — titles, publications, bylines, URLs, prose. These
end up in App Store screenshots and on the website, so no real publisher's
article may ever appear in the set (see scripts/seed-ios-demo-library.sh).

Why generated rather than hand-written: the marketing set needs a library that
looks like someone actually uses it. Three articles photograph as an app nobody
has opened — half of every frame is empty. Fifteen with varied hero colours give
the listing and gallery something to be, and the gallery in particular is only
interesting when the thumbnails differ from one another.

Each hero is a ground plus ONE drawn idea tied to the piece — a shortening
list, a shelf of spines, a waveform. Not illustration: the job is that fifteen
tiles be told apart at the forty points a row actually draws them, and a set of
coloured rectangles cannot be. Needs Pillow and numpy.

    scripts/make-demo-articles.py content/demo-ios/Inbox
"""

from __future__ import annotations

import base64
import io
import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw

# (title, standfirst, site, ground top, ground bottom, motif, mark, paragraphs)
# Read time is DERIVED from the prose below (see main()), never asserted — an
# asserted figure drifts the moment a paragraph is added, and the figure is on
# every row of every screenshot.
ARTICLES: list[tuple] = [
    (
        "Reading on purpose",
        "Saving an article is not reading it. On the quiet arithmetic of a reading list, and how to keep one that does not accuse you.",
        "slowweb.example", (96, 156, 112), (28, 54, 42), "list", (226, 242, 230),
        [
            "A reading list grows faster than anyone reads. This is not a personal failing; it is arithmetic. Saving takes a second and reading takes twenty minutes, so any list left alone tends toward infinity.",
            "The usual fix is guilt, which does not work, or bankruptcy — delete everything and start again — which works once.",
            "A better habit is to read the list, not the articles: once a week, open it and decide what is still interesting. Most things are not, and admitting so is quick. What survives two passes is usually worth the twenty minutes.",
            "It helps to be honest about why things get saved. Very little of it is saved because we intend to read it. Most of it is saved because reading it right now would mean stopping something else, and saving is the socially acceptable way of not stopping.",
            "That is a perfectly good reason. The list is a way of deferring a decision we were not ready to make, and deferral is a legitimate move. The trouble starts when we forget that a deferred decision is still outstanding, and begin treating the list as a record of intent rather than a pile of postponements.",
            "A pile of postponements is not shameful. It is just a pile. The accusation only appears when we describe it as a promise.",
            "So the weekly pass is not really about reading. It is about converting postponements back into decisions: read it, keep it because I will want to find it, or let it go. Three outcomes, each of which takes about four seconds once you stop pretending there is a fourth.",
            "The fourth, of course, is leaving it exactly where it is for another week. Everyone does this. The trick is to notice when an item has survived six passes untouched, because at that point the item is telling you something clearer than any of your intentions: you are not going to read this, and you have known for a month and a half.",
            "What is left after a few months of this is a small list of things that genuinely interest you and a much larger library of things you were right to keep but wrong to queue. Those are different collections and they want different homes.",
            "The list should be short enough to read in one screen. The library can be as large as you like, because nothing in it is asking you for anything.",
            "That distinction — between what is waiting for you and what is simply kept — is the whole of it. A reading list that does not distinguish them will accuse you every time you open it, and you will stop opening it, which is how most reading lists end.",
            "There is a further wrinkle, which is that the list is not one list. Three quite different things get saved to it and they have nothing in common except the gesture that put them there.",
            "The first is work: something you need for a task with a date on it. This is not really reading-list material at all — it belongs with the task, and it will be read whether or not it is on any list, because something else is forcing it.",
            "The second is curiosity: something you want to read for no reason beyond wanting to. This is the only category the list is actually for, and it is the one that gets squeezed out, because it never has a deadline and everything else does.",
            "The third is anxiety: something you feel you ought to have read. Industry commentary, the piece everyone is discussing, the long investigation you will certainly never finish. This is the category that grows fastest and is read least, and it is the entire source of the list's accusing quality.",
            "Separating them costs nothing and changes everything. Once the anxiety items are in their own place, you can look at that place honestly about once a month and delete all of it, which is the correct action and takes under a minute when the items are together and is impossible when they are interleaved with things you actually want.",
            "The curiosity list, left alone, turns out to be short. Ten or fifteen things at a time. It is a pleasure to open, it takes two minutes to scan, and you will read most of it eventually, because nothing in it is an obligation.",
            "There is a temptation at this point to build the separation into software: tags, folders, rules, a weekly digest. Resist it for a while. The separation is a judgement made at the moment of saving, and the judgement is the useful part; automating it mostly produces a system that classifies things confidently and wrongly.",
            "A better first step is simply to notice, each time you save something, which of the three it is. Most people find the ratio shocking. Something like one in six is curiosity; the rest is anxiety wearing a coat.",
            "That ratio also explains why reading lists fail in a way that feels personal. If five out of six items are things you never wanted to read, then an unread list is not evidence of a failure of discipline. It is an accurate record of what you actually wanted, and the only failure was in the saving.",
            "Which points at the real intervention, and it is not a better list. It is a smaller amount of saving: a two-second pause before the gesture, in which you ask whether you want this or merely feel you should.",
            "The pause fails often. That is fine. A list of forty items where fifteen were genuinely wanted is a far better object than a list of two hundred where fifteen were, and the fifteen are the same fifteen in both cases.",
            "None of this is a system, and it will not survive contact with a busy fortnight. The weekly pass will be skipped, the categories will blur, and the anxiety items will creep back in among the others. This is expected. The habit is not a state to be maintained but a thing you return to, and the return takes about ten minutes.",
            "The one rule worth keeping through the lapses is the last one: never let the list become a thing you avoid opening. The moment opening it feels like being shown a bill, delete enough of it that it does not, whatever that costs. An empty list you open is worth more than a complete one you do not.",
        ],
    ),
    (
        "The quiet hours",
        "Why deep work resists scheduling, and what to do about the two hours a day that actually belong to you.",
        "themargin.example", (84, 116, 196), (24, 34, 62), "moon", (224, 232, 255),
        [
            "Calendars are good at reserving time and bad at reserving attention. An hour marked “focus” is still an hour anyone can interrupt, and the interruption costs more than the hour.",
            "The people who get long work done rarely have emptier calendars. They have earlier mornings, or later evenings, or a door.",
            "What they share is not discipline but a boundary somebody else recognises.",
            "This is why the advice to “block time” so often fails. A block in a shared calendar is a request, and requests are negotiable. A closed door is a fact. The difference is not willpower; it is whether the boundary exists in the world or only in your intentions.",
            "The hours before other people are awake work for the same reason. They are not more productive hours in any biological sense — plenty of people do their best thinking at eleven at night — but they are hours during which the number of possible interruptions is close to zero, and that turns out to matter more than alertness.",
            "Attention has a long ramp. Fifteen or twenty minutes in, something changes: the problem stops being a list of parts and starts being a shape. Everything before that is loading. This is why a forty-minute block interrupted once is worth much less than half of an uninterrupted eighty, and why a day of meetings with gaps between them produces nothing despite containing several hours of nominally free time.",
            "The gaps are not free time. They are loading time that never finishes.",
            "Once you see it this way the scheduling problem inverts. The question is not how many hours to reserve but how few interruption sources can be got rid of entirely, because one source firing once destroys the whole block.",
            "In practice that means something cruder than any productivity system: a device left in another room, a client closed rather than muted, a physical location where the people who might ask you something are not.",
            "Two hours is usually enough. Very few people need more than two hours a day of the deep kind, and almost nobody sustains four. The ambition to work like that all day is what makes people abandon the attempt when they discover they cannot.",
            "Two good hours and a normal working day around them is not a compromise. For most work it is the ceiling, and reaching it reliably is a larger achievement than reaching further occasionally.",
            "The rest of the day can be as fragmented as it likes. Answering things, moving things along, talking to people — none of that needs the ramp, and pretending it does is how the two hours get spent on email.",
            "The word “deep” has done some damage here, because it suggests a single mode that work is either in or out of. What actually varies is the size of the thing being held in mind, and there are at least three sizes, each with its own requirements.",
            "The smallest is the task you can hold entirely: a paragraph, a function, a reply that needs care. Ten minutes of quiet is enough, interruptions cost little, and a fragmented day is a perfectly adequate container. Most work is this size, and treating it as though it needed a protected morning is how protected mornings get wasted.",
            "The middle size is the thing with parts that must be kept consistent — a section, a design with three constraints, an argument with a structure. This is where the twenty-minute ramp appears, and where a single interruption genuinely costs the hour rather than the minute.",
            "The largest is the one nobody schedules, because it cannot be: the problem you have been carrying for weeks, which resolves in the shower or on a walk. This size does not want protected time at all. It wants unprotected time — a period where nothing is being attended to, which is precisely what a well-defended morning eliminates.",
            "Confusing the middle and the largest is a common and expensive mistake. People who have successfully defended two hours a day often find the hard problems stop resolving, and conclude they need more hours, when what they have removed is the slack the problems were resolving in.",
            "The practical shape, then, is not a wall of deep work. It is a couple of protected hours for the middle-sized things, an ordinary fragmented day for the small ones, and — deliberately — some time in which nothing at all is being achieved.",
            "That last part is the hardest to hold, because it is indistinguishable from idleness while it is happening, and it produces nothing that can be pointed at. The walk that solved the problem looks exactly like the walk that did not.",
            "There is also the question of what the protected hours are protected from, and the honest answer is usually not other people. It is the small satisfying tasks that are always available and always feel like progress: the reply that takes four minutes, the thing that needs tidying, the message that could be sent now.",
            "These are more dangerous than interruptions because they arrive with a sense of virtue. Nobody feels guilty about answering a colleague quickly, and the aggregate of quick answers is a day in which the middle-sized work did not start.",
            "The only defence anyone seems to sustain is sequence: the hard thing first, before the small satisfying tasks have accumulated enough to be plausible. Not because mornings are magic, but because at eight there is nothing else legitimately demanding to be done, and by eleven there always is.",
        ],
    ),
    (
        "Notes that answer back",
        "A short argument for writing notes you expect to re-read, and the small formatting habits that make that possible.",
        "fieldnotes.example", (198, 118, 72), (58, 34, 24), "reply", (255, 236, 222),
        [
            "Most notes are written for the person writing them, at the moment they are written, and are useless a month later.",
            "The fix is not a system. It is a sentence: before closing a note, write the one line you would want to read if you found it in a year.",
            "That line is almost never the summary. It is usually the reason you cared.",
            "You can tell the two apart by whether the line would make sense to a stranger. A summary would. The reason you cared usually would not, because it refers to what you were doing that week, what you had just been arguing about, what the note was going to be for.",
            "That context is exactly what evaporates. The facts survive — they are on the page, and they were probably available elsewhere anyway. What does not survive is why these particular facts were worth writing down, and without that the note is just a worse copy of its source.",
            "A note that answers back is one that reconstructs its own context on sight. Three habits do most of the work.",
            "Put the conclusion first. Not the topic, the conclusion. “Meeting notes: pricing” tells you nothing; “We are not going to do usage-based pricing, because of the support load” tells you everything, including whether to keep reading.",
            "Write down what you disagreed with. Agreement is forgettable — it merges into what you already thought. Disagreement is where the note has information, and it is almost always the part left out, because at the time it felt like an opinion rather than a fact.",
            "Date the thing, and say what you were doing. Two words is enough. A note that begins “while writing the onboarding email” has restored more context than a paragraph of careful summary.",
            "None of this takes longer than thirty seconds, and none of it requires deciding in advance where the note will live, which is the part of note-taking that people mistake for the method.",
            "The filing is not the method. The filing is what you do when you already know why the thing matters, and if you know that, almost any filing works.",
        ],
    ),
    (
        "Against the inbox",
        "Email won because it was simple, and lost because it was simple. What replaced it, and what did not.",
        "slowweb.example", (150, 104, 196), (42, 26, 58), "grid", (240, 228, 255),
        [
            "Every tool that promised to kill email became email: a list of things other people put there, ordered by when they did it.",
            "Ordering by arrival is the original sin. It makes urgency and importance the same axis, and they are not.",
            "The chat applications were the clearest case. They were sold as the end of the inbox and they are an inbox with a faster clock, which is worse in the one dimension that mattered and better in several that did not.",
            "What actually changed was the unit. Email's unit is a letter — addressed, composed, expected to stand alone. Chat's unit is a line, and a line cannot stand alone, so the medium replaced a hundred letters a day with a thousand fragments and called it lighter weight.",
            "The fragments are lighter individually and much heavier in aggregate, because each one costs a small decision and the decisions do not compress.",
            "Meanwhile the useful part of email survived every attempt to replace it: a plain address anyone can send to, no account required, no shared workspace, no invitation. Nothing built since has matched that, and most of what has been built since has deliberately not tried, because an open address cannot be owned.",
            "This is the shape of the thing. The inbox is bad because it is open, and it is valuable because it is open, and every product that fixes the badness does so by closing it.",
            "So the interesting question is not what replaces the inbox but what sits next to it. Something that is not ordered by arrival. Something where the things you put there yourself are not mixed with the things other people put there, because those are different collections with different obligations and the only reason they ever shared a list is that both happened to arrive as messages.",
            "Separate them and most of the anxiety goes. A list of things you chose is a pleasure to open. A list of things that arrived is a chore. Put them in one list and the chore wins, every time, because the arriving items are the ones with someone waiting.",
            "Very little software makes this separation, partly because arrival is easy to sort by and choice is not, and partly because a list of your own choices does not generate notifications, and a product that does not notify is difficult to keep alive.",
        ],
    ),
    (
        "What a library is for",
        "On keeping things you will never read again, and why that is not hoarding.",
        "themargin.example", (72, 168, 166), (18, 48, 50), "shelf", (216, 248, 246),
        [
            "A personal library is not a queue. Most of it is not there to be read; it is there to be found, once, when something else makes it relevant.",
            "The test is not “will I read this” but “would I want to find this”. Those are very different questions and only one of them causes guilt.",
            "The queue question is about your future time, which is scarce and which you will consistently overestimate. The finding question is about your future attention, which you cannot schedule at all — you do not know now what you will be curious about in three years, which is exactly why keeping things works.",
            "Libraries are bets on that ignorance. A book kept for a decade and opened once, at the right moment, has earned its shelf several times over, and there was no way to know in advance which book it would be.",
            "This is why culling a library by reading probability is a mistake. It optimises for the wrong variable, and it reliably discards the strange, specific things — the ones with the lowest chance of being read and the highest value if they are.",
            "The parts to cull are different. Duplicates. Things kept out of obligation to whoever recommended them. Things kept because they were expensive. Reference material that has been superseded and will actively mislead you if found. That last category is the only genuinely dangerous one, and almost nobody prunes it, because superseded things look exactly like current things from the outside.",
            "What makes a library work is not size but the quality of its index, and the index is mostly in your head. You do not remember the contents; you remember that there was something, roughly here, about roughly this.",
            "Which means the practical requirement is modest. Enough structure that a vague memory can be converted into a location in under a minute. Folders are usually enough. Search covers the rest, provided the things are in a format search can see, which is the strongest argument for keeping text as text.",
            "Hoarding is the failure mode where the index breaks down: the collection grows past the point where you know what is in it, and then nothing can be found, and the collection has become storage.",
            "The difference is not quantity. It is whether you could still answer the question “do I have something about this”. When the answer becomes “probably, somewhere”, the library has stopped working, and the fix is not to delete things but to walk the shelves until you know them again.",
            "There is a practical question underneath all this, which is what the library is made of. A collection of links is not a library; it is a list of addresses, and addresses expire. The reported figures vary, but something like a tenth of the web's links break each year, and the material you most want to have kept — the personal site, the small publication, the post that was never syndicated — is exactly the material least likely to survive.",
            "So a library that matters has to hold copies. This feels excessive until the first time a link you needed is gone, after which it feels obvious.",
            "Holding copies changes the economics in a way worth being explicit about. A link costs nothing and is worth nothing; a copy costs a few hundred kilobytes and is worth whatever the thing was worth. At the scale of a personal collection the storage is free — ten thousand saved articles is a few gigabytes, which is less than a phone's photo roll from one holiday.",
            "Nobody has ever run out of room for text. What people run out of is the ability to find it.",
            "Which brings the argument back to the index, and to the one structural decision that actually matters: whether the collection is searchable by its contents or only by its labels. A collection searchable by content forgives almost any filing mistake, because the words in the document are themselves the index. A collection searchable only by title and tag punishes every filing mistake permanently.",
            "This is the strongest practical argument for keeping things in formats that a search tool can read. Not portability in the abstract, but the specific fact that a vague memory of a phrase is the most common way anyone actually re-finds something, and it only works if the phrase is visible to something other than the eye.",
            "The second structural decision is where the library lives, and here the answer is less obvious than it looks. A library on a service is subject to that service's continued existence and continued interest in the feature. A library in a folder is subject only to you remembering to back it up, which is a smaller and more honest risk.",
            "Neither is safe. But the failure modes differ in an important way: a folder degrades — you lose a year to a dead drive — while a service ends, taking everything at once, on a schedule set by someone else.",
            "The last thing worth saying is about size and shame, because most people's relationship with their saved material is faintly guilty. Four thousand articles feels like too many. It is not too many; it is about eight a week for ten years, which is a normal reading life, and it would be a small shelf if it were paper.",
            "The guilt comes from the queue framing again — from reading the collection as a backlog rather than as a record. A shelf of books you have read does not accuse you. Neither should a folder of things you found worth keeping, and the fact that it does is an artefact of software that shows you a list with unread counts on it.",
        ],
    ),
    (
        "Plain text outlives us",
        "Formats come and go. The ones that survive are the ones you can read with your eyes.",
        "fieldnotes.example", (206, 168, 78), (54, 44, 22), "mono", (255, 246, 214),
        [
            "Every proprietary format is a bet that its company outlives your interest in the file. That bet has a poor record.",
            "Markdown is not elegant. It is legible without software, which is a different and more durable virtue.",
            "The test is simple and worth applying to anything you intend to keep: open the file in the crudest viewer you have. If what you see is your content with some punctuation around it, the format will survive. If what you see is binary noise, you are depending on a program, and programs are the least durable part of any system.",
            "This is not a prediction about bankruptcy. Formats die while their companies thrive — abandoned, migrated, quietly dropped from the importer two versions later. The file does not become unreadable in a dramatic moment. It becomes slightly inconvenient, then inconvenient enough that you never quite get round to it.",
            "The counter-argument is real. Plain text cannot express everything. Tables are awkward, images live elsewhere, anything with a layout is either lost or encoded in a convention some other tool will not honour. For a certain class of document these are not acceptable losses.",
            "But most of what people keep is not that class of document. It is prose with headings, and prose with headings is exactly what plain text does well.",
            "The subtler point is what the format does to the writing. A rich editor invites you to spend attention on appearance, and appearance is the cheapest way to feel that a document is progressing. Text without formatting gives you nowhere to put that energy except the sentences.",
            "This is not a moral claim about focus. It is a claim about where the affordances point, and the affordances of a plain file point at the words.",
            "There is also the matter of tools. A text file can be edited by anything, searched by anything, diffed, scripted, and moved without ceremony. That is not portability in the abstract; it is the practical fact that you are never blocked on a program being installed, licensed, or still supported.",
            "Thirty years is the horizon worth designing for. Almost nothing on a computer today will open a thirty-year-old file from a defunct word processor. All of it will open a thirty-year-old text file, and will still open it in another thirty, because the cost of that support is essentially zero and nobody has to decide to keep paying it.",
        ],
    ),
    (
        "The case for reading slowly",
        "Speed-reading works, in the sense that you finish. On what finishing is worth.",
        "slowweb.example", (186, 92, 126), (46, 24, 36), "ripple", (255, 226, 236),
        [
            "You can double your reading speed in a fortnight. What you cannot double is the rate at which you change your mind, and that was the point of reading.",
            "Slow reading is not a virtue in itself. It is simply what understanding costs when the thing is worth understanding.",
            "The speed techniques are not frauds. Subvocalisation really does slow you down, regression really is often wasted, and a wider fixation really does take in more per glance. Apply all three and you will get through the page faster, and you will retain the shape of the argument.",
            "The shape is not the argument. The shape is what you could have got from the summary, and if the shape is all you needed then the summary was the right thing to read and the article was a waste of both speeds.",
            "What slow reading buys is the sentence you stop at. Somewhere in a good piece there is a claim that does not fit what you already think, and the entire value of reading it is in noticing that and sitting with it for thirty seconds. At speed, that sentence goes past looking like all the others, because at speed everything looks like all the others.",
            "This suggests the real skill is not a speed but a gearbox. Most text should be read fast, because most text is filler, throat-clearing, or restatement, and reading it slowly is not respectful, only slow.",
            "The judgement is knowing when to drop a gear, and it is a judgement you can practise. The signals are reasonably consistent: a claim you want to argue with, a distinction you had not made, an example that does not seem to support the point being made with it.",
            "Any of those is worth a stop. Not a re-read — a stop, in which you look away from the page and try to say the thing back in your own words. If you cannot, you did not have it, and thirty seconds has just saved you from believing you did.",
            "This is also the honest answer to the volume problem. Reading more is rarely the goal anyone actually has; reading more of what matters is. And those are in tension, because the things that matter are precisely the ones that are slow.",
            "A hundred articles skimmed and three read properly is, for most purposes, a better year than two hundred skimmed. The three are the ones you will still be using.",
        ],
    ),
    (
        "Small tools, sharp edges",
        "Software that does one thing is easier to trust and harder to sell.",
        "themargin.example", (110, 158, 96), (28, 44, 32), "edges", (228, 246, 222),
        [
            "A tool that does one thing can be understood completely. A tool that does nine can only be understood locally, which means every use is a small act of faith.",
            "This is why people keep returning to text files, and why the returning never quite sticks.",
            "It does not stick because a small tool is a worse business. Its ceiling is low, its users have nothing further to buy, and its whole advantage — that it refuses to grow — is the thing every incentive pushes against.",
            "So small tools get bigger, and the version that was a pleasure becomes the version with a sidebar, and a workspace, and an onboarding flow, and somewhere in there the property that made it trustworthy is gone. Not through incompetence; through success.",
            "The property worth naming is completeness of model. With a small tool, you can hold the whole thing in your head: what it does, what it will not do, where your data is, what happens if it stops being maintained. That completeness is what trust actually consists of, and it is not a feeling about the vendor.",
            "Large tools cannot offer it at any price. The best they can do is make the part you use feel small, which works until the day you need to know what happens at the edge.",
            "The edges are where the difference shows. A small tool has sharp ones: it says no, clearly and early, and you route around it. A large tool has soft ones: it almost does what you want, in a way that is not quite right, and the not-quite-rightness is discovered after you have committed.",
            "Sharp edges are a kindness. Being told no in the first minute costs you a minute; being told no in the ninth month costs you the migration.",
            "The practical version of this is not asceticism. It is a preference, when choosing between two tools that both do the job, for the one that does less, and a suspicion of any feature list long enough that you would not read it.",
            "And when a small tool starts to grow, the useful question is not whether the new features are good but whether the old ones still work the way they did, because that is the promise being spent.",
        ],
    ),
    (
        "Attention and devotion",
        "The oldest writing about concentration is religious, and it is better than the productivity literature.",
        "fieldnotes.example", (112, 106, 204), (30, 30, 62), "rays", (228, 226, 255),
        [
            "Monastic writing on attention is unembarrassed about difficulty. It assumes the mind wanders, treats that as ordinary, and gives the practice anyway.",
            "The modern equivalent assumes a technique will fix it, and sells the technique.",
            "The difference in posture matters more than the difference in content. If wandering is a defect, every instance is evidence of failure, and the failures accumulate into the belief that you are not someone who can concentrate. If wandering is simply what minds do, the instance is not evidence of anything and you return to the work, which is the only move that was ever available.",
            "The desert fathers had a word for the particular restlessness that arrives in the middle of a long task: acedia. Not laziness — they were clear it was not laziness, because it afflicted people who were working. It is the sensation that this work is not the right work, that something elsewhere would be more worthwhile, arriving reliably at the point where the work stops being novel and has not yet started being finished.",
            "Anyone who has abandoned a project in month four has met it. The modern framing calls it a motivation problem and prescribes a better goal, which is precisely the move acedia wants you to make: the search for better work is the form the avoidance takes.",
            "Their prescription was flatter and stranger. Stay at the task. Not because staying is virtuous but because the feeling is information about the hour, not about the task, and acting on it treats a passing state as a verdict.",
            "There is an epistemic claim buried here that the productivity literature never makes: that your judgement about what is worth doing is worst exactly when it feels most urgent and most clear.",
            "The other inheritance is the offices — fixed hours, the same every day, whether or not anyone felt like it. Not scheduling in the calendar sense. The hours were not chosen for optimal alertness and could not be moved for a better opportunity, and that immovability was the point, because a practice that yields to circumstance is not a practice.",
            "What the modern literature has that the old does not is measurement, and it is a real advance for a narrow class of questions. What it lacks is any account of what to do when the technique does not work, which is most of the time, for most people.",
            "The older material has an answer, and it is not encouraging, and it is probably correct: do it anyway, badly, today, and again tomorrow.",
            "It is worth being concrete about what the old material actually prescribes, because the modern retelling tends to soften it into mindfulness, which it is not.",
            "The first prescription is fixity. A time, the same time, and a place, the same place, both chosen for their availability rather than their quality and then not revisited. The reasoning given is not that fixed conditions produce better attention; it is that the deliberation about conditions is itself the enemy, and any arrangement that ends deliberation beats a better arrangement that does not.",
            "Anyone who has spent a morning optimising their setup instead of working will recognise the diagnosis.",
            "The second is the treatment of the wandering mind, and this is where the literature is most unlike its modern descendants. There is no technique for preventing the wandering, because it is not considered preventable. The instruction is only about what to do afterwards: return, without commentary.",
            "The commentary is the part singled out for warning. Noticing that you have drifted and then spending thirty seconds on what that says about you is described as a second and worse drift, and the writers are unusually pointed about it, presumably because it was as common then as now.",
            "The third is the insistence that the practice is not supposed to feel like anything. Dryness — the state in which nothing is happening and the whole thing seems pointless — is treated as an ordinary phase rather than a signal, and the instruction during it is to continue at the same rate. This is the exact opposite of every modern framework, all of which are organised around motivation and all of which therefore collapse when motivation does.",
            "There is a fourth thing, less often quoted, which is the flat assertion that attention is trained by the body more than the will: posture, hours, what is eaten, how much is slept, what the room contains. The modern literature has rediscovered this and presents it as neuroscience, which is fine, but the observation was available without instruments to anyone who watched themselves carefully for forty years.",
            "What makes the whole corpus useful rather than merely quaint is its unit of time. These were not week-long programmes. The practices described were meant to be kept for decades, and the advice is shaped accordingly: nothing in it depends on enthusiasm, nothing requires equipment, and nothing promises an outcome on a schedule.",
            "Advice built to survive forty years looks strange next to advice built to survive a fortnight. It is less exciting, and it makes no claims that could be tested in a month, and it has one significant advantage, which is that people have in fact kept it for forty years.",
            "The obvious objection is that monks had conditions nobody now has: no employer, no children, no telephone, a community organised entirely around the practice. This is true and it is a real limit on the transfer.",
            "But the parts that transfer are the parts that were never about the conditions — the refusal to treat wandering as failure, the refusal to negotiate with the hour, the refusal to interpret dryness. Those are stances rather than schedules, and a stance can be held on a commuter train.",
            "What does not transfer is the community, and that may be the thing that actually did the work. Every account of sustained practice, religious or otherwise, involves other people who expected it and would notice its absence. The productivity literature knows this too, which is why it sells accountability, and the reason the sold version works less well is presumably that the expectation is purchased rather than owed.",
        ],
    ),
    (
        "Offline is a feature",
        "What you can do on a train is a good test of whether you own your tools.",
        "slowweb.example", (82, 154, 190), (22, 44, 56), "dashed", (220, 240, 252),
        [
            "The question is not whether the network is reliable. It is whether the thing you are working on exists without it.",
            "Most of what people call cloud software is a remote database with a login screen in front of it.",
            "That arrangement is fine while the connection holds and the account is current, and those are two separate dependencies, and the second one is the one that catches people. A tunnel is a temporary problem. A suspended account, a changed plan, a company acquired and wound down — those are not temporary, and in each case the work is on the other side of a door you no longer have a key to.",
            "The train test is a proxy for ownership, and it is a good one because it is so easy to run. Turn the network off. What can you still open, read, edit, and search?",
            "Everything that passes is yours in a meaningful sense. Everything that fails is rented, and the rent is fine, and it should be a decision rather than a discovery.",
            "Local-first architectures have made this less of a trade than it was. The work sits on the device and syncs when it can, which gives you the collaboration without the dependency, and means the offline case is the normal case rather than a degraded mode someone had to remember to build.",
            "The tell is what happens in an aeroplane. Software built network-first shows a spinner and then an error. Software built local-first shows your documents, because they were never anywhere else.",
            "There is a performance argument too, and it is larger than it looks. A local read is a few milliseconds and a network read is a few hundred on a good day, and the difference is not merely faster — it is the difference between a tool that responds and a tool you wait for. Waiting changes behaviour: you batch your actions, you avoid exploratory moves, you stop trying things.",
            "None of this is an argument against sync. Sync is how the work reaches your other machine and your colleagues, and doing without it is a real cost paid for a mostly symbolic benefit.",
            "The argument is only about which way round the dependency runs: whether the network makes your work better, or whether your work exists at its pleasure.",
        ],
    ),
    (
        "How to keep a commonplace book",
        "A four-hundred-year-old habit that survives every change of medium.",
        "themargin.example", (196, 132, 70), (52, 34, 20), "pages", (255, 238, 216),
        [
            "The commonplace book is not a diary. It holds other people's sentences, copied out by hand, with no obligation to say anything about them.",
            "Copying is the whole method. What you are willing to write out is a far better filter than what you are willing to highlight.",
            "Highlighting costs nothing, which is the problem: a free action produces no signal. By the end of a book the highlights mark everything that was mildly interesting at the moment of reading, which is a record of your attention and not of the book's value.",
            "Copying costs thirty seconds, and thirty seconds is enough friction to make you ask whether the sentence is worth it. Most are not. The ones that survive that question are a genuinely different set, and much smaller.",
            "The historical practice was not organised the way people assume. There was no taxonomy to maintain. Entries went in as they came, in order, and finding things again was the reader's problem, solved by re-reading their own book — which was the point, because re-reading your own book is how the entries start talking to each other.",
            "Something copied in March sits next to something copied in June, from a different author on a different subject, and the juxtaposition is the whole yield. That does not happen in a well-organised system, where the two would be filed apart and never meet.",
            "So the advice is to resist categorising. Chronological is enough. If you must add structure, add it at the end of the year, as a page of pointers to the entries that turned out to matter, which is a judgement you could not have made at the time.",
            "The second rule is attribution, always, with enough detail to find the source again. Not for honesty — for yourself in five years, when a sentence has become something you believe and you need to know whether it came with an argument attached.",
            "The third is the hardest: no commentary at the time of copying. The urge to explain why a sentence matters is strong and the explanation is almost always worse than the sentence. If the thought persists, it belongs in its own entry, in your own voice, dated, where it can be judged as yours.",
            "What accumulates is not a reference work. It is a record of what you found worth the effort of a fair copy, which is the closest thing to an honest account of what you actually thought, as opposed to what you remember thinking.",
        ],
    ),
    (
        "Writing for one reader",
        "Address a specific person and the prose fixes itself.",
        "fieldnotes.example", (146, 98, 178), (38, 24, 48), "one", (240, 226, 250),
        [
            "Writing for an audience produces the voice of someone addressing an audience, which nobody enjoys reading.",
            "Pick one person who would be interested. The register lands, the hedging disappears, and the jokes stop being for everyone.",
            "The mechanism is not mysterious. An audience is an average, and you cannot write a sentence to an average — you can only write a sentence that offends none of it, which is a different and much worse instruction.",
            "Every hedge in bad prose is a defence against a member of the imagined crowd. The qualifier is for the pedant, the definition is for the newcomer, the caveat is for the specialist who will object. Take away the crowd and take away the defences, and what is left is shorter by a third.",
            "The reader you pick should be real. Not a persona, not a segment — a person whose face you can picture and whose objections you can hear. It does not much matter who, as long as they would plausibly care, and as long as you would be slightly embarrassed to bore them.",
            "That embarrassment does most of the editing. You will not write four paragraphs of background for someone who already has it. You will not explain the joke. You will get to the point, because they would visibly be waiting for it.",
            "The obvious worry is that the piece becomes too narrow — full of shared references, pitched at one level, useless to anyone else. In practice the opposite happens almost every time. Prose written to a person reads as addressed to whoever is reading it, and prose written to everyone reads as addressed to no one.",
            "The narrowness that actually excludes people is a different thing: unexplained jargon, assumed history, in-group signalling. Those come from writing for a group, not from writing for a person, and they are the natural failure of imagining a crowd who already agree.",
            "It also fixes the opening, which is where most pieces fail. Writing to one person you cannot begin with a throat-clearing paragraph about why the topic is important, because they would ask you to get on with it. You begin instead with the thing you wanted to tell them, which is nearly always the right first sentence and nearly always the one that was going to arrive on page two.",
            "If a piece is not working, the diagnosis to try first is not structure. It is to name the person, put the name at the top of the draft, and write the next paragraph to them.",
        ],
    ),
    (
        "The half-finished draft",
        "Why the middle of a piece of writing is where it is abandoned, and how to get through it.",
        "slowweb.example", (96, 174, 124), (26, 50, 38), "split", (226, 246, 232),
        [
            "Beginnings are easy because they are promises. Endings are easy because the work is done. The middle is where you discover the promise was wrong.",
            "Finishing is mostly the willingness to write a worse middle than you hoped for, and fix it afterwards.",
            "The discovery is real and it is not a failure of planning. You cannot know what the argument requires until you have tried to make it, and trying to make it is what the middle consists of. The outline was a guess, and the middle is where the guess meets the material.",
            "What makes it feel like failure is the comparison available at that exact moment. The beginning is polished, because you have been over it eleven times. The middle is raw. Held side by side, the middle looks like evidence that the piece is not working, when it is only evidence that it is not finished.",
            "So the first move is to stop reading from the top. Every pass from the beginning re-polishes the opening and arrives at the difficulty with the energy already spent, which is why abandoned drafts so often have immaculate first pages.",
            "The second is to lower the standard deliberately and visibly. Write the bad version of the paragraph — with the brackets in it, with the placeholder that says which example goes here — and move on. A bad paragraph in place is a solvable problem. A missing paragraph is not, because you cannot see the shape it has to fit.",
            "The third is to write the ending early, before the middle is done. Not the final wording; the claim you intend to land on. The middle is hard partly because it is being written toward an unknown destination, and a known destination converts an open-ended problem into a route.",
            "Often, writing the ending reveals that the destination has moved — that the piece now wants to land somewhere the opening does not promise. That is worth knowing on day two rather than day nine, and it is the single most valuable thing the ending-first habit produces.",
            "None of this makes the middle pleasant. It remains the part where the piece is at its worst and you have the most evidence that it will not work, and the feeling that it will not work is not a signal to be interpreted. It is simply what the middle feels like, every time, including the times it worked.",
            "The writers who finish are not the ones who avoid that feeling. They are the ones who have felt it often enough to stop treating it as news.",
        ],
    ),
    (
        "Listening to what you saved",
        "Text-to-speech stopped being a compromise about two years ago. A note on when it beats reading.",
        "themargin.example", (78, 142, 162), (20, 40, 46), "wave", (222, 240, 246),
        [
            "Synthetic voices crossed a threshold quietly. The tell is no longer the voice; it is the punctuation, which is where they still misread the sentence.",
            "For a long argument, listening is worse. For a list of things someone did, it is better, and it can happen while walking.",
            "The distinction that predicts it is whether you need to go backwards. Reading is random access; listening is a stream. Any text where understanding depends on holding two distant passages together is a text you will fail to follow at walking pace, and the failure is quiet — you keep hearing words and stop taking anything in.",
            "Narrative and reportage survive the stream because they were built for one. Argument, especially argument with structure, does not: the third premise only makes sense against the first, and by then the first is gone.",
            "There is a second axis, which is what else you are doing. Listening while walking is genuinely free time converted into reading time, and that is a real gain, not a compromise. Listening while working is not: the second task takes whatever the first leaves, and what it leaves is not enough for anything worth listening to.",
            "The honest use is therefore narrower than the marketing and larger than the sceptics allow. Perhaps a third of a normal reading pile is better heard than read, and it is a fairly predictable third.",
            "Where it becomes properly useful is as a second pass. Read the difficult thing, then hear it a week later while doing something else. The second pass costs no additional time and catches what the first missed, and hearing prose read aloud surfaces problems the eye slides over — a sentence that does not parse, a claim asserted twice in different words.",
            "That is why writers have read their work aloud for centuries, and the machine will do it now without getting tired or sympathetic.",
            "The remaining tells are worth knowing, because they are where you will be misled. Numbers and units are still unreliable. Quoted speech inside a longer sentence often loses its boundaries. Anything parenthetical is delivered at the same weight as the main clause, which inverts the meaning of about one sentence in fifty.",
            "One in fifty is a small error rate and a large one, depending on whether the sentence mattered. Which argues for the same rule as everything else: hear the things where being slightly wrong is cheap, and read the things where it is not.",
        ],
    ),
    (
        "Everything is a draft",
        "On publishing things that are not finished, and the anxiety that prevents it.",
        "fieldnotes.example", (210, 156, 92), (56, 40, 26), "echo", (255, 240, 220),
        [
            "The finished version does not exist. There is only the version you stopped working on, and the date you stopped.",
            "Saying so on the page turns out to lower the stakes for everyone, including the reader.",
            "The anxiety it addresses is specific. It is not the fear of being wrong — being wrong is survivable and usually interesting. It is the fear of being caught having believed something you no longer believe, as though a published sentence were a permanent claim about your judgement rather than a report of it on a Tuesday.",
            "A date fixes that entirely. Nobody holds a dated opinion against its author; the date makes the claim provisional in a way no amount of hedging can, and it does so without weakening the sentence itself.",
            "This is why hedged prose is the worse solution to the same problem. The hedges are an attempt to make the claim un-wrongable, and they succeed by making it un-interesting. A dated, unhedged claim is both stronger and safer, which is a rare combination and worth taking.",
            "The other half is the editing. If a piece can be revised after publication then publication is no longer the terminal event it feels like, and the thing that was blocking you — the sense that this is the last chance to get it right — is simply false.",
            "It was always false. It is just more obviously false when the revision history is visible.",
            "What this does not license is publishing carelessly. A draft in public is still a claim on someone's attention, and the calculation is unchanged: is this worth the ten minutes you are asking for. “It is a draft” answers the question of whether you must be right; it does not answer the question of whether the thing is worth reading.",
            "The distinction in practice is between unfinished and unconsidered. An unfinished piece has a point, arrives at it, and leaves parts of the case unmade. An unconsidered piece has not yet found the point, and no disclaimer rescues it.",
            "The test is whether you can say, in one sentence, what the reader gets. If you can, the rest is polish and the polish can happen in public. If you cannot, it is not a draft yet — it is notes, and notes are for you.",
        ],
    ),
]


# The sixteenth piece, and the only one not seeded into the library. Loop 2 of
# the landing page shows an article ARRIVING, and an article already in the
# Inbox cannot arrive — so this one is served over local HTTP, opened in
# Safari and shared in. Its title begins with "A " so that it sorts to the top
# of an alphabetical Inbox, which is a staging decision and is recorded as one
# in the site's MANUSCRIPT.md.
SHARED: tuple = (
    "A field guide to saving things",
    "On the small decision you make a dozen times a day, and how to make it better without making it slower.",
    "slowweb.example", (88, 132, 180), (22, 38, 56), "dashed", (222, 238, 252),
    [
        "Saving is the cheapest action on the internet and the least examined. It takes a second, it feels like progress, and nobody ever reviews whether it was the right call — which is how everyone ends up with a list they are afraid to open.",
        "The useful distinction is not between good and bad articles. It is between three quite different reasons for saving, which feel identical in the moment and behave nothing alike a week later.",
        "You save because you need it for something specific and dated. This is not reading-list material; it belongs with the task, and it will get read whether or not you file it anywhere, because something else is forcing the issue.",
        "You save because you actually want to read it. This is the only kind worth a list, and it is reliably the smallest share — something like one save in six, for most people who bother to count.",
        "Or you save because you feel you ought to have read it. The commentary everybody is discussing, the long investigation, the thing that would make you better informed. This category grows fastest, gets read least, and supplies all of the guilt.",
        "None of that is a character flaw. It is what happens when one gesture serves three purposes and nothing downstream tells them apart.",
        "The intervention is not a better list, and it is certainly not a better app. It is a two-second pause before the gesture, in which you notice which of the three you are doing. The pause fails often; it is still the highest-leverage two seconds available, because everything after it is downstream of a decision already made.",
        "What makes the pause possible is knowing the save is cheap to undo. If deleting something later feels like an admission, you will not delete it, and the list becomes an archive of your intentions rather than a queue of your interests.",
        "So the second habit is a standing permission: anything in the list may be deleted unread, at any time, without justification. Most reading lists die because their owner never granted themselves that.",
        "And the third is to keep what you delete. Not in the list — in a folder, where nothing is asking anything of you. Almost everything worth saving was worth keeping and not worth queueing, and the two have been confused because software has historically offered only one place to put things.",
    ],
)

def _bg(size, top, bottom):
    """A diagonal ground, as a numpy array — the canvas every motif sits on."""
    w, h = size
    gx = np.linspace(0.0, 0.45, w, dtype=np.float32)[None, :]
    gy = np.linspace(0.0, 0.55, h, dtype=np.float32)[:, None]
    t = (gx + gy)[..., None]
    return (np.array(top, np.float32) * (1 - t) + np.array(bottom, np.float32) * t).astype(np.uint8)


def _ink(colour, alpha):
    return (*colour, alpha)


# Each motif is one idea, drawn plainly, tied to what the piece is about. The
# point is not illustration — it is that fifteen tiles should be
# distinguishable from one another at forty points, which is the size the row
# actually draws them.
def m_list(d, w, h, c):
    """A list that shortens: reading on purpose."""
    y, width = h * 0.22, w * 0.52
    for i in range(6):
        d.rounded_rectangle([w * 0.16, y, w * 0.16 + width, y + h * 0.045],
                            radius=h * 0.02, fill=_ink(c, 210 - i * 28))
        y += h * 0.105
        width *= 0.82


def m_moon(d, w, h, c):
    """One large disc, low: the quiet hours."""
    r = h * 0.42
    d.ellipse([w * 0.5 - r, h * 0.62 - r, w * 0.5 + r, h * 0.62 + r], fill=_ink(c, 190))
    for i in range(3):
        yy = h * (0.16 + i * 0.07)
        d.rectangle([w * 0.1, yy, w * 0.9, yy + h * 0.012], fill=_ink(c, 90))


def m_reply(d, w, h, c):
    """Two blocks, offset and overlapping: notes that answer back."""
    d.rounded_rectangle([w * 0.12, h * 0.18, w * 0.62, h * 0.58], radius=h * 0.06, fill=_ink(c, 200))
    d.rounded_rectangle([w * 0.38, h * 0.42, w * 0.88, h * 0.82], radius=h * 0.06, fill=_ink(c, 130))


def m_grid(d, w, h, c):
    """A dense grid, one cell lit: against the inbox."""
    cols, rows = 9, 5
    pad = w * 0.1
    cw, ch = (w - pad * 2) / cols, (h - pad * 2) / rows
    for r in range(rows):
        for col in range(cols):
            lit = (r == 2 and col == 6)
            x0, y0 = pad + col * cw, pad + r * ch
            d.rounded_rectangle([x0 + 4, y0 + 4, x0 + cw - 10, y0 + ch - 10],
                                radius=6, fill=_ink(c, 235 if lit else 70))


def m_shelf(d, w, h, c):
    """Spines on a shelf: what a library is for."""
    x, i = w * 0.12, 0
    while x < w * 0.88:
        bw = w * (0.028 + (i % 4) * 0.012)
        top = h * (0.30 + (i % 3) * 0.07)
        d.rectangle([x, top, x + bw, h * 0.80], fill=_ink(c, 110 + (i % 5) * 30))
        x += bw + w * 0.016
        i += 1


def m_mono(d, w, h, c):
    """Fixed-width dashes: plain text outlives us."""
    for r in range(7):
        y = h * (0.2 + r * 0.09)
        x = w * 0.14
        while x < w * (0.86 - (0.28 if r == 6 else 0)):
            d.rectangle([x, y, x + w * 0.022, y + h * 0.022], fill=_ink(c, 190 - r * 14))
            x += w * 0.032


def m_ripple(d, w, h, c):
    """Concentric rings: reading slowly."""
    for i in range(6, 0, -1):
        r = h * 0.09 * i
        d.ellipse([w * 0.5 - r, h * 0.5 - r, w * 0.5 + r, h * 0.5 + r],
                  outline=_ink(c, 60 + i * 22), width=max(2, int(h * 0.012)))


def m_edges(d, w, h, c):
    """Hard triangles: small tools, sharp edges."""
    d.polygon([(w * 0.16, h * 0.78), (w * 0.40, h * 0.22), (w * 0.64, h * 0.78)], fill=_ink(c, 200))
    d.polygon([(w * 0.52, h * 0.78), (w * 0.74, h * 0.38), (w * 0.92, h * 0.78)], fill=_ink(c, 110))


def m_rays(d, w, h, c):
    """A burst from one point: attention and devotion."""
    import math
    cx, cy = w * 0.5, h * 0.92
    for i in range(11):
        a = math.pi + (i / 10) * math.pi
        d.line([cx, cy, cx + math.cos(a) * w, cy + math.sin(a) * w],
               fill=_ink(c, 60 + (i % 3) * 50), width=max(3, int(h * 0.016)))


def m_dashed(d, w, h, c):
    """A line that stops and carries on: offline is a feature."""
    y = h * 0.5
    x = w * 0.08
    i = 0
    while x < w * 0.92:
        seg = w * (0.10 if i % 3 else 0.04)
        d.rounded_rectangle([x, y - h * 0.02, x + seg, y + h * 0.02], radius=h * 0.02,
                            fill=_ink(c, 220 if i % 3 else 90))
        x += seg + w * 0.035
        i += 1


def m_pages(d, w, h, c):
    """Stacked sheets: the commonplace book."""
    for i in range(4):
        o = i * h * 0.06
        d.rounded_rectangle([w * 0.20 + o, h * 0.16 + o, w * 0.72 + o, h * 0.74 + o],
                            radius=h * 0.03, fill=_ink(c, 70 + i * 45))


def m_one(d, w, h, c):
    """A single mark in a lot of space: writing for one reader."""
    r = h * 0.13
    d.ellipse([w * 0.30 - r, h * 0.5 - r, w * 0.30 + r, h * 0.5 + r], fill=_ink(c, 230))
    for i in range(4):
        d.rectangle([w * 0.48, h * (0.40 + i * 0.07), w * 0.86, h * (0.42 + i * 0.07)],
                    fill=_ink(c, 60))


def m_split(d, w, h, c):
    """One half resolved, one half not: the half-finished draft."""
    d.polygon([(0, 0), (w * 0.58, 0), (w * 0.42, h), (0, h)], fill=_ink(c, 170))
    for r in range(9):
        y = h * (0.1 + r * 0.09)
        d.rectangle([w * 0.62, y, w * (0.70 + (r % 4) * 0.05), y + h * 0.028], fill=_ink(c, 95))


def m_wave(d, w, h, c):
    """A waveform: listening to what you saved."""
    import math
    bars = 26
    bw = (w * 0.76) / bars
    for i in range(bars):
        amp = abs(math.sin(i * 0.7)) * 0.5 + abs(math.sin(i * 0.23)) * 0.3
        bh = h * (0.06 + amp * 0.62)
        x = w * 0.12 + i * bw
        d.rounded_rectangle([x, h * 0.5 - bh / 2, x + bw * 0.55, h * 0.5 + bh / 2],
                            radius=bw * 0.25, fill=_ink(c, 110 + int(amp * 130)))


def m_echo(d, w, h, c):
    """The same shape, again and again, never final: everything is a draft."""
    for i in range(5):
        o = i * w * 0.05
        d.rounded_rectangle([w * 0.18 + o, h * 0.24 + o * 0.5, w * 0.62 + o, h * 0.70 + o * 0.5],
                            radius=h * 0.04, outline=_ink(c, 220 - i * 38),
                            width=max(2, int(h * 0.012)))


MOTIFS = {
    "list": m_list, "moon": m_moon, "reply": m_reply, "grid": m_grid,
    "shelf": m_shelf, "mono": m_mono, "ripple": m_ripple, "edges": m_edges,
    "rays": m_rays, "dashed": m_dashed, "pages": m_pages, "one": m_one,
    "split": m_split, "wave": m_wave, "echo": m_echo,
}


def hero_png(width: int, height: int, top: tuple, bottom: tuple, motif: str, mark: tuple) -> bytes:
    """The article's lead image: a ground, and one idea drawn on it."""
    base = Image.fromarray(_bg((width, height), top, bottom), "RGB").convert("RGBA")
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    MOTIFS[motif](ImageDraw.Draw(layer), width, height, mark)
    out = Image.alpha_composite(base, layer).convert("RGB")
    buf = io.BytesIO()
    out.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


STYLE = (
    ":root{color-scheme:light dark}"
    "body{margin:0 auto;padding:2.5rem 1.25rem;max-width:38rem;"
    "font:1.0625rem/1.7 -apple-system,system-ui,sans-serif}"
    "h1{font-size:1.9rem;line-height:1.2;margin:0 0 .6rem}"
    ".standfirst{font-size:1.15rem;opacity:.8;margin:0 0 .8rem}"
    ".byline{font-size:.9rem;opacity:.6;margin:0 0 1.6rem}"
    ".hero{width:100%;border-radius:12px;margin:0 0 1.8rem}"
    "hr{border:0;border-top:1px solid rgba(128,128,128,.3);margin:2.5rem 0 1.2rem}"
    ".endnote,.source{font-size:.85rem;opacity:.6;margin:.3rem 0}"
)

# Spread the capture dates over a few weeks so the Inbox reads as a pile that
# grew, not a batch import — the rows show these, and fifteen identical
# timestamps photograph as test data.
DATES = [
    "2026-08-19-091500", "2026-08-21-183000", "2026-08-24-074500",
    "2026-08-26-205000", "2026-08-29-113000", "2026-09-01-163000",
    "2026-09-02-081500", "2026-09-03-192000", "2026-09-04-193000",
    "2026-09-05-102000", "2026-09-06-144500", "2026-09-07-114500",
    "2026-09-09-085000", "2026-09-10-201500", "2026-09-11-131000",
]


def slug(title: str) -> str:
    keep = [c.lower() if c.isalnum() else "-" for c in title]
    out = "".join(keep)
    while "--" in out:
        out = out.replace("--", "-")
    return out.strip("-")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    outdir = pathlib.Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    for old in outdir.glob("*.html"):
        old.unlink()

    for (title, stand, site, top, bottom, motif, mark, paras), date in zip(ARTICLES, DATES):
        # Derived, not declared. The figure shows on every row of every
        # screenshot, so a number that can drift from the prose is a
        # visible lie waiting to happen. 200 wpm is the usual estimate.
        mins = max(1, round(sum(len(x.split()) for x in paras) / 200))
        hero = base64.b64encode(hero_png(1200, 630, top, bottom, motif, mark)).decode()
        body = "".join(f"<p>{p}</p>" for p in paras)
        url = f"https://{site}/{slug(title)}"
        html = (
            '<!DOCTYPE html><html><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            f"<title>{title}</title><style>{STYLE}</style></head><body>"
            f"<h1>{title}</h1>"
            f'<p class="standfirst">{stand}</p>'
            f'<p class="byline">{mins} min read · {site}</p>'
            f'<img class="hero" src="data:image/png;base64,{hero}">'
            f"{body}<hr>"
            f'<p class="endnote">{mins} min read · {site}</p>'
            f'<p class="source">Clipped from <a href="{url}">{url}</a></p>'
            "</body></html>"
        )
        (outdir / f"{date}-{slug(title)}.html").write_text(html, encoding="utf-8")

    # The shared-in piece goes next to the library, not into it.
    title, stand, site, top, bottom, motif, mark, paras = SHARED
    mins = max(1, round(sum(len(x.split()) for x in paras) / 200))
    hero = base64.b64encode(hero_png(1200, 630, top, bottom, motif, mark)).decode()
    body = "".join(f"<p>{p}</p>" for p in paras)
    url = f"https://{site}/{slug(title)}"
    share = outdir.parent / "share"
    share.mkdir(parents=True, exist_ok=True)
    (share / f"{slug(title)}.html").write_text(
        '<!DOCTYPE html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{title}</title><style>{STYLE}</style></head><body>"
        f"<h1>{title}</h1>"
        f'<p class="standfirst">{stand}</p>'
        f'<p class="byline">{mins} min read · {site}</p>'
        f'<img class="hero" src="data:image/png;base64,{hero}">'
        f"{body}<hr>"
        f'<p class="endnote">{mins} min read · {site}</p>'
        f'<p class="source">Clipped from <a href="{url}">{url}</a></p>'
        "</body></html>", encoding="utf-8")

    print(f"wrote {len(ARTICLES)} fictional articles to {outdir}")
    print(f"wrote the shared-in piece to {share}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
