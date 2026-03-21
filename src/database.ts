import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { emptyStats, stats } from "./types.js";

const env = process.env.NODE_ENV || "development";
if (env !== "production") {
  dotenv.config();
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set.");
}

const adapter = new PrismaPg({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
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
  try {
    await prisma.voiceSession.create({
      data: { userId, guildId, channel, joinTime: Date.now() },
    });
  } catch (error) {
    console.error("Error in startVoiceSession", error);
  }
}

export async function endVoiceSession(
  userId: string,
  guildId: string,
  channel: string,
) {
  try {
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
  } catch (error) {
    console.error("Error in endVoiceSession", error);
  }
}

export async function startActivitySession(
  userId: string,
  name: string,
  type: string,
) {
  try {
    await prisma.activitySession.create({
      data: {
        userId,
        activityName: name,
        activityType: type,
        startTime: Date.now(),
      },
    });
  } catch (error) {
    console.error("Error in startActivitySession", error);
  }
}

export async function endActivitySession(userId: string, name: string) {
  try {
    const session = await prisma.activitySession.findFirst({
      where: { userId, activityName: name, endTime: null },
      orderBy: { startTime: "desc" },
    });

    if (!session) return;

    const duration = Math.floor(
      (Date.now() - Number(session.startTime)) / 1000,
    );

    await prisma.activitySession.update({
      where: { id: session.id },
      data: { endTime: Date.now(), duration },
    });

    await updateTotal(userId, `${-1}`, `activity`, name, duration);
  } catch (error) {
    console.error("Error in endActivitySession", error);
  }
}

async function updateTotal(
  userId: string,
  guildId: string,
  type: string,
  activity: string,
  seconds: number,
) {
  try {
    await prisma.total.upsert({
      where: {
        userId_guildId_type_activity: { userId, guildId, type, activity },
      },
      update: { totalSeconds: { increment: seconds } },
      create: { userId, guildId, type, activity, totalSeconds: seconds },
    });
  } catch (error) {
    console.error("Error in updateTotal", error);
  }
}

export async function getTotalSecondsPerServer(
  userId: string,
  guildId: string,
): Promise<stats> {
  try {
    const total = await prisma.total.findMany({
      where: { userId: userId, guildId: guildId, type: "voice" },
    });

    const serverTotal = total.reduce((s, x) => {
      s.totalSeconds += x.totalSeconds;
      if (s.createdAt > x.createdAt) {
        s.createdAt = x.createdAt;
      }
      return s;
    }, emptyStats());

    return serverTotal ?? emptyStats;
  } catch (error) {
    console.error("Error in getTotalSecondsPerServer", error);
    return emptyStats();
  }
}

export async function getTotalSecondsPerActivity(
  userId: string,
  guildId: string,
  type: string,
  activity: string,
): Promise<stats> {
  try {
    const total = await prisma.total.findUnique({
      where: {
        userId_guildId_type_activity: { userId, guildId, type, activity },
      },
      select: { totalSeconds: true, createdAt: true },
    });
    return total ?? emptyStats();
  } catch (error) {
    console.error("Error in getTotalSecondsPerActivity", error);
    return emptyStats();
  }
}

export async function getAllActivities(
  type: string,
  guildId: string,
): Promise<string[]> {
  try {
    const activitiesList = await prisma.total.findMany({
      where: { type: type, guildId: guildId },
      distinct: ["activity"],
      orderBy: { totalSeconds: "desc" },
      select: { activity: true },
      take: 5,
    });

    const activities: string[] = activitiesList.map((x) => x.activity);
    return activities ?? [];
  } catch (error) {
    console.error("Error in getAllActivities", error);
    return [];
  }
}

export async function deleteGuildData(guildId: string): Promise<boolean> {
  try {
    await prisma.$transaction([
      prisma.voiceSession.deleteMany({ where: { guildId: guildId } }),
      prisma.total.deleteMany({ where: { guildId: guildId } }),
    ]);
    return true;
  } catch (error) {
    console.error("Error in deleteGuildData: ", error);
    return false;
  }
}
