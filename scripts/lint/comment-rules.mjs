// The comment rule from AGENTS.md → Principles, as oxlint rules.
// A justified exception is `// oxlint-disable-next-line leapsake/<rule> -- <why>`.

const DIRECTIVE =
  /^\s*(?:oxlint-|eslint-|@ts-|prettier-ignore|biome-ignore|istanbul |c8 |v8 |#(?:end)?region)/;

// Markers of history rather than behaviour: dates, plan citations, owner calls, slice numbers.
const DECISION_MARKERS = [
  [/\b20\d\d-\d\d-\d\d\b/, "a date"],
  [/§/, "a § reference"],
  [/\bplans\//, "a plans/ path"],
  [/\(owner\b/i, "an owner attribution"],
  [/\bslice \d/i, "a slice number"],
];

const isDirective = (comment) =>
  comment.type === "Shebang" || DIRECTIVE.test(comment.value);

const startsItsLine = (text, comment) => {
  const lineStart = text.lastIndexOf("\n", comment.start - 1) + 1;
  return text.slice(lineStart, comment.start).trim() === "";
};

const lineOf = (text, offset) => {
  let line = 1;
  for (
    let i = text.indexOf("\n");
    i !== -1 && i < offset;
    i = text.indexOf("\n", i + 1)
  )
    line++;
  return line;
};

/** Lines of prose in a block comment, not counting its delimiter lines. */
const blockLines = (comment) => {
  const lines = comment.value
    .split("\n")
    .map((l) => l.replace(/^\s*\*?\s?/, "").trim());
  while (lines.length && lines[0] === "") lines.shift();
  while (lines.length && lines.at(-1) === "") lines.pop();
  return lines.length;
};

/** Groups consecutive own-line `//` comments; every block comment is its own group. */
const commentGroups = (text, comments) => {
  const groups = [];
  let run = null;
  for (const comment of comments) {
    if (isDirective(comment)) {
      run = null;
      continue;
    }
    if (comment.type === "Block") {
      groups.push({ first: comment, lines: blockLines(comment) });
      run = null;
      continue;
    }
    const line = lineOf(text, comment.start);
    if (!startsItsLine(text, comment)) {
      run = null;
      continue;
    }
    if (run && line === run.lastLine + 1) {
      run.lines++;
      run.lastLine = line;
    } else {
      run = { first: comment, lines: 1, lastLine: line };
      groups.push(run);
    }
  }
  return groups;
};

const maxCommentLines = {
  meta: {
    type: "suggestion",
    docs: {
      description: "A comment explains behaviour in at most a few lines.",
    },
    schema: [
      {
        type: "object",
        properties: { max: { type: "integer", minimum: 1 } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const max = context.options[0]?.max ?? 2;
    return {
      Program() {
        const { text } = context.sourceCode;
        for (const group of commentGroups(
          text,
          context.sourceCode.getAllComments(),
        )) {
          if (group.lines > max) {
            context.report({
              node: group.first,
              message: `Comment runs ${group.lines} lines; the limit is ${max}. Say it in the code, cut it, or disable this line with a reason.`,
            });
          }
        }
      },
    };
  },
};

const noDecisionComments = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Decisions and history belong in git log and READMEs, not source.",
    },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (isDirective(comment)) continue;
          const hit = DECISION_MARKERS.find(([pattern]) =>
            pattern.test(comment.value),
          );
          if (hit) {
            context.report({
              node: comment,
              message: `Comment cites ${hit[1]}, which is history, not behaviour. Move it to the commit message or the package README.`,
            });
          }
        }
      },
    };
  },
};

export default {
  meta: { name: "leapsake" },
  rules: {
    "max-comment-lines": maxCommentLines,
    "no-decision-comments": noDecisionComments,
  },
};
