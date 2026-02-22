const openfgaService = require('../services/openfga.service');

async function test() {
  try {
    console.log('🚀 Testing OpenFGA Service...\n');
    
    // Initialize OpenFGA
    console.log('1️⃣ Initializing OpenFGA...');
    await openfgaService.initialize();
    
    const info = await openfgaService.getStoreInfo();
    console.log('✅ OpenFGA initialized successfully!');
    console.log(`   Store ID: ${info.storeId}`);
    console.log(`   Model ID: ${info.modelId}`);
    console.log(`   Initialized: ${info.initialized}\n`);
    
    // Test superadmin check
    console.log('2️⃣ Testing permission check...');
    const isSuperAdmin = await openfgaService.checkSuperAdmin('test-user-123');
    console.log(`   Check superadmin (should be false): ${isSuperAdmin}\n`);
    
    // Test creating relations
    console.log('3️⃣ Testing tuple creation...');
    try {
      await openfgaService.createProfileRelations('test-user-123', 'test-profile-123');
      console.log('✅ Profile relations created successfully');
    } catch (error) {
      console.log('⚠️ Profile relations test:', error.message);
    }
    
    console.log('\n✅ All tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error);
  }
}

test();