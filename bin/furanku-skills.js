#!/usr/bin/env node
"use strict";

const { main } = require("../lib/cli");

main(process.argv).catch((err) => {
  process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
