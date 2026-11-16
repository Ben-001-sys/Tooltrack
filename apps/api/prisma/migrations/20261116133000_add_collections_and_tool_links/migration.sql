-- CreateTable
CREATE TABLE "collections" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_collection_links" (
    "id" UUID NOT NULL,
    "toolId" UUID NOT NULL,
    "collectionId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_collection_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "collections_userId_idx" ON "collections"("userId");

-- CreateIndex
CREATE INDEX "tool_collection_links_collectionId_idx" ON "tool_collection_links"("collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "tool_collection_links_toolId_collectionId_key" ON "tool_collection_links"("toolId", "collectionId");
