import { readFile } from "node:fs/promises";
import chalk from "chalk";
import { boot } from "../packages/core/src/index.ts";
console.log(readFile, chalk, boot);
