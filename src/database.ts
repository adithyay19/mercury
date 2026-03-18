import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
dotenv.config({ path: "./secrets.env" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set.");
}

const adapter = new PrismaPg({
  connectionString,
  ssl: {
    rejectUnauthorized: true, // Skip certificate hostname validation (common for self-signed or cloud-hosted DBs)
    ca: fs
      .readFileSync(path.join(process.cwd(), "./prod-ca-2021.crt"))
      .toString(),
    minVersion: "TLSv1.2",
  },
});

export const prisma = new PrismaClient({
  adapter,
  log:
    process.env.NODE_ENV === "development"
      ? ["query", "info", "warn", "error"]
      : ["error"],
});

export async function startVoiceSession(
  userId: string,
  guildId: string,
  channel: string,
) {
  await prisma.voiceSession.create({
    data: { userId, guildId, channel, joinTime: Date.now() },
  });
}

export async function endVoiceSession(
  userId: string,
  guildId: string,
  channel: string,
) {
  const session = await prisma.voiceSession.findFirst({
    where: { userId, guildId, channel, leaveTime: null },
    orderBy: { joinTime: "desc" },
  });

  if (!session) return;

  const duration = Math.floor((Date.now() - Number(session.joinTime)) / 1000);

  await prisma.voiceSession.update({
    where: { id: session.id },
    data: { leaveTime: Date.now(), duration },
  });

  await updateTotal(userId, guildId, "voice", channel, duration);
}

export async function startActivitySession(
  userId: string,
  name: string,
  type: string,
) {
  await prisma.activitySession.create({
    data: {
      userId,
      activityName: name,
      activityType: type,
      startTime: Date.now(),
    },
  });
}

export async function endActivitySession(
  userId: string,
  name: string,
) {
  const session = await prisma.activitySession.findFirst({
    where: { userId, activityName: name, endTime: null },
    orderBy: { startTime: "desc" },
  });

  if (!session) return;

  const duration = Math.floor((Date.now() - Number(session.startTime)) / 1000);

  await prisma.activitySession.update({
    where: { id: session.id },
    data: { endTime: Date.now(), duration },
  });

  await updateTotal(userId, `${-1}`, `activity`, name, duration);
}

async function updateTotal(
  userId: string,
  guildId: string,
  type: string,
  activity: string,
  seconds: number,
) {
  await prisma.total.upsert({
    where: {
      userId_guildId_type_activity: { userId, guildId, type, activity },
    },
    update: { totalSeconds: { increment: seconds } },
    create: { userId, guildId, type, activity, totalSeconds: seconds },
  });
}

export async function getTotalSecondsPerServer(
  userId: string,
  guildId: string,
  type: string,
): Promise<number> {
  const total = await prisma.total.findMany({
    where: { userId: userId, guildId: guildId, type: "voice" },
  });

  let totalVoiceSeconds = 0;

  total.forEach((x) => {
    totalVoiceSeconds += x.totalSeconds;
  });

  return totalVoiceSeconds ?? 0;
}

export async function getTotalSecondsPerActivity(
  userId: string,
  guildId: string,
  type: string,
  activity: string,
): Promise<number> {
  const total = await prisma.total.findUnique({
    where: {
      userId_guildId_type_activity: { userId, guildId, type, activity },
    },
  });
  return total?.totalSeconds ?? 0;
}
