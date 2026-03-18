import {
  Client,
  Events,
  GatewayIntentBits,
  ActivityType,
  Presence,
  VoiceState,
  TextChannel,
} from "discord.js";
import {
  NewsChannel,
  DMChannel,
  ThreadChannel,
} from "discord.js";
import dotenv from "dotenv";
import path from "node:path";
import {
  startVoiceSession,
  endVoiceSession,
  startActivitySession,
  endActivitySession,
  getTotalSecondsPerServer,
  getTotalSecondsPerActivity,
  prisma,
} from "./database";
import { GetTotalTime } from "./types";

dotenv.config({ path: path.join(import.meta.dirname, "..", "secrets.env") });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const TARGET_ID = process.env.TARGET_USER_ID!;
const NOTIFY_CHANNEL_ID = process.env.NOTIFY_CHANNEL_ID!;
const PREFIX = process.env.PREFIX || "!";

const lastSeenActivities = new Map<string, string>();

client.once(Events.ClientReady, async () => {
  await prisma.$connect();
  await sendNotification("Up and running!");
});

async function sendNotification(content: string): Promise<void> {
  try {
    const channel = await client.channels.fetch(NOTIFY_CHANNEL_ID);

    if (!channel) {
      console.warn(`Notification channel ${NOTIFY_CHANNEL_ID} not found`);
      return;
    }

    if (!channel.isTextBased()) {
      console.warn(
        `Notification channel ${NOTIFY_CHANNEL_ID} is not text-based`,
      );
      return;
    }

    // TypeScript now knows channel is TextBasedChannel
    if (
      channel instanceof TextChannel ||
      channel instanceof NewsChannel ||
      channel instanceof DMChannel ||
      channel instanceof ThreadChannel
    ) {
      await channel.send(content);
    } else {
      console.warn(
        `Channel ${NOTIFY_CHANNEL_ID} is not a sendable guild/DM text channel`,
      );
    }
  } catch (err) {
    console.error("Failed to send notification:", err);
  }
}

client.on(
  Events.VoiceStateUpdate,
  async (oldState: VoiceState, newState: VoiceState) => {
    if (!newState.guild || !newState.member) return;

    const user = newState.member.user;
    const guildId = newState.guild.id;

    // Joined a voice channel
    if (!oldState.channelId && newState.channelId) {
      const channelName = newState.channel?.name ?? "unknown channel";
      startVoiceSession(user.id, guildId, channelName);
    }

    // Left a voice channel
    if (oldState.channelId && !newState.channelId) {
      const channelName = oldState.channel?.name ?? "unknown channel";
      endVoiceSession(user.id, guildId, channelName);
    }
  },
);

client.on(
  Events.PresenceUpdate,
  async (oldPresence: Presence | null, newPresence: Presence) => {
    if (!newPresence.guild) return;
    if (newPresence.userId != TARGET_ID) return;

    const userId = TARGET_ID;
    const guildId = newPresence.guild.id;
    const userTag = newPresence.user?.tag ?? "Unknown";

    const currentActivities = (newPresence.activities || [])
      .map((act) => ({
        name: act.name ?? "",
        type: act.type,
        state: act.state ?? "",
        details: act.details ?? "",
      }))
      .sort((a, b) => (a.name + a.type).localeCompare(b.name + b.type)); 

    const currentSignature = JSON.stringify(currentActivities);

    const key = `${userId}`;
    const previousSignature = lastSeenActivities.get(key);

    console.log(currentActivities, previousSignature);
    console.log("\nServer: " + newPresence.guild.name + "\n");

    if (currentSignature === previousSignature) {
      return;
    }

    lastSeenActivities.set(key, currentSignature);

    const oldActs = oldPresence?.activities ?? [];
    const newActs = newPresence.activities ?? [];

    for (const act of newActs) {
      if (!act.name) continue;

      const existsInOld = oldActs.some(
        (o) => o.name === act.name && o.type === act.type,
      );

      if (!existsInOld) {
        const name = act.name;
        const typeStr = ActivityType[act.type] ?? "Custom";

        startActivitySession(userId, name, typeStr);
      }
    }

    for (const act of oldActs) {
      if (!act.name) continue;

      const existsInNew = newActs.some(
        (n) => n.name === act.name && n.type === act.type,
      );

      if (!existsInNew) {
        const name = act.name;
        const typeStr = ActivityType[act.type] ?? "Custom";

        endActivitySession(userId, name);
      }
    }
  },
);

client.on(Events.MessageCreate, async (message) => {
  if (
    !message.content.startsWith(PREFIX) ||
    message.author.bot ||
    !message.guild
  )
    return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();
  const activity = args.join(" ") ?? null;

  if (command === "voice") {
    let voiceSec;

    if (!activity) {
      voiceSec = getTotalSecondsPerServer(
        message.author.id,
        message.guild.id,
        "voice",
      );
    } else {
      voiceSec = getTotalSecondsPerActivity(
        message.author.id,
        message.guild.id,
        "voice",
        activity,
      );
    }

    const voiceTime = GetTotalTime(Number(voiceSec));
    await message.reply(
      `Total voice time: **${voiceTime}** ${activity ? `in channel **${activity}**` : `in server **${message.guild.name}**`}`,
    );
  } else if (command === "game") {

    if (message.author.id != TARGET_ID) {
      await message.reply(`Your activities are not recorded.`);
    }

    if(!activity) {
      await message.reply(`Invalid command, user !help for .`);
    }

    const sec = getTotalSecondsPerActivity(
      message.author.id,
      `${-1}`,
      "activity",
      activity,
    );
    const totalTime = GetTotalTime(Number(sec));

    await message.reply(`Time spent **${activity}**: **${totalTime}**`);
  }
});

client.login(process.env.DISCORD_TOKEN);