import { describe, test, expect, mock, beforeEach } from "bun:test";
import { resolvers } from "./resolvers.js";
import { GraphQLError } from "graphql";

// ---------------------------------------------------------------------------
// Mocked Prisma client (unit tests run without a database)
//
// Every Prisma call the resolvers use gets its own mock function so each
// test can decide what the "database" should return.
// ---------------------------------------------------------------------------

interface UniqueWhere {
  where: { id?: string; slug?: string };
}

interface FindManyArgs {
  where: Record<string, unknown>;
  take?: number;
  skip?: number;
  cursor?: { id: string };
}

export interface MockCollection {
  id: string;
  name: string;
  slug: string;
}

export interface MockDocument {
  id: string;
  title: string;
  content: string;
  tags: string[];
  collectionId: string;
  isArchived: boolean;
}

function fakeCollection(overrides: Partial<MockCollection> = {}): MockCollection {
  return { id: "coll-1", name: "Test Collection", slug: "test-collection", ...overrides };
}

function fakeDocument(overrides: Partial<MockDocument> = {}): MockDocument {
  return {
    id: "doc-1",
    title: "Test Document",
    content: "Test content",
    tags: [],
    collectionId: "coll-1",
    isArchived: false,
    ...overrides,
  };
}

const collectionFindUnique = mock((_args: UniqueWhere): Promise<MockCollection | null> => Promise.resolve(null));
const collectionCreate = mock((_args: { data: { name: string; slug: string } }): Promise<MockCollection> =>
  Promise.resolve(fakeCollection())
);
const documentFindUnique = mock((_args: UniqueWhere): Promise<MockDocument | null> => Promise.resolve(null));
const documentFindMany = mock((_args: FindManyArgs): Promise<MockDocument[]> => Promise.resolve([]));
const documentUpdate = mock((_args: { where: UniqueWhere["where"]; data: Record<string, unknown> }): Promise<MockDocument> =>
  Promise.resolve(fakeDocument())
);

mock.module("./lib/prisma.js", () => ({
  prisma: {
    collection: {
      findUnique: (args: UniqueWhere) => collectionFindUnique(args),
      create: (args: { data: { name: string; slug: string } }) => collectionCreate(args),
    },
    document: {
      findUnique: (args: UniqueWhere) => documentFindUnique(args),
      findMany: (args: FindManyArgs) => documentFindMany(args),
      update: (args: { where: UniqueWhere["where"]; data: Record<string, unknown> }) => documentUpdate(args),
    },
  },
}));

// Reset all mocks to their "empty database" defaults before every test
beforeEach(() => {
  collectionFindUnique.mockImplementation(() => Promise.resolve(null));
  collectionCreate.mockImplementation((args) => Promise.resolve(fakeCollection(args.data)));
  documentFindUnique.mockImplementation(() => Promise.resolve(null));
  documentFindMany.mockImplementation(() => Promise.resolve([]));
  documentUpdate.mockImplementation(() => Promise.resolve(fakeDocument()));
});

// ---------------------------------------------------------------------------
// Validation tests
// ---------------------------------------------------------------------------

describe("Unit — input validation", () => {
  test("createCollection rejects malformed slugs", async () => {
    const malformedSlugs = [
      "Invalid Slug",
      "invalid_slug",
      "slug-",
      "-slug",
      "slug!!",
    ];

    for (const slug of malformedSlugs) {
      await expect(
        resolvers.Mutation.createCollection(null, { name: "Test Col", slug })
      ).rejects.toThrow(GraphQLError);
    }
  });

  test("createCollection accepts valid slugs", async () => {
    const validSlugs = ["valid-slug", "slug123", "another-valid-slug-456"];

    for (const slug of validSlugs) {
      const result = await resolvers.Mutation.createCollection(null, { name: "Test Col", slug });
      expect(result.slug).toBe(slug);
    }
  });

  test("createCollection rejects an already-used slug", async () => {
    collectionFindUnique.mockImplementation(async () => fakeCollection({ slug: "taken-slug" }));

    await expect(
      resolvers.Mutation.createCollection(null, { name: "Test Col", slug: "taken-slug" })
    ).rejects.toThrow("A collection with this slug already exists");
  });

  test("createDocument rejects empty or whitespace-only title/content", async () => {
    await expect(
      resolvers.Mutation.createDocument(null, {
        title: "",
        content: "Valid content",
        collectionId: "coll-1",
      })
    ).rejects.toThrow("title cannot be empty");

    await expect(
      resolvers.Mutation.createDocument(null, {
        title: "   ",
        content: "Valid content",
        collectionId: "coll-1",
      })
    ).rejects.toThrow("title cannot be empty");

    await expect(
      resolvers.Mutation.createDocument(null, {
        title: "Valid Title",
        content: "",
        collectionId: "coll-1",
      })
    ).rejects.toThrow("content cannot be empty");
  });

  test("createDocument rejects when the collection does not exist", async () => {
    await expect(
      resolvers.Mutation.createDocument(null, {
        title: "Valid Title",
        content: "Valid content",
        collectionId: "missing-coll",
      })
    ).rejects.toThrow("Collection not found");
  });
});

// ---------------------------------------------------------------------------
// Not-found error paths
// ---------------------------------------------------------------------------

describe("Unit — not-found error handling", () => {
  test("updateDocument rejects a nonexistent document id", async () => {
    await expect(
      resolvers.Mutation.updateDocument(null, { id: "missing-doc", title: "New" })
    ).rejects.toThrow("Document not found");
  });

  test("deleteDocument rejects a nonexistent document id", async () => {
    await expect(
      resolvers.Mutation.deleteDocument(null, { id: "missing-doc" })
    ).rejects.toThrow("Document not found");
  });

  test("moveDocument rejects a nonexistent document id", async () => {
    await expect(
      resolvers.Mutation.moveDocument(null, { id: "missing-doc", collectionId: "coll-1" })
    ).rejects.toThrow("Document not found");
  });

  test("moveDocument rejects a nonexistent target collection id", async () => {
    documentFindUnique.mockImplementation(async () => fakeDocument());

    await expect(
      resolvers.Mutation.moveDocument(null, { id: "doc-1", collectionId: "missing-coll" })
    ).rejects.toThrow("Target collection not found");
  });

  test("moveDocument succeeds when both document and target exist", async () => {
    documentFindUnique.mockImplementation(async () => fakeDocument());
    collectionFindUnique.mockImplementation(async () =>
      fakeCollection({ id: "target-coll", slug: "target-collection" })
    );
    documentUpdate.mockImplementation(async (args) =>
      fakeDocument({ collectionId: String(args.data.collectionId) })
    );

    const result = await resolvers.Mutation.moveDocument(null, { id: "doc-1", collectionId: "target-coll" });

    expect(result.collectionId).toBe("target-coll");
    expect(documentUpdate).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: { collectionId: "target-coll" },
    });
  });
});

// ---------------------------------------------------------------------------
// Cursor pagination (fake in-memory dataset ordered by id)
// ---------------------------------------------------------------------------

function makeDocuments(count: number): MockDocument[] {
  return Array.from({ length: count }, (_, i) =>
    fakeDocument({
      id: `doc-${String(i).padStart(2, "0")}`, // sorts lexicographically
      title: `Doc ${i}`,
    })
  );
}

describe("Unit — cursor pagination on documents query", () => {
  const dataset = makeDocuments(14); // pages of 5 → 5 + 5 + 4

  beforeEach(() => {
    // Imitate Prisma's cursor behaviour against an ordered list
    documentFindMany.mockImplementation(async (args) => {
      let start = 0;
      if (args.cursor) {
        start = dataset.findIndex((d) => d.id === args.cursor!.id) + 1;
      }
      return dataset.slice(start, start + (args.take ?? dataset.length));
    });
  });

  test("first page returns 'take' items with hasNextPage true", async () => {
    const page = await resolvers.Query.documents(null, { take: 5 });

    expect(page.edges.map((e) => e.node.id)).toEqual([
      "doc-00", "doc-01", "doc-02", "doc-03", "doc-04",
    ]);
    expect(page.pageInfo.hasNextPage).toBe(true);
    expect(page.pageInfo.endCursor).toBe("doc-04");
  });

  test("second page resumes after endCursor without duplicates", async () => {
    const page1 = await resolvers.Query.documents(null, { take: 5 });
    const page2 = await resolvers.Query.documents(null, {
      take: 5,
      cursor: page1.pageInfo.endCursor!,
    });

    const ids1 = page1.edges.map((e) => e.node.id);
    const ids2 = page2.edges.map((e) => e.node.id);

    expect(ids2).toEqual(["doc-05", "doc-06", "doc-07", "doc-08", "doc-09"]);
    expect(ids2.filter((id) => ids1.includes(id))).toEqual([]);

    // The resolver must ask Prisma to skip the cursor item itself
    expect(documentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: "doc-04" }, skip: 1 })
    );
  });

  test("final page reports hasNextPage false", async () => {
    let cursor: string | undefined;
    let lastPage = await resolvers.Query.documents(null, { take: 5, cursor });

    while (lastPage.pageInfo.hasNextPage) {
      lastPage = await resolvers.Query.documents(null, { take: 5, cursor: lastPage.pageInfo.endCursor! });
    }

    expect(lastPage.edges.map((e) => e.node.id)).toEqual(["doc-10", "doc-11", "doc-12", "doc-13"]);
    expect(lastPage.pageInfo.hasNextPage).toBe(false);
    expect(lastPage.pageInfo.endCursor).toBe("doc-13");
  });

  test("walking every page yields each document exactly once", async () => {
    const seen: string[] = [];
    let hasNext = true;
    let cursor: string | undefined;

    while (hasNext) {
      const page = await resolvers.Query.documents(null, { take: 5, cursor });
      seen.push(...page.edges.map((e) => e.node.id));
      hasNext = page.pageInfo.hasNextPage;
      cursor = page.pageInfo.endCursor ?? undefined;
    }

    expect(seen.length).toBe(dataset.length);
    expect(new Set(seen).size).toBe(dataset.length);
  });
});
