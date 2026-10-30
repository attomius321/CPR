# Goal: count Rust, Swift and Lua right

`loc` knows Rust, Swift and Lua only roughly (`src/languages.ts`): Rust's and Swift's block comments
do not nest, raw strings and Lua's long brackets with `=` are unknown, and Rust's `'` is taken for
a string. Lines are miscounted. Teach `loc` each one's real comments and strings, so `countLines`
sorts their lines right (the rule for a line stays: blank, a comment when it holds only comments,
otherwise code). Keep every other language counted as it is now. No new dependencies.

1. **Rust**: `.rs` files, the language `Rust`, a source.
   - `//` line comments (`///` and `//!` too); `/* */` block comments, which nest:
     `/* a /* b */ still a comment */`, over any number of lines.
   - Strings `"…"` with backslash escapes, which may go on over lines; raw strings `r"…"`,
     `r#"…"#`, `r##"…"##` (any number of `#`; the closer is `"` and the same number of `#`; no
     escapes), which may go on over lines; byte strings `b"…"`, `br"…"`, `br#"…"#` likewise.
   - `'` starts a character literal only when one character, or one escape (`'\n'`, `'\''`,
     `'\\'`, `'\u{1F600}'`), and a closing `'` follow it on the line; otherwise it is a lifetime
     or a label (`'a`, `'static`, `'outer:`) and starts nothing.
2. **Swift**: `.swift` files, the language `Swift`, a source.
   - `//` line comments; `/* */` block comments, which nest, as Rust's.
   - Strings `"…"` with backslash escapes, ending on their line; multi-line strings `"""…"""`;
     raw strings `#"…"#` and `#"""…"""#` with any number of `#` (the closer is the quotes and the
     same number of `#`; a backslash escapes nothing unless that many `#` follow it). A `#` not
     followed by more `#` and a `"` starts nothing (`#if`, `#selector`).
3. **Lua**: `.lua` files, the language `Lua`, a source.
   - `--` line comments; long comments `--[[ … ]]` and `--[==[ … ]==]` (any number of `=`; the
     closer has the same number), which may go on over lines. `--[` not followed by `=`s and
     another `[` is a line comment.
   - Strings `"…"` and `'…'` with backslash escapes, ending on their line; long strings `[[ … ]]`
     and `[==[ … ]==]` (the same rule for `=`), which may go on over lines.
