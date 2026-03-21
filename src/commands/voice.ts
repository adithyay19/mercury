import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import {
  getTotalSecondsPerActivity,
  getAllActivities,
  getTotalSecondsPerServer,
} from "../database.js";
import { emptyStats, GetTotalTime } from "../types.js";

export const voice = {
  data: new SlashCommandBuilder()
    .setName("voice")
    .setDescription("Shows time spent on a specific channel or server.")
    .addStringOption((option) =>
      option
        .setName("channel")
        .setDescription("The name of the channel (if required).")
        .setAutocomplete(true),
    ),
  execute: async (interaction: ChatInputCommandInteraction) => {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply();

    const channel = interaction.options.getString("channel", false) ?? null;
    const userId = interaction.user.id;
    const guild = interaction.guild;

    let total = emptyStats();
    if (!channel) {
      total = await getTotalSecondsPerServer(userId, guild.id);
    } else {
      total = await getTotalSecondsPerActivity(
        userId,
        guild.id,
        "voice",
        channel,
      );
    }

    if (total === emptyStats()) {
      await interaction.editReply(
        `No data available for ${channel ? `channel **${channel}**` : `server **${guild.name}**`}`,
      );
      return;
    }

    const voiceTime = GetTotalTime(Number(total.totalSeconds));
    const createdDate = total.createdAt.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

    await interaction.editReply(
      `Total voice time: **${voiceTime}** ${channel ? `in channel **${channel}**` : `in server **${guild.name}**`} since ${createdDate}`,
    );
  },
  autocomplete: async (interaction: any) => {
    const focusedValue = interaction.options.getFocused();
    const choices = await getAllActivities("voice", interaction.guildId);

    const filtered = choices.filter((choice) =>
      choice.toLowerCase().startsWith(focusedValue.toLowerCase()),
    );
    await interaction.respond(
      filtered.map((choice) => ({ name: choice, value: choice })).slice(0, 5),
    );
  },
};
