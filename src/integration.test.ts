import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "./lib/prisma.js";
import { resolvers } from "./resolvers.js";

// ---------------------------------------------------------------------------
// Integration tests — run against the real Dockerized PostgreSQL database.

// No mocking here on purpose: these tests exercise the actual resolvers and
// Prisma queries end-to-end. If PostgreSQL is not running they skip safely.
// ---------------------------------------------------------------------------

let dbAvailable = false;

beforeAll(async () => {
  try {
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    console.warn("\n⚠️  PostgreSQL is not running. Skipping integration tests.");
  }
});

afterAll(async () => {
  if (dbAvailable) {
    // Clean up every record this suite created (runs even if a test failed)
    await prisma.document.deleteMany({ where: { collectionId: { in: createdCollectionIds } } });
    await prisma.collection.deleteMany({ where: { id: { in: createdCollectionIds } } });
    await prisma.$disconnect();
  }
});

const createdCollectionIds: string[] = [];

describe("Integration — resolvers against Docker PostgreSQL", () => {
  const slug = `int-test-${Date.now()}`;
  let collectionId = "";
  let otherCollectionId = "";

  test("creates a collection and documents through resolvers", async () => {
    if (!dbAvailable) return;

    const collection = await resolvers.Mutation.createCollection(null, {
      name: "Integration Collection",
      slug,
    });
    collectionId = collection.id;
    createdCollectionIds.push(collectionId);
    expect(collection.slug).toBe(slug);

    const other = await resolvers.Mutation.createCollection(null, {
      name: "Integration Other",
      slug: `${slug}-other`,
    });
    otherCollectionId = other.id;
    createdCollectionIds.push(otherCollectionId);

    for (const title of ["Alpha Report", "Beta Report", "Gamma Report"]) {
      const doc = await resolvers.Mutation.createDocument(null, {
        title,
        content: `Body text for ${title}`,
        tags: ["integration"],
        collectionId,
      });
      expect(doc.id).toBeDefined();
    }

    // Nested relation: the Collection.documents field resolver hits the real DB
    const reloaded = await resolvers.Query.collection(null, { id: collectionId });
    expect(reloaded).not.toBeNull();
    const nestedDocs = await resolvers.Collection.documents(reloaded!);
    expect(nestedDocs.length).toBe(3);
  });

  test("documents query filters by substring search on title OR content", async () => {
    if (!dbAvailable) return;

    const byTitle = await resolvers.Query.documents(null, { collectionId, search: "beta" });
    expect(byTitle.edges.length).toBe(1);
    expect(byTitle.edges[0]!.node.title).toBe("Beta Report");

    const byContent = await resolvers.Query.documents(null, { collectionId, search: "text for gamma" });
    expect(byContent.edges.length).toBe(1);
    expect(byContent.edges[0]!.node.title).toBe("Gamma Report");
  });

  test("cursor pagination walks two real pages without duplicates", async () => {
    if (!dbAvailable) return;

    const page1 = await resolvers.Query.documents(null, { collectionId, take: 2 });
    expect(page1.edges.length).toBe(2);
    expect(page1.pageInfo.hasNextPage).toBe(true);

    const page2 = await resolvers.Query.documents(null, {
      collectionId,
      take: 2,
      cursor: page1.pageInfo.endCursor!,
    });
    expect(page2.edges.length).toBe(1);
    expect(page2.pageInfo.hasNextPage).toBe(false);

    const ids1 = page1.edges.map((e) => e.node.id);
    const ids2 = page2.edges.map((e) => e.node.id);
    expect(ids2.filter((id) => ids1.includes(id))).toEqual([]);

    const allTitles = [...page1.edges, ...page2.edges].map((e) => e.node.title).sort();
    expect(allTitles).toEqual(["Alpha Report", "Beta Report", "Gamma Report"]);
  });

  test("moveDocument moves a document to another real collection", async () => {
    if (!dbAvailable) return;

    const docs = await resolvers.Query.documents(null, { collectionId });
    const docToMove = docs.edges[0]!.node;

    const moved = await resolvers.Mutation.moveDocument(null, {
      id: docToMove.id,
      collectionId: otherCollectionId,
    });
    expect(moved.collectionId).toBe(otherCollectionId);

    const sourceDocs = await resolvers.Query.documents(null, { collectionId });
    expect(sourceDocs.edges.length).toBe(2);
  });

  test("resolver error paths return GraphQLError against the real database", async () => {
    if (!dbAvailable) return;

    await expect(
      resolvers.Mutation.updateDocument(null, { id: "no-such-doc-id", title: "X" })
    ).rejects.toThrow("Document not found");

    await expect(
      resolvers.Mutation.moveDocument(null, { id: "no-such-doc-id", collectionId: otherCollectionId })
    ).rejects.toThrow("Document not found");

    await expect(
      resolvers.Mutation.deleteDocument(null, { id: "no-such-doc-id" })
    ).rejects.toThrow("Document not found");

    await expect(
      resolvers.Mutation.createCollection(null, { name: "Dup", slug })
    ).rejects.toThrow("A collection with this slug already exists");
  });
});
