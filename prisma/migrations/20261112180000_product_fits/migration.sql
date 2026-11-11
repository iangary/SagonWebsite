-- CreateTable
CREATE TABLE "product_fits" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "heightMin" INTEGER,
    "heightMax" INTEGER,
    "weightMin" INTEGER,
    "weightMax" INTEGER,
    "bustMin" INTEGER,
    "bustMax" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_fits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_fits_productId_size_key" ON "product_fits"("productId", "size");

-- AddForeignKey
ALTER TABLE "product_fits" ADD CONSTRAINT "product_fits_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

