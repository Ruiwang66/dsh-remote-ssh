/**
 * Execution-world replacement for `@vscode/ripgrep`.
 *
 * The packaged ripgrep path that DSH's search tools pass as argv[0] is a Host
 * coordinate: it names a Windows/macOS binary inside the DSH installation. A
 * remote Linux execution world cannot open that file, so the subprocess
 * provider maps this marker to the Linux ripgrep asset it provisions on the
 * remote account. Tool argv, glob/regex semantics, parsing, and model-facing
 * results stay exactly those of the official `glob`/`grep` tools.
 */
export const rgPath = 'dsh-packaged-ripgrep:rg'
