# open-coders

The open-coders CLI. It currently exposes only `--help` and `--version`.

## Usage

```sh
open-coders --help
open-coders --version
```

## Development

Requires [Bun](https://bun.sh) 1.3 or later.

```sh
bun install
bun run build
bun test
bun src/index.ts --help
```

The CLI is written in TypeScript and bundled with `bun build --target node`, so
the built file runs on both Bun and Node.js 20 or later.

## License

MIT
