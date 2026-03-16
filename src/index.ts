import { Client, Events, GatewayIntentBits, ActivityType, Presence, VoiceState, TextChannel } from 'discord.js';
import { NewsChannel, DMChannel, ThreadChannel, PartialGroupDMChannel } from 'discord.js';
import dotenv from 'dotenv';
import path from 'node:path';
import {
  startVoiceSession,
  endVoiceSession,
  startActivitySession,
  endActivitySession,
  getTotalSeconds,
  prisma,
} from "./database";

dotenv.config({ path: path.join(import.meta.dirname, '..', 'secrets.env') });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const TARGET_ID        = process.env.TARGET_USER_ID!;
const NOTIFY_CHANNEL_ID = process.env.NOTIFY_CHANNEL_ID!;
const PREFIX           = process.env.PREFIX || '!';
const NOTIFY_ROLE_ID   = process.env.NOTIFY_ROLE_ID || '';

const lastSeenActivities = new Map<string, string>();

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user?.tag}`);
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
      console.warn(`Notification channel ${NOTIFY_CHANNEL_ID} is not text-based`);
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
    console.error('Failed to send notification:', err);
  }
}


client.on(Events.VoiceStateUpdate, async (oldState: VoiceState, newState: VoiceState) => {
  if (newState.member?.user.id !== TARGET_ID) return;
  if (!newState.guild) return;

  const user = newState.member.user;
  const guildId = newState.guild.id;

  // Joined a voice channel
  if (!oldState.channelId && newState.channelId) {
    startVoiceSession(TARGET_ID, guildId);

    const channelName = newState.channel?.name ?? 'unknown channel';
    console.log(newState.channel?.name, newState.member.displayName, newState.guild.name);
    await sendNotification(
      `${user.tag} has **joined** voice channel: **${channelName}**`
    );
  }

  // Left a voice channel
  if (oldState.channelId && !newState.channelId) {
    endVoiceSession(TARGET_ID, guildId);

    const channelName = oldState.channel?.name ?? 'unknown channel';
    console.log(oldState.channel?.name, newState.member.displayName, oldState.guild.name);
    await sendNotification(
      ` ${user.tag} has **left** voice channel: **${channelName}**`
    );
  }
});


client.on(Events.PresenceUpdate, async (oldPresence: Presence | null, newPresence: Presence) => {
  if (!newPresence.guild) return;
  if (!newPresence.user) return;
  const userId = newPresence.user.id;
  const guildId = newPresence.guild.id;
  const userTag = newPresence.user.tag ?? 'Unknown';

  // Get a stable signature of current activities (sorted to avoid order differences)
  const currentActivities = (newPresence.activities || [])
    .map(act => ({
      name: act.name ?? '',
      type: act.type,
      state: act.state ?? '',
      details: act.details ?? '',
      // omit timestamps / application_id / assets if they cause noise
    }))
    .sort((a, b) => (a.name + a.type).localeCompare(b.name + b.type)); // stable order

  const currentSignature = JSON.stringify(currentActivities);

  const key = `${userId}-${guildId}`;
  const previousSignature = lastSeenActivities.get(key);

  // Only process if activities actually changed
  if (currentSignature === previousSignature) {
    return; // duplicate / redundant update → ignore
  }

  lastSeenActivities.set(key, currentSignature);

  // Now compare old vs new for started / stopped
  const oldActs = oldPresence?.activities ?? [];
  const newActs = newPresence.activities ?? [];

  // Started: in new but not in old (using name + type as key)
  for (const act of newActs) {
    if (!act.name) continue;

    const existsInOld = oldActs.some(
      o => o.name === act.name && o.type === act.type
    );

    if (!existsInOld) {
      const name = act.name;
      const typeStr = ActivityType[act.type] ?? 'Custom';

      startActivitySession(userId, guildId, name, typeStr);

      await sendNotification(
        `${userTag} started **${typeStr} ${name}**`
      );
    }
  }

  // Stopped: in old but not in new
  for (const act of oldActs) {
    if (!act.name) continue;

    const existsInNew = newActs.some(
      n => n.name === act.name && n.type === act.type
    );

    if (!existsInNew) {
      const name = act.name;
      const typeStr = ActivityType[act.type] ?? 'Custom';

      endActivitySession(userId, guildId, name);

      await sendNotification(
        `${userTag} stopped **${typeStr} ${name}**`
      );
    }
  }
});


client.on(Events.MessageCreate, async (message) => {
  if (!message.content.startsWith(PREFIX) || message.author.bot || !message.guild) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  if (command === 'stats') {
    const voiceSec = getTotalSeconds(message.author.id, message.guild.id, 'voice');
    const voiceHours = (Number(voiceSec) / 3600).toFixed(1);

    await message.reply(
      `**Statistics for <@${message.author.id}>**\n` +
      `Total voice time: **${voiceHours} hours** (${voiceSec} seconds)`
    );
  }

  if (command === 'gametime' && args.length > 0) {
    const game = args.join(' ');
    const key = `activity:${game}`;
    const sec = getTotalSeconds(message.author.id, message.guild.id, key);
    const hours = (Number(sec) / 3600).toFixed(1);

    await message.reply(
      `Time spent **${game}**: **${hours} hours** (${sec} seconds)`
    );
  }
});

console.log("--- Token : " + process.env.DISCORD_TOKEN?.slice(0, 10) + " ---");
client.login(process.env.DISCORD_TOKEN);