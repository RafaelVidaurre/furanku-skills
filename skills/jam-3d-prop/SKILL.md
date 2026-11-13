---
name: jam-3d-prop
description: Produce game props end to end from a setting's reference scene, from picking props to delivered, scene-tested models, with one agent per prop. Use when the user asks to make props for a setting or room, to build a named prop from a scene image, or to run several props in parallel.
---

# Props from a reference scene

This skill composes the jam stages (`jam-concept`, `jam-turnaround`, `jam-model`, `jam-retopo`, `jam-uv`, `jam-texture`, delivery under `jam-3d`) into a prop production line. Their rules and `tools/jam/docs/contracts.md` still apply; this skill adds the order, the design rules and the checks that made props succeed. You are the **coordinator**: you own all contact with the user, the catalog collection and the final set test. Each prop is built by one **prop agent** following [the prop procedure](references/prop-procedure.md). Scripts named here are in this skill's `scripts/` directory.

When `tools/jam/jam.mjs` is missing from the project, use the `jam-setup` skill first (when it is not installed: `npx skills add rafaelvidaurre/furanku-skills --skill jam-setup`).

## 1. Reference scene

Props come from a **reference scene**: an image of the setting's room or street with its props placed in 3D space at real scale, so their relative sizes are readable. A grid or lineup of isolated props hides relative size; a hero shot is only a style reference.

If the setting has no reference scene, generate one in the approved style (`Art/style.md`; attach an approved hero shot as STYLE ONLY): the empty place with everything you would expect in it, no people, from a standing camera just inside the room that shows most of the floor. Choose the route with image-route discovery (`tools/jam/docs/images.md#discover-and-offer-usable-routes`) and use one fresh session per image. When the user asks for options, give several in the same style differing only in the room. The user picks which props to build from one or more scenes.

**Done:** the user has named the props, and each has a source image.

## 2. Project setup

Before the first 3D generation, `jam.config.json` needs a `prop` profile, a mesh provider and a per-run spending cap (`jam-setup`, `node tools/jam/jam.mjs settings`). Prop agents take triangle, texture, material, axis and pivot targets from that profile. Also settle the game's reference character height and, when known, its gameplay camera (position, target, field of view) for the scene tests. Costs observed on Scenario in 2026-11: Meshy 7.1 multi-image mesh 120 CU, Meshy 7 Retexture 40 CU; a prop typically needed 120 to 160 CU.

Ask the user which reviews they want, and set them for the prop pipeline only: `node tools/jam/jam.mjs settings --profile prop --stage <stage|all> --review <human|agent>` (other pipelines keep their own policy). A common choice is human review of concept, turnaround and delivery for the first prop with agent review for the rest; record what the user actually said and pass it to prop agents as their authorization. Prop agents follow the run's effective policy and bring human reviews to you to put to the user.

**Done:** the `prop` profile resolved, the review policy set, and the reference height known.

## 3. Build the props

The first prop of a new setting establishes the material colours and the delivery layout: build it yourself or with one agent, following the procedure's first-prop branch, and get it accepted before fanning out.

Then run one agent per prop, in parallel. Brief each with: the absolute path of this skill's directory, asset id, source scene and which object in it, real size in metres, symmetry class, the review authorization, the chosen image and mesh routes, the reference height and game camera, the first accepted prop (its concept as colour reference, its delivery as layout example), the directories of the other prop agents to stay out of, and `references/prop-procedure.md` as its procedure. Prop agents send no notifications and ask the user nothing; they report back, including any stage waiting for a human review.

**Done:** every prop agent has reported, and every human review they raised has the user's decision passed back.

## 4. Verify each delivery

Treat a prop agent's report as a claim. For each prop: run `node tools/jam/jam.mjs check-delivery --run Art/Assets/<asset>/v<n>/run.json` and `node tools/jam/jam.mjs measure --file Art/Assets/<asset>/v<n>/model/<asset>.glb` yourself, render the final model from the front, three-quarter and behind (`scripts/render.py`, `scripts/back.py`), and look at its scene-test render. Hold it to [inspection](references/inspection-and-repair.md#inspection): any flaw a player would see in normal play sends it back to its agent with the views, the defect and the acceptance criteria, as a new revision. Add accepted props to the setting's catalog collection (`jam-catalog`, `collection.update`).

**Done:** every prop is accepted or explicitly sent back.

## 5. Set test

Place all delivered props together with `scripts/scene.py` (one spec, arranged as the reference scene arranges them, with the game's reference height and camera) and check they read as one set: consistent scale against the reference figure and each other, consistent materials and colour, nothing floating or sunk. Fix or send back any prop that breaks the set.

**Done:** one render of the whole set in which every prop belongs; report the delivered paths, costs and anything unresolved (for example, not yet tested in the engine), and tell the user through the environment's question or notification surface.

## Showing work to the user

Show the user only work you believe is right. Fix known flaws before presenting; ask about a minor flaw only when you cannot tell whether they would accept it, and when they delegated review, decide it yourself and say what you decided.
