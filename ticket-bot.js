// ticket-bot.js — Silentcore website-tickets Discord bridge
const {
  Client, GatewayIntentBits, Partials, Events,
  REST, Routes, SlashCommandBuilder, ChannelType,
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const TOKEN          = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID      = process.env.DISCORD_CLIENT_ID;
const GUILD_ID       = process.env.DISCORD_GUILD_ID;
const TICKETS_CHAN   = process.env.DISCORD_TICKETS_CHANNEL_ID;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CUSTOMER_ROLE  = process.env.DISCORD_CUSTOMER_ROLE_ID;

if (!TOKEN || !SUPABASE_URL || !SERVICE_KEY || !TICKETS_CHAN) {
  console.error('❌ Missing required env vars'); process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// Helper: find ticket by Discord thread id
async function findTicketByThread(threadId) {
  const { data } = await supabase
    .from('internal_tickets')
    .select('*')
    .eq('discord_thread_id', threadId)
    .maybeSingle();
  return data;
}

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Ticket bot online as ${c.user.tag}`);
});

// ============== STAFF MESSAGE IN THREAD → SEND TO CUSTOMER ==============
client.on(Events.MessageCreate, async (msg) => {
  try {
    if (msg.author.bot) return;
    if (!msg.channel.isThread()) return;
    if (msg.channel.parentId !== TICKETS_CHAN) return;

    // Ignore slash command outputs and empty
    const text = (msg.content || '').trim();
    if (!text) return;
    // Internal note → don't send to customer
    if (text.startsWith('//')) {
      await msg.react('📝').catch(() => {});
      return;
    }

    const ticket = await findTicketByThread(msg.channel.id);
    if (!ticket) {
      await msg.reply('⚠️ This thread is not linked to a ticket.');
      return;
    }
    if (ticket.status === 'closed') {
      await msg.reply('⚠️ Ticket is closed. Reopen it first.').catch(() => {});
      return;
    }

    const staffName = msg.member?.displayName || msg.author.username;

    const { error } = await supabase.from('ticket_messages').insert({
      ticket_id: ticket.id,
      user_id: null,
      username: staffName,
      is_staff: true,
      message: text,
      attachments: msg.attachments.size
        ? Array.from(msg.attachments.values()).map((a) => ({ url: a.url, name: a.name }))
        : [],
    });

    if (error) {
      console.error('Insert reply failed:', error);
      await msg.react('❌').catch(() => {});
    } else {
      await msg.react('✅').catch(() => {});
    }
  } catch (e) { console.error('messageCreate error:', e); }
});

// ============================ SLASH COMMANDS ============================
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand()) return;

  // Most commands must be used inside a ticket thread
  const inTicketThread =
    i.channel?.isThread?.() && i.channel.parentId === TICKETS_CHAN;
  const ticket = inTicketThread ? await findTicketByThread(i.channel.id) : null;

  try {
    // ---------- /key product:<slug> variant:<day|week|month|lifetime> [email:?] ----------
    if (i.commandName === 'key') {
      if (!ticket) return i.reply({ content: '❌ Use this inside a ticket thread.', ephemeral: true });
      await i.deferReply();

      const productSlug = i.options.getString('product', true);
      const variant = i.options.getString('variant', true);
      const emailOpt = i.options.getString('email');
      const email = emailOpt || ticket.user_email;
      if (!email) return i.editReply('❌ No customer email — pass `email:`.');

      // Find product
      const { data: product } = await supabase
        .from('products')
        .select('id, name')
        .eq('slug', productSlug)
        .maybeSingle();
      if (!product) return i.editReply(`❌ Product not found: \`${productSlug}\``);

      // Get an unassigned key
      const { data: key } = await supabase
        .from('product_keys')
        .select('id, key_value, variant')
        .eq('product_id', product.id)
        .eq('variant', variant)
        .eq('is_assigned', false)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!key) return i.editReply(`❌ No stock for \`${product.name}\` (${variant}).`);

      // Assign it
      await supabase
        .from('product_keys')
        .update({
          is_assigned: true,
          assigned_to_email: email,
          assigned_to_user_id: ticket.user_id,
          assigned_at: new Date().toISOString(),
        })
        .eq('id', key.id);

      // Log assignment
      await supabase.from('key_assignment_logs').insert({
        key_id: key.id,
        key_value: key.key_value,
        product_id: product.id,
        product_name: product.name,
        variant: key.variant,
        assigned_to_user_id: ticket.user_id,
        assigned_to_email: email,
        assigned_by: 'discord-bot',
        action: 'staff_delivery',
      });

      // Post key inside ticket (so customer sees it on website)
      await supabase.from('ticket_messages').insert({
        ticket_id: ticket.id,
        user_id: null,
        username: i.member?.displayName || i.user.username,
        is_staff: true,
        message: `🔑 Your **${product.name}** (${variant}) key:\n\`\`\`\n${key.key_value}\n\`\`\`\nCheck your dashboard → Product Keys.`,
      });

      return i.editReply(`✅ Delivered **${product.name}** (${variant}) to \`${email}\``);
    }

    // ---------- /grant-customer [email:?] ----------
    if (i.commandName === 'grant-customer') {
      if (!ticket && !i.options.getString('email')) {
        return i.reply({ content: '❌ Use inside a ticket thread or pass `email:`', ephemeral: true });
      }
      await i.deferReply();
      const email = i.options.getString('email') || ticket.user_email;
      if (!email) return i.editReply('❌ No email available.');

      // Find user by email via auth.users (service role)
      const { data: { users } } = await supabase.auth.admin.listUsers();
      const user = users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
      if (!user) return i.editReply(`❌ No website account for \`${email}\``);

      const { error } = await supabase
        .from('user_roles')
        .upsert({ user_id: user.id, role: 'customer', assigned_at: new Date().toISOString() },
                { onConflict: 'user_id,role' });
      if (error) return i.editReply(`❌ ${error.message}`);

      // Try to grant Discord role too if linked
      const { data: profile } = await supabase
        .from('profiles')
        .select('discord_id')
        .eq('id', user.id)
        .maybeSingle();
      if (profile?.discord_id && CUSTOMER_ROLE) {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(profile.discord_id).catch(() => null);
        if (member) await member.roles.add(CUSTOMER_ROLE).catch(() => {});
      }

      return i.editReply(`✅ Granted **customer** role to \`${email}\``);
    }

    // ---------- /close ----------
    if (i.commandName === 'close') {
      if (!ticket) return i.reply({ content: '❌ Use inside a ticket thread.', ephemeral: true });
      await supabase.from('internal_tickets')
        .update({ status: 'closed', closed_at: new Date().toISOString() })
        .eq('id', ticket.id);
      await i.reply('🔒 Ticket closed.');
      await i.channel.setArchived(true).catch(() => {});
      return;
    }

    // ---------- /note <text> (internal staff note, NOT sent to customer) ----------
    if (i.commandName === 'note') {
      if (!ticket) return i.reply({ content: '❌ Use inside a ticket thread.', ephemeral: true });
      const text = i.options.getString('text', true);
      await i.reply(`📝 **Note from ${i.user.username}:** ${text}`);
      return;
    }

    // ---------- /ai on|off ----------
    if (i.commandName === 'ai') {
      if (!ticket) return i.reply({ content: '❌ Use inside a ticket thread.', ephemeral: true });
      const state = i.options.getString('state', true);
      await supabase.from('internal_tickets')
        .update({ ai_auto_reply: state === 'on' })
        .eq('id', ticket.id);
      return i.reply(`🤖 AI auto-reply **${state.toUpperCase()}** for this ticket.`);
    }

  } catch (e) {
    console.error('Slash error:', e);
    if (i.deferred) i.editReply(`❌ ${e.message}`);
    else i.reply({ content: `❌ ${e.message}`, ephemeral: true }).catch(() => {});
  }
});

client.login(TOKEN);
