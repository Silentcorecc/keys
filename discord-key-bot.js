const { Client, GatewayIntentBits, Partials } = require('discord.js');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || '';
const SUPABASE_FUNCTION_URL = process.env.SUPABASE_FUNCTION_URL;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || '';

if (!DISCORD_BOT_TOKEN || !SUPABASE_FUNCTION_URL) {
  console.error('Missing DISCORD_BOT_TOKEN or SUPABASE_FUNCTION_URL');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

function getHelpText() {
  return [
    '**Available commands**',
    '`!help` - Show this message',
    '`!stock` - Admin only',
    '`!assign <email> <product> [variant]` - Admin only',
    '`!lookup <email>` - Admin only',
    '`!redeem <email or order_id>` - Anyone',
  ].join('\n');
}

function formatResponse(data) {
  if (data.error) return `❌ ${data.error}`;

  if (Array.isArray(data.stock)) {
    return [
      data.message || '📦 Current Stock:',
      ...data.stock.map((item) => `• ${item.product}: ${item.available}`),
    ].join('\n');
  }

  if (data.key) {
    return [
      data.message || '✅ Key assigned successfully!',
      `• Product: ${data.product}`,
      `• Variant: ${data.variant}`,
      `• Email: ${data.email}`,
      `• Key: ${data.key}`,
    ].join('\n');
  }

  if (Array.isArray(data.keys)) {
    return [
      data.message || 'Keys found:',
      ...data.keys.map(
        (item) => `• ${item.product} (${item.variant || 'default'}): ${item.key}`
      ),
    ].join('\n');
  }

  if (Array.isArray(data.recent_payments)) {
    const keyLines = (data.keys || []).map(
      (item) => `• ${item.product || 'Unknown'} (${item.variant || 'default'}): ${item.key}`
    );
    const paymentLines = data.recent_payments.map(
      (payment) =>
        `• ${payment.product_name || 'Unknown'} (${payment.product_variant || 'default'}) - ${payment.status}`
    );

    return [
      `Email: ${data.email}`,
      `Total keys: ${data.total_keys || 0}`,
      keyLines.length ? 'Keys:' : 'No keys found.',
      ...keyLines,
      paymentLines.length ? 'Recent payments:' : '',
      ...paymentLines,
    ]
      .filter(Boolean)
      .join('\n');
  }

  return data.message || 'Done';
}

async function callBackend(command, args, message) {
  const response = await fetch(SUPABASE_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bot-secret': DISCORD_BOT_TOKEN,
    },
    body: JSON.stringify({
      command,
      args,
      discord_user_id: message.author.id,
      discord_username: message.author.username,
    }),
  });

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Backend returned non-JSON: ${text}`);
  }

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content || !message.content.startsWith('!')) return;
  if (DISCORD_CHANNEL_ID && message.channel.id !== DISCORD_CHANNEL_ID) return;

  const [rawCommand, ...args] = message.content.trim().split(/\s+/);
  const command = rawCommand.toLowerCase().replace(/^!+/, '');

  if (command === 'help') {
    await message.reply(getHelpText());
    return;
  }

  if (!['stock', 'assign', 'redeem', 'lookup'].includes(command)) return;

  if (['stock', 'assign', 'lookup'].includes(command)) {
    if (!ADMIN_ROLE_ID) {
      await message.reply('❌ ADMIN_ROLE_ID is missing in Railway.');
      return;
    }

    if (!message.member || !message.member.roles.cache.has(ADMIN_ROLE_ID)) {
      await message.reply('❌ You are not allowed to use this command.');
      return;
    }
  }

  try {
    await message.channel.sendTyping();
    const data = await callBackend(command, args, message);

    if (command === 'redeem' && Array.isArray(data.keys) && data.keys.length > 0) {
      await message.author.send(formatResponse(data));
      await message.reply('✅ I sent your keys in DM.');
      return;
    }

    await message.reply(formatResponse(data));
  } catch (error) {
    console.error('Command failed:', error);
    await message.reply(`❌ ${error.message || 'Command failed'}`);
  }
});

client.login(DISCORD_BOT_TOKEN);
