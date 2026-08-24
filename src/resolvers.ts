import { GraphQLError } from "graphql";
import { Prisma } from "@prisma/client";
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

// Validation helpers
function validateNonEmptyString(value: string, fieldName: string) {
  if (!value || value.trim() === "") {
    throw new GraphQLError(`${fieldName} cannot be empty or contain only whitespace`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
}

function validateSlug(slug: string) {
  // Slugs must contain only lowercase letters, numbers, and hyphens (e.g. "my-collection-123")
  const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  if (!slugRegex.test(slug)) {
    throw new GraphQLError("Slug is malformed. It must contain only lowercase letters, numbers, and single hyphens, and cannot start or end with a hyphen", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
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
      const where: Prisma.DocumentWhereInput = {};

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
      const queryOptions: Prisma.DocumentFindManyArgs = {
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
      validateNonEmptyString(args.name, "Collection name");
      validateNonEmptyString(args.slug, "Collection slug");
      validateSlug(args.slug);

      // Check if the slug is already in use
      const existing = await prisma.collection.findUnique({
        where: { slug: args.slug },
      });
      if (existing) {
        throw new GraphQLError("A collection with this slug already exists", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }

      return prisma.collection.create({
        data: {
          name: args.name,
          slug: args.slug,
        },
      });
    },

    // 5. Create a new document in a collection
    createDocument: async (_parent: unknown, args: CreateDocumentArgs) => {
      validateNonEmptyString(args.title, "Document title");
      validateNonEmptyString(args.content, "Document content");

      // Verify collection exists
      const collection = await prisma.collection.findUnique({
        where: { id: args.collectionId },
      });
      if (!collection) {
        throw new GraphQLError("Collection not found", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }

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

      // Verify document exists
      const existing = await prisma.document.findUnique({
        where: { id },
      });
      if (!existing) {
        throw new GraphQLError("Document not found", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }

      if (data.title !== undefined) {
        validateNonEmptyString(data.title, "Document title");
      }
      if (data.content !== undefined) {
        validateNonEmptyString(data.content, "Document content");
      }

      return prisma.document.update({
        where: { id },
        data,
      });
    },

    // 7. Delete a document permanently
    deleteDocument: async (_parent: unknown, args: IdArgs) => {
      const existing = await prisma.document.findUnique({
        where: { id: args.id },
      });
      if (!existing) {
        throw new GraphQLError("Document not found", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }

      await prisma.document.delete({
        where: { id: args.id },
      });
      return true;
    },

    // 8. Move a document to a different collection
    moveDocument: async (_parent: unknown, args: MoveDocumentArgs) => {
      // Verify the document itself exists
      const document = await prisma.document.findUnique({
        where: { id: args.id },
      });
      if (!document) {
        throw new GraphQLError("Document not found", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }

      // Verify the destination collection exists
      const targetCollection = await prisma.collection.findUnique({
        where: { id: args.collectionId },
      });
      if (!targetCollection) {
        throw new GraphQLError("Target collection not found", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }

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
