# Document Vault — GraphQL API

A clean, type-safe, schema-first GraphQL API for organizing documents into collections, built using the modern **Bun** runtime, **TypeScript**, **GraphQL Yoga**, **Prisma ORM**, and **PostgreSQL**.

---

## 🚀 One-Command Setup

Run the following command in your terminal to start the database, install all dependencies, execute database migrations, and boot the development server:

```bash
docker compose up -d && bun install && bun run gendb && bun run dev
```

*The server will be running at:* **`http://localhost:4000/graphql`**

---

## 🛠️ Technology Stack

* **Runtime & Package Manager**: [Bun](https://bun.sh/) (high-performance runtime with built-in test runner)
* **API Layer**: [GraphQL Yoga](https://the-guild.dev/graphql/yoga-server) (schema-first approach)
* **Language**: [TypeScript](https://www.typescriptlang.org/) (Strict Mode, zero `any` usage)
* **Database client**: [Prisma ORM v7](https://www.prisma.io/) (with standard `@prisma/adapter-pg` driver adapter)
* **Database**: [PostgreSQL 16](https://www.postgresql.org/) (containerized via Docker Compose)
* **Testing**: Bun's native test runner (`bun test`)

---

## 📦 Prerequisites

Ensure you have the following installed on your machine:
* [Bun](https://bun.sh/) (v1.4.0 or higher)
* [Docker Desktop](https://www.docker.com/products/docker-desktop/) (must be running to start the database container)

---

## ⚙️ Environment Variables

The project uses `.env` files to configure environment parameters. A template is provided in [`.env.example`](./.env.example).

| Variable | Description | Default Local Value |
| :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string for Prisma | `postgresql://docvault:docvault123@localhost:5432/docvault` |
| `POSTGRES_USER` | PostgreSQL superuser for Docker container | `docvault` |
| `POSTGRES_PASSWORD` | PostgreSQL password for Docker container | `docvault123` |
| `POSTGRES_DB` | PostgreSQL database name for Docker container | `docvault` |

---

## 🧪 Running Tests

We use Bun's built-in testing runner to run both unit and integration tests.

```bash
# Run all tests
bun run test
```

### Test Suite Structure
* **Unit Tests**: Test input validations (empty values, malformed slugs) in absolute isolation using Bun module mocking. Runs without needing a database.
* **Integration Tests**: Tests end-to-end database operations (inserts, relation querying, searching, and deletes). It automatically checks database availability, logging a warning and skipping safely if the database is down.

---

## 📖 GraphQL API Documentation (Playground)

When the server is running, navigate to `http://localhost:4000/graphql` to access the interactive GraphQL Playground.

### 1. Create a Collection (Mutation)
Creates a folder-like group for documents. Slugs must contain only lowercase alphanumeric characters and hyphens.
```graphql
mutation CreateCollection {
  createCollection(name: "Engineering Guidelines", slug: "engineering-guidelines") {
    id
    name
    slug
    createdAt
  }
}
```

### 2. Create a Document (Mutation)
Creates a document and links it to a collection. Title and content cannot be empty.
```graphql
mutation CreateDocument {
  createDocument(
    title: "TypeScript Configuration"
    content: "Make sure strict mode is turned on in tsconfig.json."
    tags: ["typescript", "configuration"]
    collectionId: "INSERT_COLLECTION_ID_HERE"
  ) {
    id
    title
    content
    tags
    isArchived
    createdAt
    collection {
      name
    }
  }
}
```

### 3. Query Collections with Nested Documents (Query)
Loads all collections and their related documents.
```graphql
query GetCollections {
  collections {
    id
    name
    slug
    documents {
      id
      title
      isArchived
    }
  }
}
```

### 4. Paginated & Filtered Documents (Query)
Search documents with substring filters on `title` OR `content`, filtered by collection or archive status, using cursor-based pagination.
```graphql
query GetDocuments {
  documents(
    collectionId: "INSERT_COLLECTION_ID_HERE"
    search: "strict"
    isArchived: false
    take: 5
    cursor: "INSERT_LAST_DOCUMENT_ID_HERE"
  ) {
    edges {
      cursor
      node {
        id
        title
        content
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

### 5. Update a Document (Mutation)
```graphql
mutation UpdateDocument {
  updateDocument(
    id: "INSERT_DOCUMENT_ID_HERE"
    title: "Updated TypeScript Guidelines"
    isArchived: true
  ) {
    id
    title
    isArchived
  }
}
```

### 6. Move a Document (Mutation)
Moves a document to another collection.
```graphql
mutation MoveDocument {
  moveDocument(id: "INSERT_DOCUMENT_ID_HERE", collectionId: "INSERT_NEW_COLLECTION_ID_HERE") {
    id
    collectionId
    collection {
      name
    }
  }
}
```

### 7. Delete a Document (Mutation)
Permanently deletes a document.
```graphql
mutation DeleteDocument {
  deleteDocument(id: "INSERT_DOCUMENT_ID_HERE")
}
```

---

## 🏛️ Architecture Details

The application is structured logically to separate concerns:
1. **Schema-first Contract** (`src/schema.graphql`): The API surface is defined explicitly.
2. **HTTP Server** (`src/index.ts`): Uses GraphQL Yoga and Bun.serve to parse requests and direct them to the appropriate resolver.
3. **Resolvers** (`src/resolvers.ts`): Implements input validations (e.g. regex check for slugs) and coordinates operations with Prisma.
4. **Data Access** (`src/lib/prisma.ts`): Configures the database client and pg connection pool.

---

## ⚖️ Design Decisions & Future Extensions

### Design Decisions
* **Cursor Pagination**: Used for the `documents` query instead of offset pagination. Cursor pagination is highly performant for large datasets and avoids duplicate records when items are added/deleted while scrolling.
* **Driver Adapters**: Prisma 7 requires driver adapters (`@prisma/adapter-pg` + `pg` connection pooling) for direct database connections, separating database administration (migrations via CLI) from runtime pool execution.
* **Inline Validations**: Validation runs in the resolvers prior to database interactions to minimize database load and return client-friendly `GraphQLError` format.

### Future Extensions
* **Database Indexes**: Add indexes to `title` and `content` text fields in the PostgreSQL database (using GiST or GIN trigram indexes) to make substring matching (`contains`) highly performant as document count grows.
* **Soft Deletes Middleware**: Instead of deleting documents permanently, implement database-level soft deletes (using Prisma middleware) to automatically filter out archived documents by default.
* **Authentication & Authorization**: Integrate GraphQL Shield to support Role-Based Access Control (RBAC) to restrict collection modifications to administrators.
