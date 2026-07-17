// Global vitest setup. Extends `expect` with @testing-library/jest-dom matchers
// (toBeInTheDocument, toHaveTextContent, …) for the component tests that opt into
// the jsdom environment via a `// @vitest-environment jsdom` file header. Harmless
// for the node-env unit tests - the matchers just go unused there.
import "@testing-library/jest-dom/vitest";
