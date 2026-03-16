import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
 dotenv.config({ path: './secrets.env' });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set.');
}

const adapter = new PrismaPg({
  connectionString,
  ssl: {
    rejectUnauthorized: true,                    // Skip certificate hostname validation (common for self-signed or cloud-hosted DBs)
    ca: fs.readFileSync(path.join(process.cwd(), './prod-ca-2021.crt')).toString(),
    minVersion: 'TLSv1.2',
  },
});

export const prisma = new PrismaClient({ adapter, log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'], });

export async function startVoiceSession(userId: string, guildId: string) {
  await prisma.voiceSession.create({
    data: { userId, guildId, joinTime: Date.now() }
  });
}

export async function endVoiceSession(userId: string, guildId: string) {
  const session = await prisma.voiceSession.findFirst({
    where: { userId, guildId, leaveTime: null },
    orderBy: { joinTime: 'desc' }
  });

  if (!session) return;

  const duration = Math.floor((Date.now() - Number(session.joinTime)) / 1000);

  await prisma.voiceSession.update({
    where: { id: session.id },
    data: { leaveTime: Date.now(), duration }
  });

  await updateTotal(userId, guildId, 'voice', duration);
}

export async function startActivitySession(
  userId: string,
  guildId: string,
  name: string,
  type: string
) {
  await prisma.activitySession.create({
    data: { userId, guildId, activityName: name, activityType: type, startTime: Date.now() }
  });
}

export async function endActivitySession(userId: string, guildId: string, name: string) {
  const session = await prisma.activitySession.findFirst({
    where: { userId, guildId, activityName: name, endTime: null },
    orderBy: { startTime: 'desc' }
  });

  if (!session) return;

  const duration = Math.floor((Date.now() - Number(session.startTime)) / 1000);

  await prisma.activitySession.update({
    where: { id: session.id },
    data: { endTime: Date.now(), duration }
  });

  await updateTotal(userId, guildId, `activity:${name}`, duration);
}

async function updateTotal(userId: string, guildId: string, type: string, seconds: number) {
  await prisma.total.upsert({
    where: { userId_guildId_type: { userId, guildId, type } },
    update: { totalSeconds: { increment: seconds } },
    create: { userId, guildId, type, totalSeconds: seconds }
  });
}

export async function getTotalSeconds(userId: string, guildId: string, type: string): Promise<number> {
  const total = await prisma.total.findUnique({
    where: { userId_guildId_type: { userId, guildId, type } }
  });
  return total?.totalSeconds ?? 0;
}