// A provider descriptor: what a generation service can do, how an agent reaches it, how it bills
// and paces. It is data; the toolkit never calls a provider's API for images or meshes.
import * as Schema from "effect/Schema"
import { Id, PositiveInt, Text } from "../common.ts"
import { Landmark } from "../rig/landmarks.ts"

const opt = Schema.optionalKey

export const Transport = Schema.Struct({
  kind: Schema.Literals(["cli", "mcp", "skill", "browser", "agent"]).pipe(Schema.annotate({
    description: "cli: a program on this machine. mcp: a server in the agent harness. skill: an installed skill. browser: the provider's site. agent: a tool the agent already has."
  })),
  command: opt(Text.pipe(Schema.annotate({ description: "cli: the program's name on PATH" }))),
  probe: opt(Schema.Array(Schema.String).pipe(Schema.annotate({ description: "cli: arguments that print a version and exit 0 (default --version)" }))),
  auth: opt(Schema.Array(Schema.String).pipe(Schema.annotate({ description: "cli: arguments that exit 0 only when signed in" }))),
  reach: opt(Schema.Array(Schema.String).pipe(Schema.annotate({ description: "cli: arguments of a free call that exits 0 only when the service answers" }))),
  npmLauncher: opt(Schema.Boolean.pipe(Schema.annotate({ description: "cli: installed through npm (a .cmd shim on Windows)" }))),
  server: opt(Text.pipe(Schema.annotate({ description: "mcp: the server's name in the harness configuration" }))),
  name: opt(Text.pipe(Schema.annotate({ description: "skill: the skill's name" }))),
  note: opt(Schema.String)
}).pipe(Schema.check(Schema.makeFilter((transport) =>
  transport.kind === "cli" && transport.command === undefined
    ? "a cli transport needs command"
    : transport.kind === "mcp" && transport.server === undefined
    ? "an mcp transport needs server"
    : transport.kind === "skill" && transport.name === undefined
    ? "a skill transport needs name"
    : undefined
)))
export type Transport = typeof Transport.Type

const ROUTE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** How a motion provider makes a clip. */
export const MOTION_MODES = ["inbetween", "text", "video", "library"] as const

const Capability = Schema.Struct({
  modes: opt(Schema.Array(Id)),
  inputs: opt(Schema.Struct({ min: opt(PositiveInt), max: opt(PositiveInt) })),
  note: opt(Schema.String)
})

export const Descriptor = Schema.Struct({
  $schema: opt(Schema.String),
  id: Id,
  label: Text,
  unit: Schema.Struct({
    id: Text.pipe(Schema.annotate({ description: "The provider's own spending unit, e.g. credits" })),
    label: Text,
    paid: Schema.Boolean.pipe(Schema.annotate({ description: "false when use is included in a plan or the agent session, so no spending cap applies" }))
  }),
  capabilities: Schema.StructWithRest(
    Schema.Struct({
      motion: opt(Schema.Struct({
        modes: Schema.NonEmptyArray(Schema.Literals(MOTION_MODES)).pipe(Schema.annotate({
          description: "inbetween: motion between given poses. text: motion from a written prompt. video: motion captured from footage. library: preset clips applied to a rig."
        })),
        inputs: opt(Schema.Struct({ min: opt(PositiveInt), max: opt(PositiveInt) })),
        note: opt(Schema.String.pipe(Schema.annotate({
          description: "What the provider's own docs state: limits, output skeleton and formats, and whether it animates only its own auto-rigged copy of a mesh"
        })))
      }).pipe(Schema.annotate({ description: "Animation clips for a rigged character. Its output skeleton is the one rig.landmarks maps, or the one the note names." })))
    }),
    // String keys, checked as ids below, so the published schema keeps the shape of every other route.
    [Schema.Record(Schema.String, Capability)]
  ).pipe(
    Schema.check(Schema.makeFilter((capabilities) => {
      const bad = Object.keys(capabilities).filter((route) => !ROUTE.test(route))
      return bad.length === 0 ? undefined : `route names are lowercase ids: ${bad.join(", ")}`
    })),
    Schema.annotate({ description: "What it can serve, by route name (image, mesh, motion, sound, voice, ...)" })
  ),
  transports: Schema.Array(Transport),
  pacing: opt(Schema.Struct({
    concurrent: opt(PositiveInt.pipe(Schema.annotate({ description: "Jobs to run at once on one account" }))),
    cooldown: opt(Text),
    retryAfter: opt(Text.pipe(Schema.annotate({ description: "Where the provider states how long to wait after a refusal" }))),
    typicalWait: opt(Text)
  })),
  quote: opt(Schema.Struct({
    kind: Schema.Literals(["exact", "estimate", "list", "none"]),
    how: Text
  })),
  rig: opt(Schema.Struct({
    landmarks: Schema.Record(Schema.String, Landmark).pipe(Schema.annotate({
      description: "For a provider that auto-rigs: which landmark each bone of its skeleton stands at"
    }))
  })),
  recovery: opt(Text.pipe(Schema.annotate({ description: "What to do when a submission's response is lost" }))),
  skills: opt(Schema.Array(Text)),
  docs: opt(Text.pipe(Schema.annotate({ description: "Document with the provider's specifics, relative to the toolkit (shipped) or the project" }))),
  notes: opt(Schema.Array(Schema.String))
}).pipe(Schema.annotate({ identifier: "ProviderDescriptor", title: "Provider descriptor (jam/providers/<id>.json)" }))
export type Descriptor = typeof Descriptor.Type
