// lib/prisma.ts
const { PrismaClient } = require('@prisma/client');

declare global {
  var __globalPrisma__: any | undefined;
}

export const prisma = global.__globalPrisma__ ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.__globalPrisma__ = prisma;
}
