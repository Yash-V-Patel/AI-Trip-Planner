// test-store-permissions.js
const openfgaService = require('../services/openfga.service');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testStorePermissions() {
  try {
    await openfgaService.initialize();
    
    const vendor = await prisma.vendor.findUnique({
      where: { userId: 'cmly2uqn20000v3f88pshxd5t' }
    });

    if (!vendor) {
      console.log('Vendor not found');
      return;
    }

    console.log('Testing store permissions:');
    console.log('User ID:', vendor.userId);
    console.log('Vendor ID:', vendor.id);
    console.log('------------------------');

    const permissions = {
      is_vendor: await openfgaService.checkPermission(
        vendor.userId,
        "is_vendor",
        `vendor:${vendor.id}`
      ),
      can_sell_accommodations: await openfgaService.checkPermission(
        vendor.userId,
        "can_sell_accommodations",
        `vendor:${vendor.id}`
      ),
      can_sell_transportation: await openfgaService.checkPermission(
        vendor.userId,
        "can_sell_transportation",
        `vendor:${vendor.id}`
      ),
      can_sell_shopping: await openfgaService.checkPermission(
        vendor.userId,
        "can_sell_shopping",
        `vendor:${vendor.id}`
      )
    };

    console.log('✅ Permission check results:');
    console.log(permissions);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testStorePermissions();