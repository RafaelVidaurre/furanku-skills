// entry point of the web app
import { boot } from "@acme/core";
import { slug } from "@acme/core/util";
import { View } from "./view.js";
import { helper } from "./lib";
import { Button } from "@shared/button";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import path from "path";
import { gone } from "./missing";
import type { Only } from "./types";
import {
  first,
  second,
} from "./multi";
import data from "./data.json";
export { boot as reboot } from "@acme/core";
export * from "./view.js";

const lazy = () => import("./lazy");
const legacy = require("./legacy.cjs");
/* import { fake } from "./not-real"; */
console.log(boot, slug, View, helper, Button, THREE, readFileSync, path, gone, first, second, data, lazy, legacy);
