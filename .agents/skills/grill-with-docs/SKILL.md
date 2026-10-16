---
name: grill-with-docs
description: A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go.
disable-model-invocation: true
---

Call the Skill tool twice, for "grilling" and "domain-modeling". Follow both, with the
locations and lifetime below in place of theirs.

## Where the docs go

Everything a session writes lives in one folder, `plans/<topic>/`, named for what the plan
delivers:

```
plans/<topic>/
├── README.md         ← the plan being sharpened
├── GLOSSARY.md       ← terms resolved this session
└── adr/
    └── 0001-slug.md  ← decisions, numbered within this plan
```

Create each file lazily, as domain-modeling says. Never write a root `GLOSSARY.md`,
`GLOSSARY-MAP.md` or `docs/adr/`. Before grilling, read the package `README.md`s the topic
touches: they hold the settled vocabulary and "why" that the glossary and ADRs must not
contradict.

## The folder is scaffolding

These docs exist to iron out the plan before and during its execution, not to outlive it.
`plans/` must shrink (`plans/README.md` → _The rule for every doc here_), so as the work
lands, retire each ADR and glossary term into the first of these that can carry it:

1. The code itself: a name that says it, or a test whose assertion shows the reason.
2. A concise code comment, within the comment rule in `AGENTS.md`.
3. The commit message that lands it.
4. The `README.md` beside the code, for the how and why that spans files.

Then delete the folder. Nothing outside `plans/<topic>/` may link to an ADR in it.
