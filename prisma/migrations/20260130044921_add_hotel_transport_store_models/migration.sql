-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PLANNING', 'ONGOING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActivityCategory" AS ENUM ('SIGHTSEEING', 'FOOD', 'ACCOMMODATION', 'TRANSPORTATION', 'ACTIVITY', 'SHOPPING', 'OTHER');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'CHECKED_IN', 'CHECKED_OUT');

-- CreateEnum
CREATE TYPE "TransportType" AS ENUM ('TAXI', 'BUS', 'TRAIN', 'FLIGHT', 'FERRY', 'CAR_RENTAL', 'BICYCLE', 'WALKING', 'OTHER');

-- CreateEnum
CREATE TYPE "TransportStatus" AS ENUM ('BOOKED', 'CONFIRMED', 'ON_THE_WAY', 'ARRIVED', 'CANCELLED', 'DELAYED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'DIGITAL_WALLET', 'ONLINE_PAYMENT', 'VOUCHER');

-- CreateEnum
CREATE TYPE "StoreType" AS ENUM ('SHOPPING', 'SUPERMARKET', 'DEPARTMENT_STORE', 'BOUTIQUE', 'SOUVENIR_SHOP', 'ELECTRONICS', 'BOOKSTORE', 'OTHER');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('PLANNED', 'VISITED', 'PURCHASED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "budget" DOUBLE PRECISION,
    "travelers" INTEGER NOT NULL DEFAULT 1,
    "itinerary" JSONB,
    "recommendations" JSONB,
    "interests" TEXT[],
    "status" "TripStatus" NOT NULL DEFAULT 'PLANNING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "location" TEXT,
    "cost" DOUBLE PRECISION DEFAULT 0,
    "category" "ActivityCategory" NOT NULL DEFAULT 'SIGHTSEEING',
    "aiNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tripId" TEXT NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3) NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "rating" DOUBLE PRECISION DEFAULT 0,
    "pricePerNight" DOUBLE PRECISION,
    "totalCost" DOUBLE PRECISION,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "amenities" TEXT[],
    "roomType" TEXT NOT NULL,
    "roomNumber" TEXT,
    "bookingStatus" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "aiNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tripId" TEXT NOT NULL,

    CONSTRAINT "hotels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transports" (
    "id" TEXT NOT NULL,
    "type" "TransportType" NOT NULL DEFAULT 'TAXI',
    "serviceName" TEXT,
    "pickupLocation" TEXT NOT NULL,
    "dropoffLocation" TEXT NOT NULL,
    "pickupTime" TIMESTAMP(3) NOT NULL,
    "estimatedArrival" TIMESTAMP(3),
    "vehicleType" TEXT,
    "vehicleNumber" TEXT,
    "driverName" TEXT,
    "driverContact" TEXT,
    "estimatedFare" DOUBLE PRECISION,
    "actualFare" DOUBLE PRECISION,
    "paymentMethod" "PaymentMethod",
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "status" "TransportStatus" NOT NULL DEFAULT 'BOOKED',
    "aiNotes" TEXT,
    "alternatives" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tripId" TEXT NOT NULL,

    CONSTRAINT "transports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "StoreType" NOT NULL DEFAULT 'SHOPPING',
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "category" TEXT,
    "items" JSONB,
    "budget" DOUBLE PRECISION,
    "spent" DOUBLE PRECISION DEFAULT 0,
    "plannedDate" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER,
    "status" "StoreStatus" NOT NULL DEFAULT 'PLANNED',
    "aiNotes" TEXT,
    "recommendations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tripId" TEXT NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "trips_userId_idx" ON "trips"("userId");

-- CreateIndex
CREATE INDEX "activities_tripId_idx" ON "activities"("tripId");

-- CreateIndex
CREATE INDEX "hotels_tripId_idx" ON "hotels"("tripId");

-- CreateIndex
CREATE INDEX "transports_tripId_idx" ON "transports"("tripId");

-- CreateIndex
CREATE INDEX "stores_tripId_idx" ON "stores"("tripId");

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotels" ADD CONSTRAINT "hotels_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transports" ADD CONSTRAINT "transports_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
