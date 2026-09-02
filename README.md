# todo

A month calendar with a todo list behind every day, opened with `:todo` in
[qcommand](../qcommand). Pick a day, and the pane on the right is that day's
list: add items, tick them off, edit or delete them, push one to tomorrow.
Alerts are the second kind of entry — they mark a day without taking a line in
its list. Categories are folders for items, and filter the whole app.

Gruvbox-hard chrome, matching Quip IDE, Drive and Habits.

## Run

```sh
npm install
npm start          # dev run
npm run app        # (re)build ~/Applications/Todo.app
```

`npm run app` bakes this directory's path into the launcher, so rerun it after
moving the project. Then `:todo` from qcommand, or open the app directly.

## Categories

A category is a folder for items — `work`, `home`, `study`. Each has a name and
a color from a fixed eight-hue palette, and that color is the category
everywhere it appears: the chip above the month, the dot on a list row, the edge
of a preview line inside a calendar cell, the heading of its group in the day
list.

- **Make one** with the `+ category` chip (or `⇧⌘C`, or `new category…` inside
  any category picker). It appears where the chip will be, so creating and
  seeing the result happen in one place.
- **Filter** by clicking its chip: the day list, every calendar cell, the
  month counts and `clear done` all narrow to that category at once. Clicking it
  again, or the `all` chip, clears the filter. While a filter is on, new items
  are filed into it by default — typing where you are looking shouldn't file the
  result somewhere else.
- **File an item** with the dot on its row (`c` on the selected row), or set
  what new items get filed under with the composer's category button.
- **Rename, recolor, delete** by double-clicking a chip.

Two decisions worth keeping:

- An item stores a **reference** to its category (`cat`), not a copy of its
  name. A rename or recolor has to reach every item already filed, and a copied
  name would leave the old one stranded on everything written before the change.
- **Deleting a category unfiles its items rather than deleting them.** Losing a
  folder should never mean losing what was in it; the popover says so on the
  button. An item pointing at a category that no longer exists (a hand-edited
  file) is unfiled on load for the same reason — a dangling reference is a
  broken folder, not a broken task.

Colors are assigned as the first hue nobody is using, so the first eight
categories are always distinct from each other. Past eight it wraps, which is
the honest limit of a fixed palette. Alerts have no category: they were never in
the list to be filed.

## The two kinds of entry

An **item** is a line in the day's list: it has a checkbox, it can be edited,
deleted, moved to the next day, and it counts toward the `n/m done` figure.

An **alert** is a marker on the day — "flight check-in opens", "rent due". It
shows above the list in the day pane and as a red dot on the calendar cell, and
it is *not* in the list: no checkbox, no place in the count, and nothing to tick
off. That separation is the reason `items` and `alerts` are two maps in the
state rather than one list with a flag on it — an alert can't accidentally be
rendered as a list line if it was never in the list to begin with.

## Keys

Bindings are scoped to whichever pane has focus, so one arrow key never has to
guess which of the two you meant. Tab moves between them.

| Calendar | |
|---|---|
| `← → ↑ ↓` | move a day / a week |
| `PageUp` / `PageDown`, `⌘[` / `⌘]` | previous / next month |
| `Enter` | jump to the composer |
| `t`, `⌘T` | today |

| Day list | |
|---|---|
| `↑ ↓` | move through the items |
| `space` | done / not done |
| `Enter` | edit in place (`Escape` cancels) |
| `c` | file under a category |
| `⌫` | delete |

`⌘N`, `⇧⌘N` and `⇧⌘C` focus the composer set to item, to alert, and start a new
category respectively.
Clicking a row toggles it; double-clicking edits it. A day from a neighbouring
month is dimmed but live — clicking one steps into that month.

## Storage

One file, `~/Library/Application Support/Todo/todo.json`:

```json
{ "categories": [ { "id": "f30e24ef", "name": "errands", "color": "#83a598", "created": 1788347201000 } ],
  "items":  { "2026-09-02": [ { "id": "af6c721c", "text": "renew passport", "done": false, "cat": "f30e24ef", "created": 1788347236854 } ] },
  "alerts": { "2026-09-02": [ { "id": "44145eda", "text": "flight check-in opens", "created": 1788347254561 } ] } }
```

Days with nothing on them are absent, so a fresh install is `{}` and a busy year
is a few tens of KB. Writes are debounced 300ms and go through a temp file plus
rename, so a crash mid-write can't truncate the only copy.

Everything read back — the file on disk included — passes through `sanitize()`
in `main.js`, which rebuilds the state from only the fields that validate. A
hand-edited `todo.json` is held to exactly the same standard as the UI, so a bad
edit costs you the bad entry rather than the file.

## Things that are easy to break

- **Never build a day string from `toISOString()`.** It converts to UTC, so
  every evening west of Greenwich files today's item under tomorrow. `src/dates.js`
  is shared by the main process and the renderer precisely so both sides agree on
  what "today" is; it is loaded two ways (a plain `<script>` and `require()`).
- **`main.js` checks `kind` against a `Set`** before indexing `state[kind]`.
  An unchecked string from the renderer would otherwise reach `Object.prototype`.
- **`itemsOn()` in the renderer is the only place the category filter is
  applied**, so a new caller can't forget it and quietly show hidden items.
  `clear done` passes the filter to the main process for the same reason: a
  button next to a filtered list must not clear what that list is hiding.
  `undefined` there means every category and `null` means the unfiled ones —
  they are not interchangeable.
- **The single-key bindings are not menu accelerators.** Electron matches
  accelerators before the focused element sees the key, so `space` as an
  accelerator would be swallowed while typing into the composer. The renderer
  binds them and scopes them by pane.
- **`launcher/launch.c` hardcodes the project path**, and waits on Electron
  rather than exec'ing it — that process is the one macOS identifies as
  `Todo.app`, and qcommand focuses a running app by finding it and walking to the
  descendant that owns a window. Exec'ing would make qcommand launch a duplicate
  every time. Same stub pattern as Drive and Quip IDE, so `build.js` is again the
  only per-launch hook (it repairs Electron's install and signature).
