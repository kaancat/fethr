# Filler Word Removal Test Examples

## Important: Pronunciation affects transcription!
Whisper adds commas based on your pauses. Speak naturally but add slight pauses where you see commas.

## Test 1: Clear Pauses (Pause slightly at each comma)
**Say this with clear pauses:**
"The new feature is... you know... really important. I mean... we've been working on it for months."

**What Whisper might transcribe:**
- With pauses: "The new feature is, you know, really important. I mean, we've been working on it for months."
- Without pauses: "The new feature is you know really important. I mean we've been working on it for months."

**Expected output (if commas detected):**
"The new feature is really important. We've been working on it for months."

**Expected output (if no commas):**
No change (our current patterns require commas)

---

## Test 2: Natural Speech Flow
**Say this naturally without forced pauses:**
"So I was thinking about the project and well the deadline is approaching. Actually we should probably like get started soon."

**Expected output:**
"I was thinking about the project and the deadline is approaching. We should probably get started soon."

**What should be removed:**
- "So" at start (works without comma)
- "well" if followed by space
- "Actually" at sentence start
- "like" if it's a filler (this might not work yet)

---

## Test 3: Protected Phrases Test
**Say this clearly:**
"You know what I mean when I say it's important? You know what time the meeting is? But you know, sometimes it's hard to explain."

**Expected output:**
"You know what I mean when I say it's important? You know what time the meeting is? But sometimes it's hard to explain."

**What should happen:**
- "You know what I mean" - KEEP (protected phrase)
- "You know what time" - KEEP (protected phrase)  
- "you know," - REMOVE (filler with comma)

---

## Quick Reference:
- **Sentence starters** (So, Well, Actually): Removed even without commas
- **Filler phrases** (you know, I mean): Currently only removed WITH commas
- **Protected phrases**: Always kept regardless of commas