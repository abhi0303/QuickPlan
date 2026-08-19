import { PrismaClient } from '@prisma/client';

async function testNeonConnection() {
  console.log('🔌 Connecting to Neon PostgreSQL DB...');
  const startTime = Date.now();
  const prisma = new PrismaClient();

  try {
    await prisma.$connect();
    console.log(`✅ Connected to Neon DB in ${Date.now() - startTime}ms!`);

    // Run raw query to check server version
    const versionResult: any = await prisma.$queryRaw`SELECT version();`;
    console.log('🐘 PostgreSQL Version:', versionResult[0]?.version);

    // Create a temporary test user in Neon DB
    const testEmail = `test-${Date.now()}@quickplan.app`;
    console.log(`📝 Inserting test user: ${testEmail}...`);
    
    const createdUser = await prisma.user.create({
      data: {
        email: testEmail,
        name: 'Neon DB Connection Test User',
        settings: {
          create: {
            currency: 'INR',
            inputLanguage: 'AUTO',
          },
        },
      },
      include: { settings: true },
    });
    console.log('🎉 Created User in Neon DB:', createdUser.id, createdUser.name);

    // Query user count
    const totalUsers = await prisma.user.count();
    console.log('📊 Total Users in Neon DB:', totalUsers);

    // Clean up test user
    await prisma.user.delete({ where: { id: createdUser.id } });
    console.log('🧹 Cleaned up test user record.');

    console.log('\n========================================');
    console.log('🚀 LIVE NEON DB CONNECTION IS 100% WORKING!');
    console.log('========================================');
  } catch (error) {
    console.error('❌ Connection Failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testNeonConnection();
