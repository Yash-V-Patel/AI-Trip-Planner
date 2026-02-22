const { PrismaClient } = require('@prisma/client');
const openfgaService = require('../services/openfga.service');
require("dotenv").config();
const prisma = new PrismaClient();
const bcrypt = require('bcrypt');
const chalk = require('chalk');

async function createSuperAdmin() {
  // process.argv[0] is 'node', [1] is 'script name', [2] is the first argument
  const email = process.env.EMAIL;
  const password = process.env.PASSWORD;
  const name = process.env.NAME;
  const phone = process.env.PHONE;


  if (!email || !password) {
    console.error("❌ Missing arguments! Usage: node create-admin.js <email> <password> <name> <phone>");
    process.exit(1);
  }

  const payload = { email, password, name, phone };


  try {
    console.log(`🚀 Creating user: ${payload.email}...`);
    
    const superUser = await prisma.user.findUnique({ where: {email: payload.email}})
    if(superUser) {
        if (process.env.NODE_ENV === "development") {
            console.log(chalk.blue('SuperUser exist!'));
            console.log(chalk.green('Email:', process.env.EMAIL ));
            console.log(chalk.green('password:', process.env.PASSWORD));

            }
        return
    }
    const hashedPassword = await bcrypt.hash(payload.password, 10);

    const user = await prisma.user.upsert({
      where: { email: payload.email },
      update: {}, 
      create: {
        email: payload.email,
        password: hashedPassword,
        name: payload.name || "Default Name",
        phone: payload.phone || "0000000000",
      },
    });

        // Initialize OpenFGA
    await openfgaService.initialize();
    
    // Assign superadmin role
    await openfgaService.assignSuperAdmin(user.id);

    console.log(`✅ Success! User ID: ${user.id}`);
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}


module.exports = {
    createSuperAdmin
};
