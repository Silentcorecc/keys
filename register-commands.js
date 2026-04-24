// register-commands.js — run once to register slash commands
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('key')
    .setDescription('Deliver a product key to the ticket customer')
    .addStringOption(o => o.setName('product').setDescription('Product slug').setRequired(true))
    .addStringOption(o => o.setName('variant').setDescription('Variant').setRequired(true)
      .addChoices(
        { name: 'day', value: 'day' },
        { name: 'week', value: 'week' },
        { name: 'month', value: 'month' },
        { name: 'lifetime', value: 'lifetime' },
      ))
    .addStringOption(o => o.setName('email').setDescription('Override email (optional)')),

  new SlashCommandBuilder()
    .setName('grant-customer')
    .setDescription('Grant customer role to ticket user')
    .addStringOption(o => o.setName('email').setDescription('Override email (optional)')),

  new SlashCommandBuilder().setName('close').setDescription('Close this ticket'),

  new SlashCommandBuilder()
    .setName('note').setDescription('Internal staff note (not sent to customer)')
    .addStringOption(o => o.setName('text').setDescription('Note text').setRequired(true)),

  new SlashCommandBuilder()
    .setName('ai').setDescription('Toggle AI auto-reply for this ticket')
    .addStringOption(o => o.setName('state').setDescription('on or off').setRequired(true)
      .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
      { body: commands }
    );
    console.log('✅ Slash commands registered!');
  } catch (e) { console.error(e); process.exit(1); }
})();
