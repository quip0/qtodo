// The launcher stub runs this immediately before spawning Electron, so it is
// the one place guaranteed to run on every launch. There is nothing to bundle
// (the UI is plain JS/CSS) — this exists purely for launch-time repairs.
require('./scripts/ensure-electron')();   // must come first: re-extract can undo the signature
require('./scripts/ensure-signature')();
