import { ApplicationCommandOptionType, AttachmentBuilder, LabelBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { makeCard } from './card.js';
import { getStart } from './profile.js';
import { runProbe } from '../probe-badges.mjs';
import { TOKEN_MANAGER_ID } from './reader-token.js';

const aliases = new Map([
  ['نيترو', 'nitro'], ['nitro', 'nitro'], ['بوست', 'boost'], ['boost', 'boost'],
  ['سنو', 'snow'], ['snow', 'snow'],
  ['فحص', 'probe'], ['probe', 'probe'],
  ['ping', 'ping'], ['بنج', 'ping'], ['help', 'help'], ['مساعدة', 'help'],
]);
export const slashCommands = [
  ...[
    { name: 'نيترو', description: 'عرض مراحل شارة النيترو لك أو لشخص تحدده' },
    { name: 'بوست', description: 'عرض مراحل شارة البوست لك أو لشخص تحدده' },
    { name: 'سنو', description: 'عرض مدة العضوية ومراحل Snow لك أو لشخص تحدده' },
  ].map(command => ({ ...command, options: [
    { name: 'user', description: 'الشخص المطلوب؛ اتركه فارغًا لعرض بياناتك', type: ApplicationCommandOptionType.User, required: false },
  ] })),
  { name: 'ping', description: 'فحص اتصال البوت واستقبال الأوامر' },
  { name: 'تحديث', description: 'إعداد قارئ الملفات الشخصية للحساب المسموح فقط', options: [
    { name: 'التوكن', description: 'تغيير توكن القارئ من نافذة خاصة', type: ApplicationCommandOptionType.Subcommand },
  ] },
];
const errors = {
  INVALID_TARGET: 'اكتب الأمر وحده لعرض بياناتك، أو أضف آيدي مستخدم صحيحًا أو منشن لشخص واحد، مثل: -سنو @User.',
  TARGET_NOT_FOUND: 'تعذر العثور على الشخص المحدد. تأكد من الآيدي أو المنشن.',
  TARGET_UNAVAILABLE: 'تعذرت قراءة حساب الشخص المحدد حاليًا. جرّب مرة أخرى.',
  SNOW_MEMBER_UNAVAILABLE: 'تعذرت قراءة عضوية الشخص المطلوب في السيرفر. تأكد أن البوت موجود في السيرفر وجرّب مرة أخرى.',
  SNOW_NOT_MEMBER: 'الشخص المطلوب غير موجود في هذا السيرفر؛ تعذر حساب مدة العضوية.',
  SNOW_MISSING_DATE: 'تاريخ دخول الشخص المطلوب للسيرفر غير متاح من ديسكورد، لذلك لا أستطيع حساب المدة بدقة.',
  PROFILE_NOT_FOUND: 'خدمة بيانات الشارات لا تعرف هذا الحساب أو لا تستطيع الوصول إليه. هذا لا يعني أن الحساب غير موجود أو أنه بدون نيترو.',
  PROFILE_PRIVATE: 'بيانات شارات هذا الحساب مخفية؛ تعذر قراءة تاريخ النيترو والبوست.',
  SERVICE_ACCESS: 'خدمة بيانات الشارات رفضت الوصول حاليًا. جرّب لاحقًا؛ لا تحتاج إضافة توكن حساب شخصي.',
  RATE_LIMIT: 'خدمة بيانات الشارات طلبت الانتظار. سيحترم البوت المهلة؛ جرّب لاحقًا.',
  BUSY: 'هناك طلبات شارات قيد المعالجة الآن. جرّب بعد قليل.',
  NETWORK: 'تعذر الاتصال بخدمة بيانات الشارات خلال الوقت المحدد. جرّب لاحقًا.',
  MISSING_DATE: 'خدمة بيانات الشارات لم توفر تاريخ بداية صالحًا لهذه الشارة؛ تعذر حساب المدة بدقة.',
  NO_DATE: 'لم ترجع خدمة البيانات تاريخًا لهذه الشارة. قد يكون الاشتراك/البوست غير فعال أو تكون البيانات غير متاحة أو متأخرة.',
  UNAVAILABLE: 'خدمة بيانات الشارات غير متاحة حاليًا أو أعادت بيانات غير صالحة. جرّب لاحقًا.',
  READER_NOT_CONFIGURED: 'قارئ الملفات الشخصية غير مُعدّ. استخدم /تحديث التوكن من الحساب المسموح.',
  READER_PYTHON_MISSING: 'Python غير متوفر للقارئ. يحتاج صاحب البوت توفير Python 3.10 أو أحدث، ثم تشغيل npm run setup:reader وnpm run check:reader.',
  READER_DEPENDENCY: 'مكتبة القارئ غير مثبتة بالإصدار المطلوب. يحتاج صاحب البوت تشغيل npm run setup:reader ثم npm run check:reader.',
  READER_PYTHON_VERSION: 'إصدار Python أقدم من المطلوب. يحتاج القارئ Python 3.10 أو أحدث؛ راجع إصدار المفسر في سجل بدء التشغيل.',
  READER_PACKAGE_MISSING: 'حزمة discord.py-self غير موجودة داخل بيئة Python التي شغّلت القارئ. راجع نتيجة الإعداد التلقائي في سجل الاستضافة، ثم أعد التشغيل بعد تصحيح السبب.',
  READER_PACKAGE_VERSION: 'إصدار discord.py-self المثبت يختلف عن 2.1.0 المطلوب. راجع npm run check:reader ثم npm run setup:reader وأعد التشغيل.',
  READER_PACKAGE_CONFLICT: 'المكتبة المحمّلة تتعارض مع مكتبة Discord أخرى أو ملفات محلية باسم discord. راجع بيئة Python؛ اترك PYTHON_BIN فارغًا لاستخدام بيئة المشروع المنفصلة ثم أعد التشغيل.',
  READER_IMPORT_FAILED: 'فشل تحميل مكتبة القارئ أو أحد متطلباتها. سجل بدء التشغيل يعرض نوع الخطأ واسم الحزمة المفقودة إن توفر؛ راجع نتيجة npm run check:reader.',
  READER_AUTH: 'رفض ديسكورد توكن القارئ. راجع الحساب وحدّثه بأمر /تحديث التوكن؛ لا توجد إعادة دخول تلقائية.',
  READER_VERIFICATION: 'توقف القارئ لأن ديسكورد طلب التحقق من الحساب. يحتاج صاحبه فتح تطبيق ديسكورد الرسمي وإكمال التحقق وتأمين الحساب قبل إعادة تشغيل البوت.',
  READER_ACCESS: 'توقف القارئ بعد رفض ديسكورد الوصول. يحتاج صاحب البوت مراجعة حالة الحساب؛ لن تتكرر الطلبات تلقائيًا.',
  READER_STARTUP: 'تعذر بدء القارئ فتوقف لهذه الجلسة. راجع npm run check:reader واتصال الاستضافة قبل إعادة تشغيل البوت.',
  READER_PROTOCOL: 'توقف القارئ بسبب استجابة داخلية غير صالحة. يحتاج صاحب البوت مراجعة ملفات القارئ وإعداداته قبل إعادة التشغيل.',
  READER_TIMEOUT: 'توقف القارئ بعد تجاوز مهلة الاستجابة. يحتاج صاحب البوت مراجعة اتصال القارئ قبل إعادة التشغيل.',
  READER_CLOSED: 'اتصال القارئ مغلق لهذه الجلسة. يحتاج صاحب البوت مراجعة السبب في السجل قبل إعادة التشغيل.',
  TOKEN_INVALID: 'أدخل توكن القارئ فقط، دون مسافات أو بادئة Bot.',
  TOKEN_UNCHANGED: 'هذا هو التوكن المستخدم حاليًا؛ أدخل التوكن الجديد.',
  TOKEN_BUSY: 'تحديث التوكن قيد التنفيذ. انتظر اكتماله.',
  TOKEN_SOURCE: 'تحديث التوكن يحتاج PROFILE_SOURCE=discord.py-self ثم إعادة تشغيل البوت.',
  TOKEN_STORE_WRITE: 'تعذر حفظ التوكن. بقي الإعداد السابق؛ راجع صلاحية الكتابة في مجلد data.',
};
const help = 'الأوامر: -سنو، -نيترو، -بوست، -ping (تقبل ! أيضًا). اكتب الأمر وحده لبياناتك، أو بعده آيدي مستخدم أو منشن لشخص واحد لعرض بياناته، مثل: -بوست @User. متاحة أيضًا: /سنو، /نيترو، /بوست، /ping؛ خيار user اختياري. يمكنك كتابة منشن البوت ثم الأمر. سنو يعرض مدة العضوية في السيرفر. تواريخ النيترو والبوست تُحفظ 24 ساعة وقد تتأخر عن حالة الحساب الحالية. أمر -فحص يجرب مسار شارات منفصلًا باعتماد البوت الرسمي؛ لا يفحص قارئ Python.';
const mentions = { parse: [], repliedUser: false };
// Log codes only: request objects and full errors can contain credentials.
export function errorCode(error) {
  const code = String(error?.code || error?.name || 'UNKNOWN');
  return /^[A-Za-z0-9_]{1,50}$/.test(code) ? code : 'UNKNOWN';
}

export function parseRequest(content, botId) {
  let text = String(content || '').normalize('NFKC')
    .replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g, '')
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '').trim().toLowerCase();
  // Only a leading bot mention invokes the command; a trailing one is a target.
  const botMention = botId ? new RegExp(`^<@!?${botId}>\\s*`) : null;
  const mentioned = Boolean(botMention && botMention.test(text));
  if (mentioned) text = text.replace(botMention, '').trim();
  if (!text) return mentioned ? { kind: 'help', targetId: null, invalidTarget: false } : null;
  const prefixed = /^[-!\u2010-\u2015\u2212]/.test(text);
  if (!prefixed && !mentioned) return null;
  if (prefixed) text = text.slice(1).trimStart();
  const [command, ...args] = text.split(/\s+/);
  const kind = aliases.get(command) || (mentioned ? 'help' : null);
  if (!kind) return null;
  const match = args[0]?.match(/^(?:<@!?(\d{17,20})>|(\d{17,20}))$/);
  const invalidTarget = ['nitro', 'boost', 'snow', 'probe'].includes(kind) && args.length > 0 && (args.length !== 1 || !match);
  return { kind, targetId: match?.[1] || match?.[2] || null, invalidTarget };
}

export function parseCommand(content, botId) {
  return parseRequest(content, botId)?.kind || null;
}

export function createCommandHandlers({ reader, config = {}, render = makeCard, probe = runProbe, logger = console, now = Date.now }) {
  const handledEvents = new Map();
  const tokenForms = new Map();
  const active = new Set();
  const cooldown = new Map();
  const probeCache = new Map();
  let probeActive = false, nextProbeAt = 0;
  let warnedEmpty = false;
  const warnedScopes = new Set();
  function claimEvent(type, id) {
    if (!id) return true;
    const key = `${type}:${id}`;
    if ((handledEvents.get(key) || 0) > now()) return false;
    if (handledEvents.size >= 5000) handledEvents.delete(handledEvents.keys().next().value);
    handledEvents.set(key, now() + 15 * 60 * 1000);
    return true;
  }
  function scope(guildId, channelId) {
    if (config.guildId && config.guildId !== guildId) return 'هذا البوت مخصص لسيرفر آخر حسب إعداد GUILD_ID.';
    if (config.channelId && config.channelId !== channelId) return `الأوامر مفعلة في <#${config.channelId}> فقط حسب إعداد CHANNEL_ID.`;
    return '';
  }
  function logFailure(label, error) { logger.warn(`[${label}] ${errorCode(error)}`); }
  async function tokenInteraction(interaction, submitted) {
    const send = payload => interaction.deferred || interaction.replied
      ? interaction.editReply(payload)
      : interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    try {
      if (interaction.user.id !== TOKEN_MANAGER_ID) {
        await send({ content: 'هذا الأمر غير مسموح لحسابك.', allowedMentions: mentions });
        return;
      }
      const restriction = !interaction.inGuild() ? 'استخدم هذا الأمر داخل السيرفر.' : scope(interaction.guildId, interaction.channelId);
      if (restriction) { await send({ content: restriction, allowedMentions: mentions }); return; }
      if (typeof reader.updateToken !== 'function') {
        await send({ content: 'تحديث توكن القارئ غير متاح في هذا الإصدار.', allowedMentions: mentions });
        return;
      }
      if (!submitted) {
        if (interaction.options?.getSubcommand() !== 'التوكن') return;
        // Reopening replaces an older form; every form is bound to its opener,
        // guild and channel, expires after ten minutes and is single-use.
        for (const [id, form] of tokenForms) if (form.userId === interaction.user.id) tokenForms.delete(id);
        const customId = `reader-token:${randomUUID()}`;
        tokenForms.set(customId, { userId: interaction.user.id, guildId: interaction.guildId, channelId: interaction.channelId, until: now() + 600000 });
        const input = new TextInputBuilder().setCustomId('reader-token').setStyle(TextInputStyle.Short)
          .setPlaceholder('ألصق توكن القارئ الجديد هنا').setRequired(true).setMaxLength(2048);
        const label = new LabelBuilder().setLabel('توكن القارئ الجديد').setTextInputComponent(input);
        await interaction.showModal(new ModalBuilder().setCustomId(customId).setTitle('تحديث توكن القارئ').addLabelComponents(label));
        return;
      }
      const form = tokenForms.get(interaction.customId);
      if (!form || form.until <= now() || form.userId !== interaction.user.id || form.guildId !== interaction.guildId || form.channelId !== interaction.channelId) {
        await send({ content: 'انتهت صلاحية النافذة. افتح /تحديث التوكن من جديد.', allowedMentions: mentions });
        return;
      }
      tokenForms.delete(interaction.customId);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await reader.updateToken(interaction.fields.getTextInputValue('reader-token'));
      await send({ content: '✅ تم تحديث توكن القارئ وحفظه وتفعيله.', allowedMentions: mentions });
    } catch (error) {
      // Never echo submitted fields or raw SDK/reader errors containing secrets.
      await report(send, error, 'token-update');
    }
  }
  async function report(send, error, kind) {
    logFailure(`command:${kind}`, error);
    const content = Object.hasOwn(errors, error?.code || '') ? errors[error.code] : 'تعذر إرسال النتيجة. راجع سجل البوت وصلاحيات إرسال الرسائل والروابط وإرفاق الصور.';
    try { await send({ content, allowedMentions: mentions }); }
    catch (sendError) { logFailure('error-reply-failed', sendError); }
  }
  function probeReply(result, targetId, cached) {
    const verdicts = {
      MISSING_BOT_TOKEN: 'لم يتوفر توكن البوت للفحص. راجع BOT_TOKEN في إعدادات الاستضافة.',
      BOT_AUTH_CHECK_FAILED: 'تعذر التحقق من اعتماد البوت؛ لم تُفحص الشارات.',
      BADGES_REJECTED_BOT_AUTH: 'ديسكورد رفض اعتماد البوت على مسار الشارات. لا يثبت هذا المسار حلًا لقراءة التواريخ.',
      BADGES_ROUTE_UNAVAILABLE: 'لم يُرجع مسار الشارات استجابة ناجحة. راجع أكواد التقرير.',
      DETAIL_LOOKUP_STOPPED: 'توقف الفحص عند رفض الوصول أو مهلة الطلبات أو مشكلة الاتصال.',
      CHECK_BADGE_FIELDS_NOT_A_CONFIRMED_SOLUTION: 'استجاب مسار قائمة الشارات؛ تحتاج حقول التقرير مراجعة للتأكد من وجود تواريخ صالحة.',
    };
    const lines = (result.requests || []).map(item => `${item.route}: ${item.http ? `HTTP ${item.http}` : item.result || 'غير متاح'}${item.discordCode !== undefined ? ` | Discord ${item.discordCode}` : ''}`);
    // The runner retains only allowlisted fields. Redact the bot credential as an
    // additional boundary before any diagnostic text or attachment leaves the bot.
    let json = JSON.stringify(result, null, 2);
    if (config.token) json = json.replaceAll(config.token, '[REDACTED]');
    return {
      content: `فحص الشارات للحساب ${targetId}${cached ? ' — نتيجة محفوظة لمدة ساعة' : ''}\n${verdicts[result.outcome] || 'الفحص غير حاسم؛ راجع التقرير.'}\n\n${lines.join('\n')}\n\nالفحص تجريبي؛ HTTP 200 وحده لا يثبت توفر تاريخ النيترو أو البوست.`,
      files: [new AttachmentBuilder(Buffer.from(json, 'utf8'), { name: `badge-probe-${targetId}.json` })],
      allowedMentions: mentions,
    };
  }
  async function executeProbe(targetId, send) {
    const cached = probeCache.get(targetId);
    if (cached && cached.until > now()) { await send(probeReply(cached.result, targetId, true)); return; }
    if (probeActive) { await send({ content: 'يوجد فحص شارات قيد التنفيذ. انتظر اكتماله.', allowedMentions: mentions }); return; }
    if (nextProbeAt > now()) { await send({ content: `انتظر ${Math.ceil((nextProbeAt - now()) / 1000)} ثانية قبل فحص حساب جديد.`, allowedMentions: mentions }); return; }
    probeActive = true;
    nextProbeAt = now() + 60000;
    try {
      const result = await probe({ token: config.token, targetId });
      if (probeCache.size >= 100) probeCache.delete(probeCache.keys().next().value);
      probeCache.set(targetId, { result, until: now() + 3600000 });
      await send(probeReply(result, targetId, false));
    } finally { probeActive = false; }
  }
  async function execute({ kind, user, client, guild, guildId, channelId, send, defer, targetId, targetUser, invalidTarget = false }) {
    try {
      if (kind === 'ping') {
        await send({ content: 'Pong! ✅ البوت يستقبل الأوامر ويرد. عضوية السيرفر تُفحص بأمر !سنو، وشارات الحساب بأمر -نيترو أو -بوست.', allowedMentions: mentions });
        return;
      }
      if (kind === 'help') { await send({ content: help, allowedMentions: mentions }); return; }
      if (invalidTarget) throw Object.assign(new Error('TARGET_SYNTAX'), { code: 'INVALID_TARGET' });
      const requester = user;
      const requestedId = targetId || requester.id;
      // Throttle the requester even when they switch target members.
      const key = `${guildId}:${requester.id}`;
      if (active.has(key)) { await send({ content: 'طلبك السابق قيد المعالجة. انتظر اكتماله.', allowedMentions: mentions }); return; }
      if ((cooldown.get(key) || 0) > now()) { await send({ content: 'انتظر 3 ثوانٍ بين طلبات الشارات.', allowedMentions: mentions }); return; }
      active.add(key);
      cooldown.set(key, now() + 3000);
      try {
        if (defer) await defer();
        logger.info(`[command:${kind}] guild=${guildId} channel=${channelId}`);
        if (kind === 'probe') { await executeProbe(requestedId, send); return; }
        let since, profile;
        if (kind === 'snow') {
          let member;
          try {
            // One REST member lookup; no bulk fetch or privileged member intent.
            // Force a fresh joinedAt so a previous membership is never reused.
            member = await guild.members.fetch({ user: requestedId, force: true });
          } catch (error) {
            logFailure('snow-member', error);
            throw Object.assign(new Error('SNOW_MEMBER'), { code: String(error?.code) === '10007' ? 'SNOW_NOT_MEMBER' : 'SNOW_MEMBER_UNAVAILABLE' });
          }
          since = member?.joinedAt;
          if (!(since instanceof Date) || !Number.isFinite(+since) || +since > now()) {
            throw Object.assign(new Error('SNOW_DATE'), { code: 'SNOW_MISSING_DATE' });
          }
          user = member.user || (requestedId === requester.id ? requester : null);
          if (!user || user.id !== requestedId) throw Object.assign(new Error('TARGET_USER'), { code: 'TARGET_NOT_FOUND' });
        } else {
          if (requestedId !== requester.id) {
            try {
              user = targetUser?.id === requestedId ? targetUser : await client.users.fetch(requestedId);
            } catch (error) {
              logFailure('target-user', error);
              throw Object.assign(new Error('TARGET_USER'), { code: String(error?.code) === '10013' ? 'TARGET_NOT_FOUND' : 'TARGET_UNAVAILABLE' });
            }
            if (!user || user.id !== requestedId) throw Object.assign(new Error('TARGET_USER'), { code: 'TARGET_NOT_FOUND' });
          }
          profile = await reader.get(requestedId);
          since = getStart(profile, kind, now());
        }
        await send(await render(user, kind, since, new Date(now()), requester, profile));
      } finally { active.delete(key); }
    } catch (error) { await report(send, error, kind); }
  }
  async function onMessage(message) {
    if (message.author.bot || !message.inGuild()) return;
    if (!message.content) {
      if (!warnedEmpty) {
        warnedEmpty = true;
        logger.warn('[EMPTY_CONTENT] وصلت رسالة بلا محتوى نصي (قد تكون مرفقًا فقط). إذا كانت أمرًا نصيًا، فعّل Message Content Intent في Developer Portal وأعد التشغيل، أو استخدم /ping أو منشن البوت.');
      }
      return;
    }
    const request = parseRequest(message.content, message.client.user.id);
    if (!request) return;
    if (!claimEvent('message', message.id)) return;
    const { kind, targetId, invalidTarget } = request;
    const permissions = message.guild.members.me ? message.channel.permissionsFor(message.guild.members.me) : null;
    const sendFlag = message.channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
    if (permissions && (!permissions.has(PermissionFlagsBits.ViewChannel) || !permissions.has(sendFlag))) {
      logger.warn(`[MISSING_PERMISSIONS] channel=${message.channelId}: ViewChannel / ${message.channel.isThread() ? 'SendMessagesInThreads' : 'SendMessages'}`);
      return;
    }
    const send = async payload => {
      // Discord also deduplicates retries/parallel instances of this bot using
      // the invoking message's snowflake as a stable nonce.
      const outgoing = { ...payload, ...(message.id ? { nonce: message.id, enforceNonce: true } : {}) };
      if (permissions && !permissions.has(PermissionFlagsBits.ReadMessageHistory)) return message.channel.send(outgoing);
      try { return await message.reply({ ...outgoing, failIfNotExists: false }); }
      catch (error) {
        logFailure('message-reply-failed', error);
        return message.channel.send(outgoing);
      }
    };
    const restriction = scope(message.guildId, message.channelId);
    try {
      if (restriction) {
        const key = `${message.guildId}:${message.channelId}`;
        if (!warnedScopes.has(key)) {
          if (warnedScopes.size >= 100) warnedScopes.clear();
          warnedScopes.add(key);
          logger.warn(`[COMMAND_SCOPE] guild=${message.guildId} channel=${message.channelId}: تحقق من GUILD_ID وCHANNEL_ID.`);
        }
        await send({ content: restriction, allowedMentions: mentions });
        return;
      }
      if (['nitro', 'boost', 'snow'].includes(kind) && permissions) {
        const missing = ['EmbedLinks', 'AttachFiles'].filter(name => !permissions.has(PermissionFlagsBits[name]));
        if (missing.length) {
          logger.warn(`[MISSING_PERMISSIONS] channel=${message.channelId}: ${missing.join(', ')}`);
          await send({ content: `البوت يستقبل الأمر، لكن يحتاج هذه الصلاحيات في الروم: ${missing.join('، ')}.`, allowedMentions: mentions });
          return;
        }
      }
      if (kind === 'probe' && permissions && !permissions.has(PermissionFlagsBits.AttachFiles)) {
        await send({ content: 'أمر -فحص يحتاج صلاحية AttachFiles لإرفاق التقرير التشخيصي.', allowedMentions: mentions });
        return;
      }
      await execute({ kind, user: message.author, client: message.client, guild: message.guild, guildId: message.guildId, channelId: message.channelId, targetId, invalidTarget, send,
        defer: () => { void message.channel.sendTyping().catch(error => logFailure('typing', error)); } });
    } catch (error) { logFailure('message-handler', error); }
  }
  async function onInteraction(interaction) {
    if (interaction.isModalSubmit?.() && interaction.customId?.startsWith('reader-token:')) {
      if (!claimEvent('interaction', interaction.id)) return;
      await tokenInteraction(interaction, true);
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'تحديث') {
      if (!claimEvent('interaction', interaction.id)) return;
      await tokenInteraction(interaction, false);
      return;
    }
    const kind = aliases.get(interaction.commandName);
    if (!kind) return;
    if (!claimEvent('interaction', interaction.id)) return;
    const send = payload => interaction.deferred || interaction.replied ? interaction.editReply(payload) : interaction.reply(payload);
    try {
      const restriction = !interaction.inGuild() ? 'استخدم هذا الأمر داخل السيرفر.' : scope(interaction.guildId, interaction.channelId);
      if (restriction) {
        await interaction.reply({ content: restriction, flags: MessageFlags.Ephemeral, allowedMentions: mentions });
        return;
      }
      const targetUser = ['nitro', 'boost', 'snow'].includes(kind) ? interaction.options?.getUser('user') : null;
      await execute({ kind, user: interaction.user, client: interaction.client, guild: interaction.guild, guildId: interaction.guildId, channelId: interaction.channelId, targetId: targetUser?.id, targetUser,
        send, defer: () => interaction.deferReply() });
    } catch (error) { logFailure('interaction-handler', error); }
  }
  function cleanup() {
    for (const [id, until] of handledEvents) if (until <= now()) handledEvents.delete(id);
    for (const [id, form] of tokenForms) if (form.until <= now()) tokenForms.delete(id);
    for (const [id, until] of cooldown) if (until <= now()) cooldown.delete(id);
    for (const [id, entry] of probeCache) if (entry.until <= now()) probeCache.delete(id);
  }
  return { onMessage, onInteraction, cleanup };
}

export async function registerGuildCommands(client, guild, config, logger = console) {
  if (config.guildId && guild.id !== config.guildId) return;
  try {
    // Upsert just these commands; preserve any unrelated application commands.
    for (const command of slashCommands) await client.application.commands.create(command, guild.id);
    logger.info(`[SLASH_READY] guild=${guild.id}: /نيترو /بوست /سنو /ping /تحديث التوكن`);
  } catch (error) {
    logger.warn(`[SLASH_REGISTER_FAILED] guild=${guild.id} code=${errorCode(error)}: أعد دعوة البوت بنطاقي bot وapplications.commands، وراجع صلاحيات Use Application Commands.`);
  }
}
