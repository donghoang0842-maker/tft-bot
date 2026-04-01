require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Test bot'),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Đang đăng ký lệnh...');

    await rest.put(
      Routes.applicationCommands('1488633907112054946'),
      { body: commands },
    );

    console.log('Đã đăng ký xong!');
  } catch (error) {
    console.error(error);
  }
})();