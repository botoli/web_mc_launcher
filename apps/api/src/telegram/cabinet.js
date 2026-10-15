const crypto = require('node:crypto');
const { hashPassword, verifyPassword, passwordValid } = require('../auth/passwords');
const nickValid = s => typeof s === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(s);
const escape = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const date = ms => ms ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(ms) + ' МСК' : '—';

function installTelegramCabinet(app, { state, users, saveUsers, save, clean, now, audit, restriction, workerRequired }) {
    state.telegramProfiles ||= {};
    state.messages ||= {};
    state.deletions ||= {};
    state.passwordAttempts ||= {};
    state.activeMessages ||= {};
    const linked = id => Object.entries(users).find(([, u]) => u.telegramId != null && String(u.telegramId) === id);
    const eligible = login => Object.hasOwn(users, login) && !restriction(users[login]) && nickValid(users[login].nickname);
    const active = c => c && c.status === 'pending' && c.expires_at > now();
    function log(req, id, action, details = {}) {
        const login = details.login || linked(id)?.[0] || '';
        audit(req, login, details.category || 'account', action, { source: 'telegram', method: 'bot', bot: state.bot,
            telegramId: id, telegramUsername: state.telegramProfiles[id]?.username || '', ip: '', userAgent: '', target: 'telegram', ...details });
    }
    function remember(id, messageId, at = now()) {
        if (!Number.isSafeInteger(messageId) || messageId <= 0) return;
        const bucket = (state.messages[id] || []).filter(m => m.at > now() - 48 * 3600000 && m.id !== messageId);
        bucket.push({ id: messageId, at }); state.messages[id] = bucket.slice(-5000);
    }
    function enqueueDeletion(id, ids) {
        const existing = new Set(Object.values(state.deletions).filter(d => d.chat_id === Number(id)).flatMap(d => d.message_ids));
        const fresh = [...new Set(ids)].filter(n => Number.isSafeInteger(n) && n > 0 && n !== state.activeMessages[id]?.id && !existing.has(n));
        for (let i = 0; i < fresh.length; i += 100) {
            const key = crypto.randomUUID();
            state.deletions[key] = { id: key, chat_id: Number(id), message_ids: fresh.slice(i, i + 100), at: now(), nextAt: now() };
        }
    }
    function activate(id, messageId) {
        state.activeMessages[id] = { id: messageId };
        // An old cleanup job must never remove the screen currently in use.
        for (const [key, task] of Object.entries(state.deletions)) {
            if (task.chat_id !== Number(id)) continue;
            task.message_ids = task.message_ids.filter(n => n !== messageId);
            if (!task.message_ids.length) delete state.deletions[key];
        }
        enqueueDeletion(id, (state.messages[id] || []).map(m => m.id));
    }
    function pending(req) {
        for (const [key, task] of Object.entries(state.deletions)) {
            task.message_ids = task.message_ids.filter(id => id !== state.activeMessages[task.chat_id]?.id);
            if (!task.message_ids.length || task.at <= now() - 48 * 3600000) {
                delete state.deletions[key];
            }
        }
        return Object.values(state.deletions).filter(d => d.nextAt <= now()).slice(0, 50).map(d => ({
            id: d.id, method: 'deleteMessages', body: { chat_id: d.chat_id, message_ids: d.message_ids },
        }));
    }
    function revoke(login) {
        for (const [key, s] of Object.entries(state.sessions)) if (s.login === login) delete state.sessions[key];
        users[login].launcherVersion = (users[login].launcherVersion || 0) + 1;
        users[login].token = null;
    }
    app.post('/api/internal/telegram/pending-actions', workerRequired, (req, res) => { const actions = pending(req); save(); res.json({ actions }); });
    app.post('/api/internal/telegram/delivery', workerRequired, (req, res) => {
        const { kind, chat_id, message_id, operation_id } = req.body;
        if (!Number.isSafeInteger(chat_id) || chat_id <= 0) return res.status(400).json({ error: 'Invalid chat' });
        if (kind === 'sent' || kind === 'edited') {
            if (!Number.isSafeInteger(message_id) || message_id <= 0) return res.status(400).json({ error: 'Invalid message' });
            remember(String(chat_id), message_id);
            activate(String(chat_id), message_id);
        } else if (['deleted', 'delete_failed'].includes(kind)) {
            const task = Object.hasOwn(state.deletions, operation_id) && state.deletions[operation_id];
            if (!task || task.chat_id !== chat_id) return res.status(404).json({ error: 'Unknown operation' });
            if (kind === 'deleted') {
                const removed = new Set(task.message_ids);
                state.messages[chat_id] = (state.messages[chat_id] || []).filter(m => !removed.has(m.id));
                delete state.deletions[operation_id];
            } else {
                task.nextAt = now() + 30000;
            }
        } else return res.status(400).json({ error: 'Invalid delivery kind' });
        const actions = ['sent', 'edited'].includes(kind) ? pending(req) : undefined;
        save(); res.json({ success: true, ...(actions ? { actions } : {}) });
    });

    app.post('/api/internal/telegram/update', workerRequired, (req, res) => {
        const update = req.body;
        if (!Number.isSafeInteger(update.update_id) || update.update_id < 0) return res.status(400).json({ error: 'Invalid update' });
        if (update.update_id < state.offset) return res.json({ actions: pending(req) });
        clean();
        const actions = [];
        const button = (text, callback_data) => ({ text, callback_data });
        const keyboard = rows => ({ inline_keyboard: rows });
        const back = keyboard([[button('✖️ Отмена', 'menu:cancel')]]);
        const menu = id => keyboard(linked(id) ? [
            [button('👤 Личный кабинет', 'menu:account'), button('🎮 Войти в лаунчер', 'menu:login')],
            [button('✏️ Никнейм', 'menu:nickname'), button('📧 Email', 'menu:email')],
            [button('🔐 Пароль', 'menu:password'), button('💻 Сессии', 'menu:sessions')],
            [button('🔓 Отвязать', 'menu:unlink')],
            [button('❔ Помощь', 'menu:help')],
        ] : [
            [button('📝 Регистрация', 'menu:register')], [button('🔗 Привязать аккаунт', 'menu:link')],
            [button('🎮 Войти в лаунчер', 'menu:login')], [button('❔ Помощь', 'menu:help')],
        ]);
        const send = (id, text, markup = menu(String(id))) => actions.push({ method: 'sendMessage', body: { chat_id: Number(id), text, parse_mode: 'HTML', reply_markup: markup } });
        const context = (id, data) => state.conversations[id] = { ...data, expires_at: now() + 600000 };
        function clear(id) {
            const ctx = state.conversations[id], c = state.challenges[ctx?.challengeId];
            if (active(c) && c.telegramId === id) { c.status = 'cancelled'; delete c.passwordHash; delete c.verifiedPasswordHash; }
            delete state.conversations[id];
        }
        function account(id) {
            const entry = linked(id);
            if (!entry) return send(id, '👤 <b>Личный кабинет</b>\n\nСоздайте аккаунт или привяжите существующий.');
            const [login, u] = entry;
            const statuses = { pending: 'Ожидает проверки', confirmed: 'Подтверждён', banned: 'Заблокирован в лаунчере' };
            const sessions = Object.values(state.sessions).filter(s => s.login === login && s.expires_at > now() && (s.launcherVersion || 0) === (u.launcherVersion || 0)).length;
            send(id, `👤 <b>Личный кабинет</b>\n\nЛогин: <code>${escape(login)}</code>\nНикнейм: <b>${escape(u.nickname)}</b>\n` +
                `Email: ${escape(u.email || 'Не указан')}\nTelegram: ${u.telegramUsername ? '@' + escape(u.telegramUsername) + ' (ID ' + id + ')' : 'ID ' + id}\n` +
                `Discord: ${escape(u.discordUsername || u.discordId || 'Не привязан')}\nРоль: ${login === 'botoli1' || u.role === 'admin' ? 'Админ' : 'Игрок'}\n` +
                `Статус: ${statuses[u.registrationStatus] || statuses.confirmed}\n` + (u.frozenUntil > now() ? `Заморозка до: ${date(u.frozenUntil)}\n` : '') +
                (restriction(u) && u.moderationReason ? `Причина: ${escape(u.moderationReason)}\n` : '') +
                `Регистрация: ${date(u.registeredAt)}\nПоследний вход: ${date(u.lastLogin)}\nTelegram-сессий: ${sessions}\nПароль: ${u.password ? 'Задан' : 'Не задан'}`);
        }
        function choose(target, nick, id, registrationOnly = false) {
            if (!nickValid(nick)) return 'Ник должен содержать 3–16 латинских букв, цифр или _.';
            const found = Object.entries(users).filter(([, u]) => String(u.nickname).toLowerCase() === nick.toLowerCase());
            if (found.length > 1) return 'Несколько аккаунтов с таким ником. Обратитесь к администратору.';
            const entry = found[0];
            if (entry && registrationOnly) return 'Этот ник уже зарегистрирован. Используйте «Привязать аккаунт» и пароль существующего аккаунта.';
            if (entry && !eligible(entry[0])) return 'Аккаунт заблокирован или ник некорректен.';
            if (entry?.[1].telegramId && String(entry[1].telegramId) !== id) return 'Этот ник уже привязан к другому Telegram.';
            if (entry && !entry[1].password) return 'У аккаунта нет пароля. Для восстановления привязки обратитесь к администратору.';
            target.login = entry?.[0]; target.nickname = entry ? entry[1].nickname : nick;
            return null;
        }
        function confirm(id, ctx, target) {
            ctx.stage = 'confirm';
            if (ctx.challengeId) target.step = 'awaiting_confirmation';
            else ctx.nonce = crypto.randomBytes(16).toString('hex');
            send(id, `✅ <b>${target.login ? 'Привязка аккаунта' : 'Регистрация'}</b>\n\nНик: <b>${escape(target.nickname)}</b>\n` +
                (target.login ? 'Пароль проверен.' : 'Пароль задан.') + '\nПодтвердите действие кнопкой.', keyboard([
                    [button(ctx.challengeId ? '✅ Подтвердить вход' : '✅ Подтвердить', ctx.challengeId ? `yes:${target.code}` : `bind:${ctx.nonce}`)],
                    [button('✖️ Отмена', ctx.challengeId ? `no:${target.code}` : 'menu:cancel')],
                ]));
        }
        function commit(id, target) {
            const existing = linked(id);
            if (existing) {
                if (existing[0] !== target.login || !eligible(existing[0])) return 'Аккаунт изменился или доступ заблокирован.';
                return null;
            }
            const checked = {}, error = choose(checked, target.nickname, id);
            if (error) return error;
            if (checked.login !== target.login) return 'Аккаунт изменился. Введите ник заново.';
            const registered = !target.login;
            if (!registered && target.verifiedPasswordHash !== users[target.login].password) return 'Пароль изменился. Начните привязку заново.';
            if (registered) {
                if (!target.passwordHash) return 'Сначала задайте пароль для регистрации.';
                let login = `tg_${id}`;
                while (Object.hasOwn(users, login)) login = `tg_${id}_${crypto.randomBytes(4).toString('hex')}`;
                users[login] = { password: target.passwordHash, email: '', nickname: target.nickname, role: 'player', registrationStatus: 'pending', registeredAt: now(), lastLogin: null, token: null };
                target.login = login;
            }
            users[target.login].telegramId = id;
            users[target.login].telegramUsername = state.telegramProfiles[id]?.username || '';
            saveUsers();
            if (registered) log(req, id, 'registered', { category: 'account', login: target.login });
            log(req, id, 'telegram_linked', { category: 'account', login: target.login });
            delete target.passwordHash; delete target.verifiedPasswordHash;
            enqueueDeletion(id, (state.messages[id] || []).map(m => m.id));
            return null;
        }
        function command(id, action) {
            const entry = linked(id);
            if (action === 'account') return account(id);
            if (action === 'help') return send(id, '❔ <b>Лаунчер и личный кабинет</b>\n\n/register — регистрация: ник и пароль, затем подтверждение.\n/link — привязка существующего аккаунта с паролем.\n/login — ввод кода из лаунчера.\n/account — профиль, ник, email, пароль и сессии.\n/cancel — отмена.\n\nПароли не отображаются в ответах. В чате остаётся одно сообщение бота; ваши ответы удаляются после обработки.');
            clear(id);
            if (['menu', 'start', 'cancel'].includes(action)) return entry ? account(id) : send(id, '🌙 <b>Equestrian Dream</b>\n\nСоздайте аккаунт или привяжите существующий, чтобы открыть личный кабинет.');
            if (['register', 'link'].includes(action)) {
                if (entry) return send(id, 'Аккаунт уже привязан. Данные можно изменить в личном кабинете.');
                context(id, { stage: 'nickname', registrationOnly: action === 'register' });
                return send(id, action === 'register' ? '📝 <b>Регистрация</b>\n\nВведите свободный игровой ник: 3–16 латинских букв, цифр или _.' : '🔗 <b>Привязка аккаунта</b>\n\nВведите игровой ник. Для существующего аккаунта потребуется пароль.', back);
            }
            if (action === 'login') { context(id, { stage: 'code' }); return send(id, '🔑 Введите код, показанный в лаунчере. Код действует 5 минут.', back); }
            if (!entry) return send(id, 'Сначала зарегистрируйте или привяжите аккаунт.');
            const [login, u] = entry;
            if (['nickname', 'email', 'password'].includes(action)) {
                const stage = action === 'password' ? (u.password ? 'password_current' : 'password_new') : `edit_${action}`;
                context(id, { stage, login, previousHash: u.password });
                return send(id, action === 'nickname' ? '✏️ Введите новый ник: 3–16 латинских букв, цифр или _.' : action === 'email' ? '📧 Введите новый email. Чтобы удалить email, отправьте «-».' : u.password ? '🔐 Введите текущий пароль. Сообщение с паролем будет удалено.' : '🔐 Задайте пароль: 8–128 символов.', back);
            }
            if (action === 'sessions') {
                const sessions = Object.values(state.sessions).filter(s => s.login === login && s.expires_at > now() && (s.launcherVersion || 0) === (u.launcherVersion || 0));
                return send(id, `💻 <b>Сессии лаунчера</b>\n\nTelegram-сессий: ${sessions.length}\n${sessions.slice(0, 10).map((s, i) => `${i + 1}. До ${date(s.expires_at)}`).join('\n')}${sessions.length > 10 ? `\nЕщё сессий: ${sessions.length - 10}` : ''}\n\nМожно завершить все сессии лаунчера, включая входы по паролю.`, keyboard([[button('Завершить все сессии', 'menu:revoke')], [button('В кабинет', 'menu:account')]]));
            }
            if (action === 'revoke' || action === 'unlink') {
                if (action === 'unlink' && (!eligible(login) || !u.password)) return send(id, !u.password ? 'Сначала задайте пароль в кабинете, чтобы сохранить доступ после отвязки.' : 'Отвязка заблокированного аккаунта недоступна.');
                const ctx = context(id, { stage: action, login, nonce: crypto.randomBytes(16).toString('hex') });
                return send(id, action === 'unlink' ? '🔓 Отвязать Telegram? Аккаунт сохранится. Войти на сайт можно будет по логину и паролю.' : 'Завершить все сессии лаунчера? Потребуется новый вход.', keyboard([[button('Подтвердить', `${action}:${ctx.nonce}`)], [button('Отмена', 'menu:cancel')]]));
            }
        }
        function enterCode(id, value, ctx) {
            const attempt = state.codeAttempts[id] ||= { count: 0, expires_at: now() + 60000 };
            if (++attempt.count > 5) return send(id, 'Слишком много попыток ввода кода. Повторите через минуту.', back);
            const code = value.replace(/[\s-]/g, '').toUpperCase();
            const found = Object.entries(state.challenges).find(([key, c]) => (!ctx?.challengeId || ctx.challengeId === key) && c.code === code && active(c) && (!c.telegramId || c.telegramId === id));
            if (!found) return send(id, 'Код неверный, истёк или уже используется.', back);
            const [key, c] = found;
            if (ctx?.challengeId !== key) clear(id);
            c.telegramId = id; c.code_verified = true; c.chatId = Number(id);
            const entry = linked(id);
            if (entry && !eligible(entry[0])) { c.status = 'rejected'; log(req, id, 'login', { category: 'auth', target: 'launcher', outcome: 'denied', reason: 'Доступ к лаунчеру заблокирован' }); return send(id, 'Аккаунт заблокирован или ник некорректен.'); }
            const next = context(id, { stage: entry ? 'confirm' : 'nickname', challengeId: key });
            if (entry) { c.login = entry[0]; c.nickname = entry[1].nickname; confirm(id, next, c); }
            else { c.step = 'awaiting_nickname'; send(id, 'Введите игровой ник. Новому аккаунту потребуется пароль.', back); }
        }
        function passwordAttempt(id) {
            let limit = state.passwordAttempts[id];
            if (!limit || limit.until <= now()) limit = state.passwordAttempts[id] = { count: 0, until: now() + 60000 };
            return ++limit.count <= 5;
        }
        const msg = update.message, cb = update.callback_query;
        const incoming = msg || cb?.message, from = msg?.from || cb?.from;
        const valid = incoming?.chat?.type === 'private' && Number.isSafeInteger(from?.id) && from.id > 0 && !from.is_bot && incoming.chat.id === from.id;
        if (valid) {
            const id = String(from.id), username = typeof from.username === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(from.username) ? from.username : '';
            state.telegramProfiles[id] = { username, at: now() };
            const entry = linked(id);
            if (entry && (entry[1].telegramUsername || '') !== username) {
                entry[1].telegramUsername = username; saveUsers();
                log(req, id, 'telegram_username_changed', { category: 'account', target: username });
            }
            remember(id, incoming.message_id, incoming.date ? incoming.date * 1000 : now());
            // Recover the current screen from a real inline-button callback after migration.
            if (cb && !state.activeMessages[id] && Number.isSafeInteger(incoming.message_id) && incoming.message_id > 0) activate(id, incoming.message_id);
            const ctx = state.conversations[id], c = state.challenges[ctx?.challengeId];
            const raw = typeof msg?.text === 'string' ? msg.text : '', value = raw.trim();
            const parsed = /^\/(start|menu|register|login|link|unlink|account|password|sessions|help|cancel)(?:@[A-Za-z0-9_]+)?(?:\s+(.*))?$/.exec(value);
            const isPassword = ctx?.stage?.includes('password');
            if (msg && isPassword) enqueueDeletion(id, [msg.message_id]);
            if (msg && parsed) {
                if (parsed[1] === 'start' && parsed[2]) {
                    const digest = crypto.createHash('sha256').update(parsed[2]).digest('hex');
                    const found = Object.entries(state.challenges).find(([, item]) => item.link_hash === digest && active(item) && (!item.telegramId || item.telegramId === id));
                    if (!found) send(id, 'Ссылка устарела или уже используется. Создайте новый запрос в лаунчере.');
                    else { if (ctx?.challengeId !== found[0]) clear(id); context(id, { stage: 'code', challengeId: found[0] }); send(id, '🔑 Введите код с экрана лаунчера. Ссылка не заменяет ввод кода.', back); }
                } else command(id, parsed[1]);
            } else if (msg) {
                if (ctx?.challengeId && !active(c)) { clear(id); send(id, 'Запрос истёк или отменён. Начните новый вход в лаунчере.'); }
                else if (ctx?.login && ['edit_nickname', 'edit_email', 'password_current', 'password_new', 'password_confirm'].includes(ctx.stage) && linked(id)?.[0] !== ctx.login) { clear(id); send(id, 'Привязка изменилась. Откройте кабинет заново.'); }
                else if (ctx?.stage === 'nickname') {
                    const target = c || ctx, error = choose(target, value, id, ctx.registrationOnly);
                    if (error) send(id, error, back);
                    else { ctx.stage = target.login ? 'link_password' : 'register_password'; if (c) c.step = 'awaiting_password'; send(id, target.login ? 'Введите пароль существующего аккаунта. Сообщение будет удалено.' : 'Задайте пароль: 8–128 символов. Сообщение будет удалено.', back); }
                } else if (['link_password', 'password_current'].includes(ctx?.stage)) {
                    const target = c || ctx, login = target.login;
                    if (!passwordAttempt(id)) { log(req, id, 'password_check', { login, category: 'auth', outcome: 'denied', reason: 'Лимит попыток' }); send(id, 'Слишком много попыток. Повторите через минуту.', back); }
                    else if (!Object.hasOwn(users, login) || !verifyPassword(raw, users[login].password)) { log(req, id, 'password_check', { login, category: 'auth', outcome: 'failed', reason: 'Неверный пароль' }); send(id, 'Неверный пароль.', back); }
                    else if (ctx.stage === 'link_password') { target.verifiedPasswordHash = users[login].password; confirm(id, ctx, target); }
                    else { ctx.stage = 'password_new'; ctx.previousHash = users[login].password; send(id, 'Введите новый пароль: 8–128 символов.', back); }
                } else if (['register_password', 'password_new'].includes(ctx?.stage)) {
                    if (!passwordValid(raw)) send(id, 'Пароль должен содержать от 8 до 128 символов без перевода строки.', back);
                    else { const target = c || ctx; target.passwordHash = hashPassword(raw); ctx.stage = ctx.stage === 'register_password' ? 'register_password_confirm' : 'password_confirm'; send(id, 'Повторите новый пароль.', back); }
                } else if (['register_password_confirm', 'password_confirm'].includes(ctx?.stage)) {
                    const target = c || ctx;
                    if (!verifyPassword(raw, target.passwordHash)) send(id, 'Пароли не совпадают. Повторите пароль или нажмите /cancel.', back);
                    else if (ctx.stage === 'register_password_confirm') confirm(id, ctx, target);
                    else if (users[ctx.login].password !== ctx.previousHash) { clear(id); send(id, 'Пароль изменился. Начните заново.'); }
                    else {
                        users[ctx.login].password = ctx.passwordHash; users[ctx.login].sessionVersion = (users[ctx.login].sessionVersion || 0) + 1;
                        revoke(ctx.login); saveUsers(); log(req, id, 'password_changed', { category: 'account' });
                        enqueueDeletion(id, (state.messages[id] || []).map(m => m.id)); clear(id); send(id, '✅ Пароль изменён. Старые сессии завершены.'); account(id);
                    }
                } else if (ctx?.stage === 'edit_nickname' || ctx?.stage === 'edit_email') {
                    const u = users[ctx.login];
                    if (ctx.stage === 'edit_nickname' && (!nickValid(value) || Object.entries(users).some(([key, other]) => key !== ctx.login && other.nickname?.toLowerCase() === value.toLowerCase()))) send(id, 'Некорректный или занятый ник.', back);
                    else if (ctx.stage === 'edit_email' && value !== '-' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) send(id, 'Введите корректный email или «-».', back);
                    else if (value.length > 254) send(id, 'Значение слишком длинное.', back);
                    else { const field = ctx.stage === 'edit_nickname' ? 'nickname' : 'email'; u[field] = value === '-' ? '' : value; saveUsers(); log(req, id, `${field}_changed`, { category: 'account', target: field === 'nickname' ? value : 'email' }); clear(id); send(id, '✅ Данные сохранены.'); account(id); }
                } else if (ctx?.stage === 'code' || /^[A-Fa-f0-9\s-]{6,12}$/.test(value)) enterCode(id, value, ctx);
                else if (ctx?.stage === 'confirm') send(id, 'Подтвердите действие кнопкой или нажмите /cancel.', back);
                else send(id, 'Используйте кнопки личного кабинета или /menu.');
            } else if (cb) {
                let answer = 'Готово';
                if (/^menu:(register|login|link|unlink|account|nickname|email|password|sessions|revoke|help|cancel)$/.test(cb.data || '')) command(id, cb.data.slice(5));
                else {
                    const match = /^(yes|no):([A-F0-9]{6,8})$/.exec(cb.data || '');
                    const target = match && Object.values(state.challenges).find(item => item.code === match[2] && item.telegramId === id && item.code_verified && active(item));
                    if (target && match[1] === 'no') { target.status = 'rejected'; delete target.passwordHash; delete target.verifiedPasswordHash; clear(id); answer = 'Вход отклонён.'; }
                    else if (target && target.step === 'awaiting_confirmation') { const error = commit(id, target); target.status = error ? 'rejected' : 'confirmed'; delete state.conversations[id]; answer = error || '✅ Вход подтверждён. Вернитесь в лаунчер.'; if (!error) account(id); }
                    else if (ctx?.stage === 'confirm' && !ctx.challengeId && cb.data === `bind:${ctx.nonce}`) { const error = commit(id, ctx); delete state.conversations[id]; answer = error || '✅ Регистрация или привязка завершена. Логин и данные — в кабинете.'; if (!error) account(id); }
                    else if (ctx && ['unlink', 'revoke'].includes(ctx.stage) && cb.data === `${ctx.stage}:${ctx.nonce}` && linked(id)?.[0] === ctx.login && (ctx.stage !== 'unlink' || eligible(ctx.login))) {
                        revoke(ctx.login);
                        if (ctx.stage === 'unlink') {
                            log(req, id, 'telegram_unlinked', { category: 'account' }); delete users[ctx.login].telegramId; delete users[ctx.login].telegramUsername;
                            for (const item of Object.values(state.challenges)) if ((item.login === ctx.login || item.telegramId === id) && ['pending', 'confirmed'].includes(item.status)) item.status = 'cancelled';
                            answer = '✅ Аккаунт отвязан. Прогресс сохранён, сессии завершены.';
                        } else { log(req, id, 'sessions_revoked', { category: 'auth', target: 'launcher' }); answer = '✅ Все сессии лаунчера завершены.'; }
                        saveUsers(); clear(id);
                    } else answer = 'Запрос недоступен или уже обработан. Откройте /menu.';
                    send(id, answer);
                }
                actions.unshift({ method: 'answerCallbackQuery', body: { callback_query_id: cb.id, text: answer.length > 180 ? 'Откройте сообщение бота.' : answer } });
            }
        }
        // Several domain handlers may emit a confirmation and a cabinet. Deliver one screen.
        const replies = actions.filter(a => a.method === 'sendMessage');
        const controls = actions.filter(a => a.method !== 'sendMessage');
        const screens = [];
        for (const chatId of new Set(replies.map(a => a.body.chat_id))) {
            const chatReplies = replies.filter(a => a.body.chat_id === chatId);
            const last = chatReplies[chatReplies.length - 1];
            const body = { ...last.body, text: [...new Set(chatReplies.map(a => a.body.text))].join('\n\n') };
            const current = state.activeMessages[chatId];
            screens.push({ method: current ? 'editMessageText' : 'sendMessage', body: { ...body, ...(current ? { message_id: current.id } : {}) } });
        }
        if (valid) enqueueDeletion(String(from.id), (state.messages[from.id] || []).map(m => m.id));
        state.offset = update.update_id + 1;
        const cleanup = screens.length ? [] : pending(req);
        save();
        // Delivery acknowledgements trigger cleanup after the new screen is visible.
        res.json({ actions: [...controls, ...screens, ...cleanup] });
    });
}
module.exports = { installTelegramCabinet };
