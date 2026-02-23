// test-openfga-permissions.js
const { PrismaClient } = require('@prisma/client');
const openfgaService = require('../services/openfga.service');

const prisma = new PrismaClient();

async function testOpenFGAPermissions() {
  try {
    // Initialize OpenFGA
    await openfgaService.initialize();
    
    // Get your user ID from the token (from your logs: cmly2uqn20000v3f88pshxd5t)
    const userId = 'cmly2uqn20000v3f88pshxd5t';
    
    // Get your vendor ID (from the verify request: cmly2vbp20006v3f8y04wso9e)
    const vendorId = 'cmly2vbp20006v3f8y04wso9e';
    
    console.log('Testing permissions for:');
    console.log('User ID:', userId);
    console.log('Vendor ID:', vendorId);
    console.log('------------------------');

    // Test 1: Check is_vendor permission
    const isVendor = await openfgaService.checkPermission(
      userId,
      "is_vendor",
      `vendor:${vendorId}`
    );
    console.log('1. is_vendor:', isVendor);

    // Test 2: Check can_sell_transportation permission
    const canSellTransportation = await openfgaService.checkPermission(
      userId,
      "can_sell_transportation",
      `vendor:${vendorId}`
    );
    console.log('2. can_sell_transportation:', canSellTransportation);

    // Test 3: Check generic vendor status via isVendor method
    const isVendorMethod = await openfgaService.isVendor?.(userId);
    console.log('3. isVendor() method:', isVendorMethod);

    // Test 4: List all relations for this user
    console.log('\nListing all relations for user:');
    const relations = await openfgaService.readTuples({
      user: `user:${userId}`
    });
    console.log('Relations:', JSON.stringify(relations, null, 2));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testOpenFGAPermissions();