# AI Prompts

> **These files are still verbatim, and one instruction in them is overridden at
> assembly time.** `lib/ai/server/panel-prompts.ts` concatenates
> `panel-rulebook.md` + the persona + a **HOUSE RULES** block that this codebase
> owns. The house rules revoke Marcus's "you call the founder 'chief'" habit
> (players found the nickname jarring and it was the most-reported thing about
> the room), forbid repeating a question already asked, require jargon to be
> defined once in character, and restate Brand Law 5. Fix behaviour there, not
> in the files below — editing these would break the verbatim guarantee this
> README exists to make.


These files are the verbatim "gray block" system prompts extracted from `design/PROMPT_PACK.txt`, stored unmodified so they can be dropped in as-is when the mock AI layer is swapped for live model calls (P6). A shark's complete system prompt is assembled by concatenating `panel-rulebook.md` followed by that shark's persona file (`shark-marcus.md`, `shark-serena.md`, `shark-dev.md`, `shark-lily.md`, `shark-viktor.md`); `language-coach.md` and `debrief-analyst.md` are standalone system prompts. Note that the Business Generator prompt is ABSENT from the source pack — the pack references it (its output is the `public_brief` fed to every other prompt) but never includes its gray block, so the `public_brief` shape used in `lib/ai/types.ts` was inferred from the other prompts' input descriptions rather than copied from a source prompt.
