CREATE TYPE "TagKind" AS ENUM ('DEPARTMENT', 'GENERAL');

CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "TagKind" NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tags_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tags_name_check" CHECK (length(btrim("name")) > 0 AND "name" = btrim("name")),
    CONSTRAINT "tags_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE UNIQUE INDEX "tags_normalized_name_key" ON "tags" (lower("name"));
CREATE UNIQUE INDEX "tags_slug_key" ON "tags" ("slug");

CREATE TABLE "tool_tags" (
    "toolId" UUID NOT NULL,
    "tagId" UUID NOT NULL,
    CONSTRAINT "tool_tags_pkey" PRIMARY KEY ("toolId", "tagId"),
    CONSTRAINT "tool_tags_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "tools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tool_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "tool_tags_tagId_idx" ON "tool_tags" ("tagId");
