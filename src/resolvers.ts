import { prisma } from "./lib/prisma.js";

// Helper interfaces to enforce strict typing (avoiding 'any')
interface IdArgs {
  id: string;
}

interface CreateCollectionArgs {
  name: string;
  slug: string;
}

interface CreateDocumentArgs {
  title: string;
  content: string;
  tags?: string[];
  collectionId: string;
}

interface UpdateDocumentArgs {
  id: string;
  title?: string;
  content?: string;
  tags?: string[];
  isArchived?: boolean;
}

interface MoveDocumentArgs {
  id: string;
  collectionId: string;
}

interface DocumentsArgs {
  collectionId?: string;
  search?: string;
  isArchived?: boolean;
  take?: number;
  cursor?: string;
}

export const resolvers = {
  Query: {
    // 1. Get all collections
    collections: async () => {
      return prisma.collection.findMany({
        orderBy: { createdAt: "desc" },
      });
    },

    // 2. Get a single collection by ID
    collection: async (_parent: unknown, args: IdArgs) => {
      return prisma.collection.findUnique({
        where: { id: args.id },
      });
    },

    // 3. Get filtered/paginated list of documents
    documents: async (_parent: unknown, args: DocumentsArgs) => {
      const { collectionId, search, isArchived, take = 10, cursor } = args;

      // Construct dynamic filters
      const where: any = {};

      if (collectionId !== undefined) {
        where.collectionId = collectionId;
      }

      if (isArchived !== undefined) {
        where.isArchived = isArchived;
      }

      if (search) {
        // substring match on title OR content (case-insensitive)
        where.OR = [
          { title: { contains: search, mode: "insensitive" } },
          { content: { contains: search, mode: "insensitive" } },
        ];
      }

      // Configure cursor-based pagination
      let queryOptions: any = {
        where,
        // We take one extra item to check if there is a next page
        take: take + 1,
        orderBy: { id: "asc" },
      };

      if (cursor) {
        queryOptions.cursor = { id: cursor };
        // Skip the cursor item itself so we don't return it again
        queryOptions.skip = 1;
      }

      const results = await prisma.document.findMany(queryOptions);

      // Check if there is a next page
      const hasNextPage = results.length > take;
      // If we have an extra item, remove it from the results we return
      const paginatedItems = hasNextPage ? results.slice(0, take) : results;

      const endCursor = paginatedItems.length > 0
        ? paginatedItems[paginatedItems.length - 1]!.id
        : null;

      const edges = paginatedItems.map((node) => ({
        node,
        cursor: node.id,
      }));

      return {
        edges,
        pageInfo: {
          hasNextPage,
          endCursor,
        },
      };
    },
  },

  Mutation: {
    // 4. Create a new collection
    createCollection: async (_parent: unknown, args: CreateCollectionArgs) => {
      return prisma.collection.create({
        data: {
          name: args.name,
          slug: args.slug,
        },
      });
    },

    // 5. Create a new document in a collection
    createDocument: async (_parent: unknown, args: CreateDocumentArgs) => {
      return prisma.document.create({
        data: {
          title: args.title,
          content: args.content,
          tags: args.tags || [],
          collectionId: args.collectionId,
        },
      });
    },

    // 6. Update an existing document
    updateDocument: async (_parent: unknown, args: UpdateDocumentArgs) => {
      const { id, ...data } = args;
      return prisma.document.update({
        where: { id },
        data,
      });
    },

    // 7. Delete a document permanently
    deleteDocument: async (_parent: unknown, args: IdArgs) => {
      await prisma.document.delete({
        where: { id: args.id },
      });
      return true;
    },

    // 8. Move a document to a different collection
    moveDocument: async (_parent: unknown, args: MoveDocumentArgs) => {
      return prisma.document.update({
        where: { id: args.id },
        data: {
          collectionId: args.collectionId,
        },
      });
    },
  },

  // Field Resolvers — tell GraphQL how to load relationships
  Collection: {
    documents: async (parent: { id: string }) => {
      return prisma.document.findMany({
        where: { collectionId: parent.id },
        orderBy: { createdAt: "desc" },
      });
    },
  },

  Document: {
    collection: async (parent: { collectionId: string }) => {
      return prisma.collection.findUnique({
        where: { id: parent.collectionId },
      });
    },
  },
};
