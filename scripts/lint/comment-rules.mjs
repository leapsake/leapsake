// The comment rule from AGENTS.md → Principles, as oxlint rules.
// A justified exception is `// oxlint-disable-next-line leapsake/<rule> -- <why>`.

const DIRECTIVE =
  /^\s*(?:oxlint-|eslint-|@ts-|prettier-ignore|biome-ignore|istanbul |c8 |v8 |#(?:end)?region)/;

// History, not behaviour: dates, plan citations, owner calls, slice numbers.
const DECISION_MARKERS = [
  [/\b20\d\d-\d\d-\d\d\b/, "a date"],
  [/§/, "a § reference"],
  [/\bplans\//, "a plans/ path"],
  [/\(owner,/i, "an owner attribution"],
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

/** Groups consecutive own-line `//` comments; a block comment is its own. */
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

const URL = /[^:/?#]:\/\/[^?#]/u;
const LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/;
const TAB_WIDTH = 4;

/** Columns a line occupies: code points, each tab widened to the next stop. */
const lineWidth = (line) => {
  let extra = 0;
  line.replace(/\t/g, (_, offset) => {
    extra += TAB_WIDTH - ((offset + extra) % TAB_WIDTH) - 1;
    return "";
  });
  return Array.from(line).length + extra;
};

/** Each comment's offsets; a one-line JSX comment spans its braces. */
const commentSpans = (sourceCode) =>
  sourceCode.getAllComments().map((comment) => {
    const node = sourceCode.getNodeByRangeIndex(comment.start);
    const box = node?.type === "JSXEmptyExpression" ? node.parent : null;
    return box && !LINE_BREAK.test(sourceCode.text.slice(box.start, box.end))
      ? box
      : comment;
  });

const maxCommentWidth = {
  meta: {
    type: "layout",
    docs: {
      description:
        "A line holding only comment fits the width; code width is oxfmt's.",
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
    const max = context.options[0]?.max ?? 80;
    return {
      Program() {
        const { text } = context.sourceCode;
        const spans = commentSpans(context.sourceCode);
        let lineStart = 0;
        let next = 0;
        text.split(LINE_BREAK).forEach((line, i) => {
          const lineEnd = lineStart + line.length;
          while (next < spans.length && spans[next].start <= lineEnd) next++;
          const span = spans[next - 1];
          const isCommentLine =
            span !== undefined &&
            span.end >= lineEnd &&
            (span.start < lineStart ||
              text.slice(lineStart, span.start).trim() === "");
          const width = lineWidth(line);
          if (
            isCommentLine &&
            width > max &&
            !line.includes("oxlint-disable") &&
            !URL.test(line)
          ) {
            context.report({
              loc: {
                start: { line: i + 1, column: 0 },
                end: { line: i + 1, column: line.length },
              },
              message: `Comment line is ${width} columns; the limit is ${max}. Rewrap it.`,
            });
          }
          lineStart = lineEnd + (text.startsWith("\r\n", lineEnd) ? 2 : 1);
        });
      },
    };
  },
};

export default {
  meta: { name: "leapsake" },
  rules: {
    "max-comment-lines": maxCommentLines,
    "max-comment-width": maxCommentWidth,
    "no-decision-comments": noDecisionComments,
  },
};
