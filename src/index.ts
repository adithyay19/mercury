import {
  Client,
  Events,
  GatewayIntentBits,
  ActivityType,
  Presence,
  VoiceState,
  TextChannel,
  MessageFlags,
} from "discord.js";
import { NewsChannel, DMChannel, ThreadChannel } from "discord.js";
import dotenv from "dotenv";
import {
  startVoiceSession,
  endVoiceSession,
  startActivitySession,
  endActivitySession,
  deleteGuildData,
  prisma,
} from "./database.js";
import express from "express";

console.log("Imports completed");

const env = process.env.NODE_ENV || "development";
console.log("Env: " + env);
if (env !== "production") {
  dotenv.config();
}

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

console.log("Client instance created");

const TARGET_ID = process.env.TARGET_USER_ID!;
const NOTIFY_CHANNEL_ID = process.env.NOTIFY_CHANNEL_ID!;

const lastSeenActivities = new Map<string, string>();
const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 5_000;

client.once(Events.ClientReady, async () => {
  console.log(
    `Logged in as ${client.user?.tag} at ${new Date().toISOString()}`,
  );
  await prisma.$connect();
  await sendNotification(
    `Up and running!\nLogged in at :at ${new Date().toISOString()}`,
  );
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

    try {
      const user = newState.member.user;
      const guildId = newState.guild.id;

      if (!oldState.channelId && newState.channelId) {
        const channelName = newState.channel?.name ?? "unknown channel";
        startVoiceSession(user.id, guildId, channelName);
      }

      if (oldState.channelId && !newState.channelId) {
        const channelName = oldState.channel?.name ?? "unknown channel";
        endVoiceSession(user.id, guildId, channelName);
      }
    } catch (error) {
      console.error("Error in VoiceStateUpdate: " + error);
    }
  },
);

client.on(
  Events.PresenceUpdate,
  async (oldPresence: Presence | null, newPresence: Presence) => {
    if (!newPresence.guild) return;
    if (newPresence.userId != TARGET_ID) return;

    try {
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
          endActivitySession(userId, name);
        }
      }
    } catch (error) {
      console.error("Error in PresenceUpdate: " + error);
    }
  },
);

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    const command = interaction.commandName;
    try {
      if (command === "game") {
        const { game } = await import("./commands/game.js");
        await game.autocomplete(interaction);
      }

      if (command === "voice") {
        const { voice } = await import("./commands/voice.js");
        await voice.autocomplete(interaction);
      }
    } catch (error) {
      console.error(error);
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;
  const now = Date.now();
  const lastUsed = cooldowns.get(userId) ?? 0;

  if (now - lastUsed < COOLDOWN_MS) {
    const remaining = Math.ceil((lastUsed + COOLDOWN_MS - now) / 1000);
    await interaction.reply({
      content: `Please wait ${remaining} second(s) before using another command.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  cooldowns.set(userId, now);

  const commandName = interaction.commandName;

  try {
    if (commandName === "game") {
      const { game } = await import("./commands/game.js");
      await game.execute(interaction);
    }

    if (commandName === "voice") {
      const { voice } = await import("./commands/voice.js");
      await voice.execute(interaction);
    }
    if (commandName === "help") {
      const { help } = await import("./commands/help.js");
      await help.execute(interaction);
    } else {
      if (!interaction.replied && !interaction.deferred) {
        interaction.reply({
          content: `There is not a command /${commandName}.\nPlease use /help for the list of commands.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  } catch (error) {
    console.error(error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "There was an error while executing this command.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
});

client.on(Events.GuildDelete, async (guild) => {
  try {
    const success = await deleteGuildData(guild.id);
    if (success) {
      await sendNotification(
        `Cleaned up all data for removed guild: ${guild.name} (${guild.id})`,
      );
    } else {
      await sendNotification(`Cleanup failed for guild ${guild.id}`);
    }
  } catch (error) {
    console.error("Error in GuildDelete: ", error);
  }
});

console.log(
  "Attempting login... Token length:",
  process.env.DISCORD_TOKEN?.length ?? "missing",
);
client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error("Login rejected:", err.message);
  process.exit(1);
});

//#region Dummy Inbound port to deploy it as free we service

const app = express();

app.get("/health", (_req, res) => {
  res.status(200).send("Bot is alive");
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Dummy health server listening on port ${port}`);
});

//#endregion
