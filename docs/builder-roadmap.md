# Builder and mobile deployment roadmap

## First slice

Use one Builder and one study format across screen sizes. On phones, show one editing section at a time, keep the draft picker within reach, and open the participant preview separately. Keep touch buttons for moving a measure earlier or later. A backup should open in either layout.

Pilot the standard Cloudflare path on iOS Safari and Android Chrome. Start with a new browser profile, create a draft, download the prepared HTML, create a host in Cloudflare, return to Builder, open Study Admin, choose the file, and complete a test response. Verify receipt in Study Admin. Repeat against an existing host to catch cases where the UI nudges a researcher into creating a second host.

## Next slices

| Priority | Change | What to verify |
| --- | --- | --- |
| 1 | Clear next action. Use existing study checks to link to the next incomplete step. Keep deployment warnings visible where they affect an action. | A first-time researcher can find the next step without needing to interpret the validation report. |
| 2 | Resume and save feedback. Remember the last section and session per draft and show when the current edit has saved or needs a backup. | Two drafts reopen in their own sections. A failed local save never shows a success message. |
| 3 | Undo removals. Start with measures, then handle whole sessions and their references. | Undo restores order, assignments, and rules without losing later edits or changing another draft. |
| 4 | Simplify editing. Put common controls first and keep advanced settings in named sections. Offer an add action and question pack in empty sessions. | A novice can build a check-in. An experienced researcher can still find branching and timing controls. |
| 5 | Polish the editing feedback. Connect the selected measure with preview where practical, preserve focus when items move, and respect reduced-motion settings. | Reordering works with touch and keyboard, and preview changes are easy to follow. |
| 6 | Test participant usability on real phones. Check larger text, the keyboard, starting from a message, navigation, and restoring a session after interruption. | A participant can finish and submit a session without help on each supported browser. |

Watch a few researchers who have never used EMA Forge run the full workflow. Note where they stop or need help, especially when switching between Builder, Cloudflare, and Study Admin. Prioritize changes that let them recover without outside help.

The release check for phone deployment is a real pilot submission from each mobile browser. Local browser tests can exercise the file handoff and receipt. Cloudflare account setup, native file pickers, and switching between browser tabs need a physical-device pass.
