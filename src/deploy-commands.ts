import { REST, Routes } from 'discord.js';
import { help } from './commands/help.js';
import { game } from './commands/game.js';
import { voice } from './commands/voice.js';


const commands = [
    game.data.toJSON(),
    voice.data.toJSON(),
    help.data.toJSON(),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID!),
      { body: commands }
    );

    console.log('\nSuccessfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();