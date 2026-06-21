/// <reference types="vite/client" />

// Allow side-effect CSS imports (e.g. `import "./App.css"`). Vite handles the
// actual bundling; this just gives TypeScript an ambient module so tsc doesn't
// error on the import. Mirrors the standard Vite React + TS setup.
declare module "*.css";
