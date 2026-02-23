// add-shopping-permission.js
const openfgaService = require('../services/openfga.service')
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function addShoppingPermission() {
  try {
    await openfgaService.initialize();
    
    // Get your vendor
    const vendor = await prisma.vendor.findUnique({
      where: { userId: 'cmly2uqn20000v3f88pshxd5t' } // Your user ID
    });

    if (!vendor) {
      console.log('Vendor not found');
      return;
    }

    console.log('Adding can_sell_shopping permission...');
    console.log('User ID:', vendor.userId);
    console.log('Vendor ID:', vendor.id);
    
    const result = await openfgaService.writeTuples([
      {
        user: `user:${vendor.userId}`,
        relation: "can_sell_shopping",
        object: `vendor:${vendor.id}`
      }
    ]);
    
    console.log('✅ Permission added successfully!', result);
    
    // Verify it worked
    const check = await openfgaService.checkPermission(
      vendor.userId,
      "can_sell_shopping",
      `vendor:${vendor.id}`
    );
    
    console.log('Verification check - can_sell_shopping:', check);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

addShoppingPermission();