"use strict";

// A motion provider whose own skill ships its skeleton's landmark map has one source for it: the
// skill's map. The toolkit descriptor's rig.landmarks must equal it.
const test = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));

test("the motionbricks descriptor's rig.landmarks equals jam-3d-motionbricks' SOMA landmark map", () => {
  const descriptor = read("skills/jam-setup/assets/toolkit/providers/motionbricks.json");
  const map = read("skills/jam-3d-motionbricks/assets/landmark-maps/soma.json");
  assert.deepStrictEqual(descriptor.rig.landmarks, map.landmarks);
});
