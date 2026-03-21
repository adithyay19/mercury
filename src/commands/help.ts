import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { commands } from "../types.js";

export const help = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Use this for commands info"),

  execute: async (interaction: ChatInputCommandInteraction) => {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: `${commands.map((c) => `${c.name}   --    ${c.description}`).join("\n")}`,
      ephemeral: true,
    });
  },
};