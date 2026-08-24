import { createYoga, createSchema } from "graphql-yoga";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 1. Read the schema file
const schemaPath = join(import.meta.dirname, "schema.graphql");
const typeDefs = readFileSync(schemaPath, "utf-8");

import { resolvers } from "./resolvers.js";

// 3. Create the GraphQL Schema using our typeDefs and resolvers
const schema = createSchema({
  typeDefs,
  resolvers,
});

// 4. Create the GraphQL Yoga server instance
const yoga = createYoga({
  schema,
  landingPage: true, // Enables the interactive GraphQL Playground in the browser
});

// 5. Start the Bun HTTP Server on port 4000
const server = Bun.serve({
  port: 4000,
  fetch: (request) => yoga.handle(request),
});

console.log(`🚀 Document Vault server is running on ${server.url}graphql`);
