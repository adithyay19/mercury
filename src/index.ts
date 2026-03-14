import { Client, Events, GatewayIntentBits, ActivityType, Presence, VoiceState, TextChannel } from 'discord.js';
import { TextBasedChannel, NewsChannel, DMChannel, ThreadChannel, PartialGroupDMChannel } from 'discord.js';
import dotenv from 'dotenv';
import path from 'node:path';
import {
  startVoiceSession,
  endVoiceSession,
  startActivitySession,
  endActivitySession,
  getTotalSeconds
} from './database';

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
    await sendNotification(
      `<@&${NOTIFY_ROLE_ID}> ${user.tag} has **joined** voice channel: **${channelName}**`
    );
  }

  // Left a voice channel
  if (oldState.channelId && !newState.channelId) {
    endVoiceSession(TARGET_ID, guildId);

    const channelName = oldState.channel?.name ?? 'unknown channel';
    await sendNotification(
      `<@&${NOTIFY_ROLE_ID}> ${user.tag} has **left** voice channel: **${channelName}**`
    );
  }
});


client.on(Events.PresenceUpdate, async (oldPresence: Presence | null, newPresence: Presence) => {
  if (newPresence.userId !== TARGET_ID) return;
  if (!newPresence.guild) return;

  const guildId = newPresence.guild.id;
  const userTag = newPresence.user?.tag ?? 'Unknown';

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

  const key = `${TARGET_ID}-${guildId}`;
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

      startActivitySession(TARGET_ID, guildId, name, typeStr);

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

      endActivitySession(TARGET_ID, guildId, name);

      await sendNotification(
        `<@&${NOTIFY_ROLE_ID}> ${userTag} stopped **${typeStr} ${name}**`
      );
    }
  }
});


client.on(Events.MessageCreate, async (message) => {
  if (!message.content.startsWith(PREFIX) || message.author.bot || !message.guild) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  if (command === 'stats') {
    const voiceSec = getTotalSeconds(TARGET_ID, message.guild.id, 'voice');
    const voiceHours = (voiceSec / 3600).toFixed(1);

    const game = args.join(' ');
    const key = `activity:${game}`;
    const sec = getTotalSeconds(TARGET_ID, message.guild.id, key);
    const hours = (sec / 3600).toFixed(1);


    await message.reply(
      `**Statistics for <@${TARGET_ID}>**\n` +
      `Total voice time: **${voiceHours} hours** (${voiceSec} seconds)\n` +
      `Time spent **${game}**: **${hours} hours** (${sec} seconds)`
    );
  }

  if (command === 'gametime' && args.length > 0) {
    const game = args.join(' ');
    const key = `activity:${game}`;
    const sec = getTotalSeconds(TARGET_ID, message.guild.id, key);
    const hours = (sec / 3600).toFixed(1);

    await message.reply(
      `Time spent **${game}**: **${hours} hours** (${sec} seconds)`
    );
  }
});

console.log("--- Token : " + process.env.DISCORD_TOKEN?.slice(0, 10) + " ---");
client.login(process.env.DISCORD_TOKEN);