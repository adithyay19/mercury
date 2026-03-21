import { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { getTotalSecondsPerActivity, getAllActivities } from "../database.js";
import dotenv from "dotenv";
import path from "node:path";
import { GetTotalTime } from "../types.js";


dotenv.config({ path: path.join(import.meta.dirname, "..", "secrets.env") });

const TARGET_ID = process.env.TARGET_USER_ID!;

export const game = {
  data: new SlashCommandBuilder()
    .setName("game")
    .setDescription("Shows time spent on a specific game or activity.")
    .addStringOption((option) =>
      option
        .setName("activity")
        .setDescription("The name of the game or activity.")
        .setRequired(true)
        .setAutocomplete(true),
    ),
  execute: async (interaction: ChatInputCommandInteraction) => {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }
    await interaction.deferReply();

    const game = interaction.options.getString("activity", true);

    const total = await getTotalSecondsPerActivity(
      TARGET_ID,
      `${-1}`,
      "activity",
      game,
    );
    const totalTime = GetTotalTime(Number(total.totalSeconds));
    const createdDate = total.createdAt.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

    console.log(`Time spent **${game}**: **${totalTime}** since ${createdDate}`)

    await interaction.editReply(
      `Time spent **${game}**: **${totalTime}** since ${createdDate}`,
    );
  },
  autocomplete: async (interaction: any) => {
    const focusedValue = interaction.options.getFocused();
    console.log(focusedValue)
    const choices = await getAllActivities("activity");

    const filtered = choices.filter((choice) =>
      choice.toLowerCase().startsWith(focusedValue.toLowerCase()),
    );

    console.log(choices + "\n" + filtered)
    await interaction.respond(
      filtered.map((choice) => ({ name: choice, value: choice })),
    );
  },
};
