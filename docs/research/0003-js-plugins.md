---
Research: 0003
Title: JS plugin glue for `@mdc/parser` — remark vs markdown-it
Author: Research subagent (Claude)
Created: 2026-05-21
Feeds: future RFC on JS package surface
---

# Question

Ship `@mdc/parser` only, or also glue plugins for `remark`/`unified` and/or `markdown-it`?

# Findings

## 1. Plugin shape

**remark / unified.** A plugin is a function (optionally taking options) returning a transformer `(tree, file) => void`. Minimal real example — `remark-squeeze-paragraphs/lib/index.js` ([source](https://github.com/remarkjs/remark-squeeze-paragraphs/blob/main/lib/index.js)):

```js
export default function remarkSqueezeParagraphs() {
  return function (tree) { squeezeParagraphs(tree) }
}
```

Eight lines ignoring JSDoc. That is the shape.

**markdown-it.** `function(md, options?)` registered via `md.use(plugin)`. It mutates the `md` instance — pushes rules onto core/block/inline rulers and/or sets `md.renderer.rules.*`. Minimal real example — `markdown-it-sub` ([source](https://github.com/markdown-it/markdown-it-sub/blob/master/index.mjs)): `md.inline.ruler.after('emphasis', 'sub', subscript)` plus a render rule, ~40 LOC including the `~text~` tokenizer.

## 2. AST access

**remark:** full mdast handed to the transformer. Custom node types inject freely; unknown visitors skip them. No fork needed.

**markdown-it:** no AST — flat token stream ("Instead of a traditional AST, we follow the KISS principle" — [architecture.md](https://github.com/markdown-it/markdown-it/blob/master/docs/architecture.md)). Custom token types are allowed and ignored unless `renderer.rules[type]` is set. `token.map` is line-range, not byte-range.

## 3. Dep tree (measured `npm install`, 2026-05-21, npm 10)

| Package        | Transitive pkgs | `node_modules` |
| -------------- | --------------: | -------------: |
| `remark@15`    |              48 |         4.1 MB |
| `markdown-it`  |               7 |         1.8 MB |

`markdown-it` pulls `argparse, entities, linkify-it, mdurl, punycode.js, uc.micro`. `remark` pulls the entire `micromark-*` + `mdast-util-*` + `unified` stack.

## 4. Idiomatic glue (~30 LOC)

Both wrap `@mdc/parser`'s byte-position scan; neither re-parses markdown.

```js
// @mdc/remark
import { scan } from '@mdc/parser'
export default function remarkMdc() {
  return (tree, file) => {
    for (const ann of scan(String(file))) {
      // walk tree; replace HTML node covering ann.offset
      // with { type: 'mdcAnnotation', data: ann }
    }
  }
}
```

```js
// @mdc/markdown-it
import { scan } from '@mdc/parser'
export default function mdcPlugin(md) {
  md.core.ruler.after('block', 'mdc', state => {
    const anns = scan(state.src)
    // rewrite html_block/html_inline tokens at matched offsets
    // to type 'mdc_annotation', stash data on token.meta
  })
  md.renderer.rules.mdc_annotation = (toks, i) => /* span */ ''
}
```

## 5. Adoption surfaces

- **VS Code** preview/extensions: **markdown-it** — `extendMarkdownIt` hook ([docs](https://code.visualstudio.com/api/extension-guides/markdown-extension)).
- **Obsidian** plugins: neither — `registerMarkdownPostProcessor` runs over rendered HTML ([docs](https://docs.obsidian.md/Plugins/Editor/Markdown+post+processing)). Bare `@mdc/parser` fits.
- **MDX / Astro / Docusaurus / Next.js MDX**: **remark**.
- **Eleventy, VitePress**: **markdown-it**.
- **GitHub Apps**: server-side, language-agnostic — neither dominates.

# Recommendation: **(a) ship `@mdc/parser` only**

`@mdc/parser` does the load-bearing work — byte-positioned annotation scanning. Obsidian uses it directly. VS Code, MDX, and the SSGs each get a ~30-LOC example in `docs/examples/`, copy-pasteable, zero maintenance debt.

- **Commitment 2 (format over app).** Reach is bounded by the parser working, not by us owning two npm packages. Examples reach every ecosystem; published plugins lock us into two release cadences, two issue trackers, two compat matrices.
- **Commitment 5 (delete more than we add).** Two packages for ~60 LOC of glue is the textbook bloat we refuse.
- **Practical.** We don't know whether the first real adopter lands on remark or markdown-it. Shipping neither lets the first PR tell us which to absorb. Promotion from example to package is cheap; deprecation is not.

# Honest gaps

- "Reach" rests on engine docs and ecosystem knowledge, not a downloads-weighted survey.
- Glue sketches assume `@mdc/parser` exposes `scan(src) → Annotation[]` with byte offsets. RFC-0002 implies this; verify when the package lands.
- Sketches are illustrative — not run against fixtures.
