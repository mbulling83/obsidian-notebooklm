import esbuild from "esbuild";
const prod = process.argv[2] === "production";
esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  platform: "node",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  outfile: "main.js",
  minify: prod,
}).catch(() => process.exit(1));
