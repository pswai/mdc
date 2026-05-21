# MDC Tag-Syntax Rendering Test

This fixture exists to verify how three candidate tag syntaxes render in real markdown renderers (GitHub web, Obsidian Reading View, and `glow`). The body text below should be the only visible content if the syntax is invisible. If any tag appears as visible noise, that option fails.

---

## Option A — HTML comments with structured attributes

The quick brown fox jumps over the lazy dog. <!--mdc:ann id=a1f7q3 status=open-->

<!--mdc:comment ann=a1f7q3 by=human time=2026-05-21T10:00:00Z
Is "lazy" the right word here?
-->

<!--mdc:comment ann=a1f7q3 by=ai time=2026-05-21T10:01:00Z
"Sleeping" if literal, "indolent" if behavioral. "Lazy" reads pejorative.
-->

The fox ran away. <!--mdc:sug id=s1 by=ai
-The fox ran away.
+The fox darted into the brush.
-->

Edge case: attribute containing greater-than. <!--mdc:ann id=a2 attr="x > y"-->

---

## Option B — Custom XML-like tags (comment-md style)

The quick brown fox jumps over the lazy dog. <annotation id="a1f7q3" status="open"></annotation>

<comment ann="a1f7q3" by="human" time="2026-05-21T10:00:00Z">
Is "lazy" the right word here?
</comment>

<comment ann="a1f7q3" by="ai" time="2026-05-21T10:01:00Z">
"Sleeping" if literal, "indolent" if behavioral.
</comment>

The fox ran away. <suggestion id="s1" by="ai" old="The fox ran away." new="The fox darted into the brush."></suggestion>

---

## Option C — Obsidian-native `%% %%` comments

The quick brown fox jumps over the lazy dog. %%mdc:ann id=a1f7q3 status=open%%

%%mdc:comment ann=a1f7q3 by=human time=2026-05-21T10:00:00Z
Is "lazy" the right word here?
%%

---

## Pass criterion

A syntax passes if a reader of the rendered output sees only:

> The quick brown fox jumps over the lazy dog.
> The fox ran away.

…repeated three times (once per section), with no tags, IDs, attribute strings, or stray whitespace leaks visible.
