import {
  Client,
  Events,
  GatewayIntentBits,
  ActivityType,
  Presence,
  VoiceState,
  TextChannel,
} from "discord.js";
import { NewsChannel, DMChannel, ThreadChannel } from "discord.js";
import dotenv from "dotenv";
import path from "node:path";
import {
  startVoiceSession,
  endVoiceSession,
  startActivitySession,
  endActivitySession,
  prisma,
} from "./database";

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

const lastSeenActivities = new Map<string, string>();
const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 5_000;

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

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;
  const now = Date.now();
  const lastUsed = cooldowns.get(userId) ?? 0;

  if (now - lastUsed < COOLDOWN_MS) {
    const remaining = Math.ceil((lastUsed + COOLDOWN_MS - now) / 1000);
    await interaction.reply({
      content: `Please wait ${remaining} second(s) before using another command.`,
      ephemeral: true,
    });
    return;
  }

  cooldowns.set(userId, now);

  const { commandName } = interaction;

  try {
    if (commandName === "game") {
      const { game } = await import("./commands/game.js");
      if (interaction.isAutocomplete()) {
        await game.autocomplete(interaction);
      } else {
        await game.execute(interaction);
      }
    }

    if (commandName === "voice") {
      const { voice } = await import("./commands/voice.js");
      if (interaction.isAutocomplete()) {
        await voice.autocomplete(interaction);
      } else {
        await voice.execute(interaction);
      }
    }
    if (commandName === "help") {
      const { help } = await import("./commands/help.js");
      await help.execute(interaction);
    } else {
      interaction.reply({
        content: `There is not command /${commandName}.\nPlease use /help for the list of commands.`,
        ephemeral: true,
      });
    }
  } catch (error) {
    console.error(error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "There was an error while executing this command.",
        ephemeral: true,
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
