CREATE TYPE "CollectionVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

ALTER TABLE "collections"
ADD COLUMN "visibility" "CollectionVisibility" NOT NULL DEFAULT 'PRIVATE';

ALTER TABLE "tool_collection_links"
ADD COLUMN "addedByUserId" TEXT;
