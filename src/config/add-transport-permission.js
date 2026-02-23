// add-transport-permission.js
const openfgaService = require('../services/openfga.service');

async function addTransportPermission() {
  try {
    await openfgaService.initialize();
    
    const userId = 'cmly2uqn20000v3f88pshxd5t';
    const vendorId = 'cmly2vbp20006v3f8y04wso9e';
    
    console.log('Adding can_sell_transportation permission...');
    
    const result = await openfgaService.writeTuples([
      {
        user: `user:${userId}`,
        relation: "can_sell_transportation",
        object: `vendor:${vendorId}`
      }
    ]);
    
    console.log('✅ Permission added successfully!', result);
    
    // Verify it worked
    const check = await openfgaService.checkPermission(
      userId,
      "can_sell_transportation",
      `vendor:${vendorId}`
    );
    
    console.log('Verification check - can_sell_transportation:', check);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

addTransportPermission();