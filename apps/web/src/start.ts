import { createStart } from "@tanstack/react-start";

// Pure client app: data lives in the local Bun API, so nothing renders on a server.
export const startInstance = createStart(() => ({ defaultSsr: false }));
