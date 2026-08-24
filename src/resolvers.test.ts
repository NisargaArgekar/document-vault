import { expect, test, describe, mock, beforeAll, afterAll } from "bun:test";
import { resolvers } from "./resolvers.js";
import { GraphQLError } from "graphql";

// 1. Mock the Prisma client for our Unit Tests
// This intercepts import requests to "./lib/prisma.ts" and returns mock functions
mock.module("./lib/prisma.ts", () => {
  return {
    prisma: {
      collection: {
        findUnique: async () => null,
        findMany: async () => [],
        create: async ({ data }: any) => ({
          id: "mock-coll-id",
          name: data.name,
          slug: data.slug,
          createdAt: new Date(),
        }),
      },
      document: {
        findUnique: async () => null,
        findMany: async () => [],
        create: async ({ data }: any) => ({
          id: "mock-doc-id",
          title: data.title,
          content: data.content,
          tags: data.tags,
          collectionId: data.collectionId,
          isArchived: false,
          createdAt: new Date(),
        }),
      },
    },
  };
});

describe("Unit Tests — Resolvers & Validation", () => {
  // Test slug validations
  test("createCollection should reject malformed slugs", async () => {
    const malformedSlugs = [
      "Invalid Slug",   // contains space
      "invalid_slug",   // contains underscore
      "slug-",          // ends with hyphen
      "-slug",          // starts with hyphen
      "slug!!",         // contains special characters
    ];

    for (const slug of malformedSlugs) {
      expect(
        resolvers.Mutation.createCollection(null, { name: "Test Col", slug })
      ).rejects.toThrow(GraphQLError);
    }
  });

  test("createCollection should accept valid slugs", async () => {
    const validSlugs = ["valid-slug", "slug123", "another-valid-slug-456"];
    
    for (const slug of validSlugs) {
      const result = await resolvers.Mutation.createCollection(null, {
        name: "Test Col",
        slug,
      });
      expect(result.slug).toBe(slug);
    }
  });

  // Test empty title validations
  test("createDocument should reject empty title or content", async () => {
    // Empty title
    expect(
      resolvers.Mutation.createDocument(null, {
        title: "",
        content: "Valid content",
        collectionId: "mock-coll-id",
      })
    ).rejects.toThrow("title cannot be empty");

    // Whitespace title
    expect(
      resolvers.Mutation.createDocument(null, {
        title: "    ",
        content: "Valid content",
        collectionId: "mock-coll-id",
      })
    ).rejects.toThrow("title cannot be empty");

    // Empty content
    expect(
      resolvers.Mutation.createDocument(null, {
        title: "Valid Title",
        content: "",
        collectionId: "mock-coll-id",
      })
    ).rejects.toThrow("content cannot be empty");
  });
});

// 2. Integration Test
// We import the real prisma instance to check database availability
import { prisma as realPrisma } from "./lib/prisma.js";

describe("Integration Test — Docker PostgreSQL Database", () => {
  let isDbConnected = false;

  beforeAll(async () => {
    try {
      // Check if real database is available
      await realPrisma.$connect();
      isDbConnected = true;
    } catch (e) {
      console.warn("\n⚠️  PostgreSQL is not running. Skipping integration tests.");
    }
  });

  afterAll(async () => {
    if (isDbConnected) {
      await realPrisma.$disconnect();
    }
  });

  test("Should perform end-to-end database flow", async () => {
    if (!isDbConnected) {
      // Skip if database is not running
      return;
    }

    const testSlug = `test-integration-slug-${Date.now()}`;

    // 1. Create a test collection
    const collection = await realPrisma.collection.create({
      data: {
        name: "Integration Test Col",
        slug: testSlug,
      },
    });
    expect(collection.id).toBeDefined();

    // 2. Create a document in that collection
    const document = await realPrisma.document.create({
      data: {
        title: "Integration Test Document Title",
        content: "This is some database integration test content",
        collectionId: collection.id,
        tags: ["test", "integration"],
      },
    });
    expect(document.id).toBeDefined();

    // 3. Search for the document and verify the title contains query
    const searchResults = await realPrisma.document.findMany({
      where: {
        collectionId: collection.id,
        OR: [
          { title: { contains: "Integration", mode: "insensitive" } },
          { content: { contains: "Integration", mode: "insensitive" } },
        ],
      },
    });
    expect(searchResults.length).toBe(1);
    expect(searchResults[0]!.title).toBe("Integration Test Document Title");

    // 4. Clean up test records
    await realPrisma.document.delete({ where: { id: document.id } });
    await realPrisma.collection.delete({ where: { id: collection.id } });
  });
});
