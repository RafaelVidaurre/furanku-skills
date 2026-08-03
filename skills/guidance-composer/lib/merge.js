"use strict";

const OPEN_MARKERS = [
  "<!-- managed-by: guidance-composer -->",
  "<!-- managed-by: project-guidance -->",
];
const CLOSE_MARKER = "<!-- /managed-by: guidance-composer -->";
const LEGACY_CLOSE = "<!-- /managed-by: project-guidance -->";
const PREFERRED_OPEN = "<!-- managed-by: guidance-composer -->";

function findManagedRegion(text) {
  let openIdx = -1;
  let openMarker = null;
  for (const marker of OPEN_MARKERS) {
    const idx = text.indexOf(marker);
    if (idx !== -1 && (openIdx === -1 || idx < openIdx)) {
      openIdx = idx;
      openMarker = marker;
    }
  }
  if (openIdx === -1) {
    return null;
  }

  const afterOpen = openIdx + openMarker.length;
  const closeCandidates = [CLOSE_MARKER, LEGACY_CLOSE];
  let closeIdx = -1;
  let closeMarker = null;
  for (const marker of closeCandidates) {
    const idx = text.indexOf(marker, afterOpen);
    if (idx !== -1 && (closeIdx === -1 || idx < closeIdx)) {
      closeIdx = idx;
      closeMarker = marker;
    }
  }

  if (closeIdx !== -1) {
    return {
      openIdx,
      openMarker,
      closeIdx,
      closeMarker,
      interior: text.slice(afterOpen, closeIdx),
      closed: true,
    };
  }

  // Legacy open-only: through next same-or-higher heading, else EOF.
  const rest = text.slice(afterOpen);
  const headingMatch = rest.match(/\n(?=#{1,2} )/);
  const endRel = headingMatch ? headingMatch.index : rest.length;
  const endIdx = afterOpen + endRel;
  return {
    openIdx,
    openMarker,
    closeIdx: endIdx,
    closeMarker: null,
    interior: text.slice(afterOpen, endIdx),
    closed: false,
  };
}

function normalizeBullet(line) {
  return line.replace(/^\s*-\s+/, "").trim();
}

function bulletsFromInterior(interior) {
  return interior
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => /^\s*-\s+\S/.test(l))
    .map((l) => l.trim());
}

function matchCatalogIds(interiorBullets, catalog) {
  const present = new Set();
  const bulletSet = new Set(interiorBullets.map(normalizeBullet));
  for (const entry of catalog.entries) {
    const injectNorm = entry.inject.map((s) => normalizeBullet(s.startsWith("- ") ? s : `- ${s}`));
    if (injectNorm.every((b) => bulletSet.has(b))) {
      present.add(entry.id);
    }
  }
  return [...present];
}

function buildManagedBlock(injectBulletLines) {
  const body =
    injectBulletLines.length === 0
      ? ""
      : `${injectBulletLines.join("\n")}\n`;
  return `${PREFERRED_OPEN}\n${body}${CLOSE_MARKER}`;
}

function mergeInject({
  existingText,
  injectBulletLines,
  mode = "add",
  sectionHeading = "## Project guidance",
  linkedIntro = null,
}) {
  const region = existingText ? findManagedRegion(existingText) : null;

  if (mode === "replace" || !region) {
    const block = buildManagedBlock(injectBulletLines);
    if (!existingText || !existingText.trim()) {
      if (linkedIntro) {
        return `${linkedIntro}\n\n${block}\n`;
      }
      return `${sectionHeading}\n\n${block}\n`;
    }
    if (!region) {
      const trimmed = existingText.replace(/\s*$/, "");
      const needsHeading =
        !new RegExp(`^${escapeReg(sectionHeading)}\\s*$`, "m").test(trimmed) &&
        !linkedIntro;
      const prefix = needsHeading
        ? `${trimmed}\n\n${sectionHeading}\n\n`
        : `${trimmed}\n\n`;
      return `${prefix}${block}\n`;
    }
    // replace interior only
    const before = existingText.slice(0, region.openIdx);
    const after = region.closeMarker
      ? existingText.slice(region.closeIdx + region.closeMarker.length)
      : existingText.slice(region.closeIdx);
    return `${before}${buildManagedBlock(injectBulletLines)}${after}`;
  }

  // add mode: union existing managed bullets with new inject lines
  const existingBullets = bulletsFromInterior(region.interior);
  const existingNorm = new Set(existingBullets.map(normalizeBullet));
  const merged = [...existingBullets];
  for (const line of injectBulletLines) {
    const n = normalizeBullet(line);
    if (!existingNorm.has(n)) {
      merged.push(line);
      existingNorm.add(n);
    }
  }
  const before = existingText.slice(0, region.openIdx);
  const after = region.closeMarker
    ? existingText.slice(region.closeIdx + region.closeMarker.length)
    : existingText.slice(region.closeIdx);
  return `${before}${buildManagedBlock(merged)}${after}`;
}

function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureAgentsPointer(agentsText, relativeLink) {
  const pointerLine = `Follow [${relativeLink}](${relativeLink}) for repository engineering principles.`;
  const section = `## Project guidance\n\n${pointerLine}\n`;
  if (!agentsText || !agentsText.trim()) {
    return `# AGENTS.md\n\n${section}`;
  }
  if (agentsText.includes(relativeLink) && /Project guidance/i.test(agentsText)) {
    return agentsText;
  }
  if (/^## Project guidance\s*$/m.test(agentsText)) {
    // Section exists; append pointer if missing
    if (agentsText.includes(relativeLink)) return agentsText;
    return agentsText.replace(
      /^## Project guidance\s*$/m,
      `## Project guidance\n\n${pointerLine}`
    );
  }
  return `${agentsText.replace(/\s*$/, "")}\n\n${section}`;
}

function detectAgentInstructionFile(root, fs, path) {
  // Prefer AGENTS* (write target for shared instructions), then CLAUDE*.
  const candidates = [
    "AGENTS.md",
    "Agents.md",
    "agents.md",
    "CLAUDE.md",
    "Claude.md",
    "claude.md",
  ];
  for (const name of candidates) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) return p;
  }
  return path.join(root, "AGENTS.md");
}

function hasAgentInstructionFile(root, fs, path) {
  const candidates = [
    "AGENTS.md",
    "Agents.md",
    "agents.md",
    "CLAUDE.md",
    "Claude.md",
    "claude.md",
  ];
  return candidates.some((name) => fs.existsSync(path.join(root, name)));
}

module.exports = {
  OPEN_MARKERS,
  CLOSE_MARKER,
  PREFERRED_OPEN,
  findManagedRegion,
  bulletsFromInterior,
  matchCatalogIds,
  buildManagedBlock,
  mergeInject,
  ensureAgentsPointer,
  detectAgentInstructionFile,
  hasAgentInstructionFile,
  normalizeBullet,
};
