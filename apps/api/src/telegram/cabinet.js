const crypto = require('node:crypto');
const { hashPassword, verifyPassword, passwordValid } = require('../auth/passwords');
const nickValid = s => typeof s === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(s);
const escape = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const date = ms => ms ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(ms) + ' МСК' : '—';

function installTelegramCabinet(app, { state, users, saveUsers, save, clean, now, audit, restriction, workerRequired, launcherDownloadURL }) {
    state.telegramProfiles ||= {};
    state.messages ||= {};
    state.deletions ||= {};
    state.passwordAttempts ||= {};
    state.activeMessages ||= {};
    const linked = id => Object.entries(users).find(([, u]) => u.telegramId != null && String(u.telegramId) === id);
    const eligible = login => Object.hasOwn(users, login) && !restriction(users[login]) && nickValid(users[login].nickname);
    const active = c => c && c.status === 'pending' && c.expires_at > now();
    const verified = (c, id) => active(c) && c.code_verified && c.telegramId === id;
    const onboardingStages = ['nickname', 'link_password', 'register_password', 'register_password_confirm', 'confirm', 'nickname_correction'];
    function resetChoice(target) {
        for (const key of ['login', 'nickname', 'passwordHash', 'verifiedPasswordHash']) delete target[key];
    }
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
        const back = keyboard([[button("❌ Отмена", 'menu:cancel')]]);
        const menu = id => keyboard(linked(id) ? [
            ([button("👤 Личный кабинет", "menu:account")]),
            [button('✏️ Никнейм', 'menu:nickname'), button('📧 Email', 'menu:email')],
            [button('🔐 Пароль', 'menu:password'), button('💻 Сессии', 'menu:sessions')],
            [button('🔓 Отвязать', 'menu:unlink')],
            [button('❔ Помощь', 'menu:help')],
        ] : [
            [{ text: '📥 Скачать лаунчер', url: launcherDownloadURL }],
            [button('🔗 Привязать лаунчер', 'menu:login')], [button('❔ Помощь', 'menu:help')],
        ]);
        const send = (id, text, markup = menu(String(id))) => actions.push({ method: 'sendMessage', body: { chat_id: Number(id), text, parse_mode: 'HTML', reply_markup: markup } });
        const downloadLink = `<a href="${escape(launcherDownloadURL)}">Скачать лаунчер с сайта</a>`;
        const launcherSteps = `1. Откройте лаунчер. Если он ещё не установлен: ${downloadLink}.\n2. Выберите вход через Telegram — в лаунчере появится код.\n3. Скопируйте код и отправьте его сообщением в этот чат.\n\n⏳ Код действует <b>5 минут</b> с момента получения. Если время истекло, получите новый код в лаунчере.`;
        const codePrompt = (id, fromLink = false) =>
            send(
              id,
              "🔑 <b>Вход через лаунчер</b>\n\n" +
                (fromLink
                  ? "Вы открыли бота по ссылке из лаунчера. Теперь подтвердите запрос кодом с его экрана.\n\n"
                  : "Для регистрации или привязки аккаунта начните с лаунчера:\n\n") +
                launcherSteps +
                "\n\nПосле кода бот подскажет следующий шаг. Чтобы прервать вход, нажмите «Отмена».",
              back,
            );
        const welcome = (id, notice = '') => send(id, (notice ? notice + '\n\n' : '') +
            "🌙 <b>Добро пожаловать в Equestrian Dream!</b>\n\nЧтобы зарегистрироваться или войти, начните с лаунчера.\n\n" + launcherSteps +
            "\n\nЗатем укажите игровой ник: бот поможет создать новый аккаунт или привязать существующий. Для существующего аккаунта понадобится его пароль.");
        const nicknamePrompt = id => send(id, "🎮 <b>Игровой ник</b>\n\n✅ Код принят. Введите игровой ник отдельным сообщением.\n\n<b>Уже играли у нас?</b> Укажите прежний ник — затем бот попросит пароль этого аккаунта.\n<b>Вы впервые?</b> Придумайте ник — затем зададите пароль для регистрации.\n\nВведите игровой ник: <b>3–16 символов</b>, латинские буквы, цифры и знак <code>_</code>.", back);
        const correctionButton = c => button('Ошибка в нике?', `nick:${c.code}`);
        const correction = c => keyboard([[correctionButton(c), button("❌ Отмена", 'menu:cancel')]]);
        const newAccountNotice = target => `🆕 <b>Новый аккаунт</b>\n\nАккаунт с ником <b>${escape(target.nickname)}</b> не найден.\n\n<b>Уже играли у нас?</b> Возможно, в нике опечатка. Нажмите «Ошибка в нике?» → «Ввести ник заново», чтобы найти свой аккаунт.\n\n<b>Регистрируетесь впервые?</b> Продолжайте с этим ником. Аккаунт будет создан после вашего подтверждения.\n\n`;
        const passwordPrivacy = '🔒 Сообщение с паролем удаляется после обработки. Бот не показывает пароль в ответах.';
        const repeatPassword = '🔐 <b>Подтверждение пароля</b>\n\nПовторите новый пароль отдельным сообщением, чтобы исключить опечатку.\n\n' + passwordPrivacy;
        function passwordReply(id, ctx, target, text) {
            if (!ctx.challengeId) return send(id, text, back);
            send(id, (target.login ? `👤 <b>Существующий аккаунт</b>\n\nНик: <b>${escape(target.nickname)}</b>\n\n` : newAccountNotice(target)) + text, correction(target));
        }
        function correctionPrompt(id, target) {
            send(id, `✏️ <b>Проверка игрового ника</b>\n\nСейчас указан ник: <b>${escape(target.nickname)}</b>.\n\nЕсли всё верно, нажмите «Продолжить с этим ником» — вернётесь к прежнему шагу.\n\nЕсли заметили опечатку, выберите «Ввести ник заново». Пароль потребуется ввести заново. Код из лаунчера сохранится, но его срок действия не продлится.`, keyboard([
                [button('Продолжить с этим ником', `nick_keep:${target.code}`)],
                [button('Ввести ник заново', `nick_reset:${target.code}`)],
                [button("❌ Отмена", 'menu:cancel')],
            ]));
        }
        function resumeOnboarding(id, ctx, target) {
            if (ctx.stage === 'confirm') return confirm(id, ctx, target);
            passwordReply(id, ctx, target, ctx.stage === 'link_password' ? ("🔐 <b>Подтвердите, что аккаунт принадлежит вам</b>\n\nВведите пароль существующего аккаунта отдельным сообщением. Это тот же пароль, который используете для входа на сайт или в лаунчер.\n\nЕсли забыли пароль, обратитесь к администратору для восстановления доступа. Если ошиблись в нике, нажмите «Ошибка в нике?».\n\n" +
              passwordPrivacy) : ctx.stage === 'register_password_confirm' ? repeatPassword : ("🔐 <b>Придумайте пароль</b>\n\nДля регистрации нового аккаунта отправьте пароль отдельным сообщением: <b>8–128 символов</b>, без перевода строки. Следующим шагом его нужно будет повторить.\n\nСохраните пароль: он понадобится для входа на сайт и входа в лаунчер по паролю.\n\n" +
              passwordPrivacy));
        }
        const context = (id, data) => state.conversations[id] = { ...data, expires_at: now() + 600000 };
        function clear(id) {
            const ctx = state.conversations[id], c = state.challenges[ctx?.challengeId];
            if (c?.telegramId === id) {
                if (active(c)) c.status = 'cancelled';
                delete c.passwordHash; delete c.verifiedPasswordHash;
            }
            delete state.conversations[id];
        }
        function account(id) {
            const entry = linked(id);
            if (!entry) return welcome(id);
            const [login, u] = entry;
            const statuses = { pending: 'Ожидает проверки', confirmed: 'Подтверждён', banned: 'Заблокирован в лаунчере' };
            const sessions = Object.values(state.sessions).filter(s => s.login === login && s.expires_at > now() && (s.launcherVersion || 0) === (u.launcherVersion || 0)).length;
            send(id, `👤 <b>Личный кабинет</b>\n\nЛогин: <code>${escape(login)}</code>\nНикнейм: <b>${escape(u.nickname)}</b>\n` +
                `Email: ${escape(u.email || 'Не указан')}\nTelegram: ${u.telegramUsername ? '@' + escape(u.telegramUsername) + ' (ID ' + id + ')' : 'ID ' + id}\n` +
                `Discord: ${escape(u.discordUsername || u.discordId || 'Не привязан')}\nРоль: ${login === 'botoli1' || u.role === 'admin' ? 'Админ' : 'Игрок'}\n` +
                `Статус: ${statuses[u.registrationStatus] || statuses.confirmed}\n` + (u.frozenUntil > now() ? `Заморозка до: ${date(u.frozenUntil)}\n` : '') +
                (restriction(u) && u.moderationReason ? `Причина: ${escape(u.moderationReason)}\n` : '') +
                `Регистрация: ${date(u.registeredAt)}\nПоследний вход: ${date(u.lastLogin)}\nTelegram-сессий: ${sessions}\nПароль: ${u.password ? 'Задан' : 'Не задан'}\n\n` +
                "✅ Аккаунт привязан к вашему Telegram. Выберите действие кнопками ниже.\n\nДля входа на другом устройстве откройте там лаунчер, выберите вход через Telegram и отправьте новый код в этот чат. Повторная привязка через /login не требуется.");
        }
        function choose(target, nick, id) {
            if (!nickValid(nick)) return "⚠️ <b>Проверьте формат ника</b>\n\nНик должен содержать 3–16 латинских букв, цифр или _. Пробелы и кириллица не подходят.\n\nОтправьте исправленный ник отдельным сообщением.";
            const found = Object.entries(users).filter(([, u]) => String(u.nickname).toLowerCase() === nick.toLowerCase());
            if (found.length > 1) return "⚠️ <b>Не удалось выбрать аккаунт</b>\n\nНайдено несколько аккаунтов с таким ником. Обратитесь к администратору, чтобы уточнить данные для входа.";
            const entry = found[0];
            if (entry && !eligible(entry[0])) return "🔒 <b>Вход недоступен</b>\n\nАккаунт заблокирован или ник некорректен. Проверьте ник. Если он верный, обратитесь к администратору для уточнения причины.";
            if (entry?.[1].telegramId && String(entry[1].telegramId) !== id) return "🔒 <b>Аккаунт уже привязан</b>\n\nЭтот ник уже привязан к другому Telegram. Используйте тот Telegram для входа или обратитесь к администратору для восстановления доступа.";
            if (entry && !entry[1].password) return "🔐 <b>Нужно восстановить доступ</b>\n\nУ этого аккаунта ещё нет пароля, поэтому подтвердить владение через бота не получится. Для восстановления привязки обратитесь к администратору.";
            target.login = entry?.[0]; target.nickname = entry ? entry[1].nickname : nick;
            return null;
        }
        function confirm(id, ctx, target) {
            ctx.stage = 'confirm';
            target.step = 'awaiting_confirmation';
            const entry = linked(id);
            send(id, `✅ <b>${entry ? 'Вход в лаунчер' : target.login ? 'Привязка аккаунта' : 'Регистрация'}</b>\n\n` +
                (!target.login ? newAccountNotice(target) : `Ник: <b>${escape(target.nickname)}</b>\n\n`) +
                (entry ? "Код принят. Подтвердите вход в этот аккаунт на устройстве, где вы получили код.\n\nНажмите «Подтвердить вход» и вернитесь в лаунчер. Если передумали, нажмите «Отмена»." : target.login ? "🔐 <b>Пароль проверен</b> — осталось ваше подтверждение.\n\nПосле нажатия «Привязать и войти»:\n1. Этот аккаунт будет связан с вашим Telegram.\n2. Вы сможете управлять им в личном кабинете бота.\n3. Вход в лаунчер, где вы получили код, будет разрешён.\n\nПроверьте ник выше. После подтверждения вернитесь в лаунчер." : "🔐 <b>Пароль задан и подтверждён</b>.\n\nПосле нажатия «Зарегистрироваться и привязать»:\n1. Будет создан аккаунт с указанным ником.\n2. Аккаунт будет привязан к вашему Telegram.\n3. Вход в лаунчер будет разрешён.\n\nНовый аккаунт получит статус «Ожидает проверки». Проверьте ник и подтвердите регистрацию, затем вернитесь в лаунчер."), keyboard([
                    [button(entry ? '✅ Подтвердить вход' : target.login ? '✅ Привязать и войти' : '✅ Зарегистрироваться и привязать', `yes:${target.code}`)],
                    [...(!entry ? [correctionButton(target)] : []), button("❌ Отмена", 'menu:cancel')],
                ]));
        }
        function commit(id, target) {
            if (!verified(target, id) || target.step !== 'awaiting_confirmation') return "⏳ Сначала введите действующий код из лаунчера. Откройте вход через Telegram в лаунчере и отправьте новый код в этот чат.";
            const existing = linked(id);
            if (existing) {
                if (existing[0] !== target.login || !eligible(existing[0])) return "🔒 Аккаунт изменился или доступ заблокирован. Откройте /account для проверки данных; при ограничении доступа обратитесь к администратору.";
                return null;
            }
            const checked = {}, error = choose(checked, target.nickname, id);
            if (error) return error;
            if (checked.login !== target.login) return "⚠️ Аккаунт изменился во время привязки. Получите новый код в лаунчере и введите ник заново.";
            const registered = !target.login;
            if (!registered && target.verifiedPasswordHash !== users[target.login].password) return "🔐 Пароль аккаунта изменился во время проверки. Получите новый код в лаунчере и начните привязку заново с актуальным паролем.";
            if (registered) {
                if (!target.passwordHash) return "🔐 Для регистрации нужен пароль. Получите новый код в лаунчере, укажите ник и задайте пароль из 8–128 символов.";
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
            if (action === 'help') return send(id, ('❔ <b>Помощь — Equestrian Dream</b>\n\n<b>Как войти или зарегистрироваться</b>\n' + launcherSteps + '\n\n' +
        (entry ? '<b>Ваш аккаунт уже привязан</b>\nНовый код из лаунчера можно отправить прямо сюда — останется подтвердить вход кнопкой. Команда /login для привязанного аккаунта недоступна.'
          : '<b>Что будет после кода</b>\nВведите игровой ник. Для существующего аккаунта понадобится его пароль, для нового — придумайте пароль и повторите его. Затем подтвердите привязку кнопкой.\nЕсли в нике опечатка, нажмите «Ошибка в нике?» → «Ввести ник заново».\n/login — открыть инструкцию и ввод кода.') +
        '\n\n<b>Управление аккаунтом после привязки</b>\n/menu — главное меню.\n/account — личный кабинет, изменение ника и email.\n/password — задать или сменить пароль.\n/sessions — посмотреть и завершить сессии лаунчера.\n/unlink — отвязать Telegram от аккаунта.\n/cancel — отменить текущее действие.\n\n<b>Сообщения и пароли</b>\nВ чате остаётся один актуальный экран бота; ваши ответы удаляются после обработки. Пароли не отображаются в ответах.'));
            if (action === "login" && entry) return send(id, `✅ <b>Вы уже вошли в аккаунт</b>\n\nНик: <b>${escape(entry[1].nickname)}</b>\nАккаунт уже привязан к вашему Telegram, поэтому команда /login недоступна.\n\nОткройте «Личный кабинет» для управления аккаунтом. Для входа на другом устройстве получите новый код в лаунчере и отправьте его прямо в этот чат.`);
            clear(id);
            if (['menu', 'start', 'cancel'].includes(action)) {
                if (entry) {
                    if (action === 'cancel') send(id, '✖️ <b>Действие отменено</b>\n\nВы вернулись в личный кабинет. Можно выбрать другое действие.');
                    return account(id);
                }
                return welcome(id, action === 'cancel' ? '✖️ <b>Действие отменено</b>\nТекущий запрос закрыт. Для входа получите новый код в лаунчере.' : '');
            }
            if (['register', 'link'].includes(action)) {
                if (entry) return send(id, '✅ <b>Аккаунт уже привязан</b>\n\nПовторная привязка не требуется. Откройте «Личный кабинет», чтобы посмотреть профиль, изменить данные или управлять сессиями лаунчера.');
                return welcome(id);
            }
            if (action === 'login') { context(id, { stage: 'code' }); return codePrompt(id); }
            if (!entry) return welcome(id);
            const [login, u] = entry;
            if (['nickname', 'email', 'password'].includes(action)) {
                const stage = action === 'password' ? (u.password ? 'password_current' : 'password_new') : `edit_${action}`;
                context(id, { stage, login, previousHash: u.password });
                return send(id, action === 'nickname' ? "✏️ <b>Изменение игрового ника</b>\n\nВведите новый ник отдельным сообщением: 3–16 латинских букв, цифр или знаков _. Ник должен быть свободен.\n\nИзменение сохранится после отправки. Чтобы вернуться без изменений, нажмите «Отмена»." : action === 'email' ? "📧 <b>Изменение email</b>\n\nВведите новый адрес отдельным сообщением, например player@example.com. Чтобы удалить email, отправьте один символ <code>-</code>.\n\nИзменение сохранится после отправки. Чтобы вернуться без изменений, нажмите «Отмена»." : u.password ? "🔐 <b>Смена пароля — проверка доступа</b>\n\nВведите текущий пароль отдельным сообщением. Затем задайте новый пароль и повторите его. После смены пароля старые сессии будут завершены.\n\n🔒 Сообщение с паролем удаляется после обработки." : "🔐 <b>Создание пароля</b>\n\nОтправьте пароль отдельным сообщением: 8–128 символов без перевода строки. Затем повторите его для подтверждения. Сохраните пароль для входа на сайт и в лаунчер.\n\n🔒 Сообщение с паролем удаляется после обработки.", back);
            }
            if (action === 'sessions') {
                const sessions = Object.values(state.sessions).filter(s => s.login === login && s.expires_at > now() && (s.launcherVersion || 0) === (u.launcherVersion || 0));
                return send(id, (`💻 <b>Сессии лаунчера</b>\n\nTelegram-сессий: ${sessions.length}\n${sessions.length ? "Срок действия активных сессий:\n" : "Активных сессий входа через Telegram нет."}${sessions
            .slice(0, 10)
            .map((s, i) => `${i + 1}. До ${date(s.expires_at)}`)
            .join(
              "\n",
            )}${sessions.length > 10 ? `\nЕщё сессий: ${sessions.length - 10}` : ""}\n\nКнопка «Завершить все сессии» отключит все входы в лаунчер, включая входы по паролю. На устройствах потребуется войти заново. Перед завершением бот попросит подтверждение.`), keyboard([[button('Завершить все сессии', 'menu:revoke')], [button('В кабинет', 'menu:account')]]));
            }
            if (action === 'revoke' || action === 'unlink') {
                if (action === 'unlink' && (!eligible(login) || !u.password)) return send(id, !u.password ? "🔐 <b>Сначала задайте пароль</b>\n\nПароль позволит сохранить доступ к аккаунту после отвязки Telegram. Откройте «Пароль» в личном кабинете или отправьте /password, затем повторите отвязку." : "🔒 <b>Отвязка недоступна</b>\n\nОтвязка заблокированного аккаунта недоступна. За уточнением причины ограничения обратитесь к администратору.");
                const ctx = context(id, { stage: action, login, nonce: crypto.randomBytes(16).toString('hex') });
                return send(id, action === 'unlink' ? (`🔓 <b>Отвязка Telegram</b>\n\nНик: <b>${escape(u.nickname)}</b>\nЛогин: <code>${escape(login)}</code>\n\nПосле подтверждения Telegram будет отвязан, а все сессии лаунчера завершены. Аккаунт и игровой прогресс сохранятся.\n\nУбедитесь, что помните логин и пароль: они понадобятся для входа на сайт. Для новой привязки начните вход через Telegram в лаунчере.\n\nОтвязать аккаунт?`) : "💻 <b>Завершение всех сессий</b>\n\nВсе текущие входы в лаунчер станут недействительными, в том числе входы по паролю. На каждом устройстве потребуется войти заново.\n\nАккаунт и привязка Telegram сохранятся. Подтвердите действие кнопкой ниже.", keyboard([[button('Подтвердить', `${action}:${ctx.nonce}`)], [button('Отмена', 'menu:cancel')]]));
            }
        }
        function enterCode(id, value, ctx) {
            const attempt = state.codeAttempts[id] ||= { count: 0, expires_at: now() + 60000 };
            if (++attempt.count > 5) return send(id, "⏳ <b>Слишком много попыток ввода кода</b>\n\nПодождите минуту и попробуйте снова. Если код к тому времени истечёт, получите новый в лаунчере.", back);
            const code = value.replace(/[\s-]/g, '').toUpperCase();
            const found = Object.entries(state.challenges).find(([key, c]) => (!ctx?.challengeId || ctx.challengeId === key) && c.code === code && active(c) && (!c.telegramId || c.telegramId === id));
            if (!found) return send(id, "⚠️ <b>Не удалось принять код</b>\n\nКод неверный, истёк или уже используется. Сверьте его с экраном лаунчера и отправьте ещё раз.\n\nКод действует 5 минут. Если он больше не подходит, получите новый через вход по Telegram в лаунчере.", back);
            const [key, c] = found;
            if (ctx?.challengeId !== key) clear(id);
            resetChoice(c);
            c.telegramId = id; c.code_verified = true; c.chatId = Number(id);
            const entry = linked(id);
            if (entry && !eligible(entry[0])) { c.status = 'rejected'; log(req, id, 'login', { category: 'auth', target: 'launcher', outcome: 'denied', reason: 'Доступ к лаунчеру заблокирован' }); return send(id, "🔒 <b>Вход недоступен</b>\n\nАккаунт заблокирован или ник некорректен. Проверьте ник. Если он верный, обратитесь к администратору для уточнения причины."); }
            const next = context(id, { stage: entry ? 'confirm' : 'nickname', challengeId: key });
            if (entry) { c.login = entry[0]; c.nickname = entry[1].nickname; confirm(id, next, c); }
            else { c.step = 'awaiting_nickname'; nicknamePrompt(id); }
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
            let ctx = state.conversations[id], c = state.challenges[ctx?.challengeId];
            // Discard pre-upgrade standalone registration/linking and unverified onboarding.
            if (onboardingStages.includes(ctx?.stage) && (!ctx.challengeId || !c?.code_verified || c.telegramId !== id)) {
                clear(id); ctx = undefined; c = undefined;
            }
            const raw = typeof msg?.text === 'string' ? msg.text : '', value = raw.trim();
            const parsed = /^\/(start|menu|register|login|link|unlink|account|password|sessions|help|cancel)(?:@[A-Za-z0-9_]+)?(?:\s+(.*))?$/.exec(value);
            const isPassword = ctx?.stage?.includes('password');
            if (msg && isPassword) enqueueDeletion(id, [msg.message_id]);
            if (msg && parsed) {
                if (parsed[1] === 'start' && parsed[2]) {
                    const digest = crypto.createHash('sha256').update(parsed[2]).digest('hex');
                    const found = Object.entries(state.challenges).find(([, item]) => item.link_hash === digest && active(item) && (!item.telegramId || item.telegramId === id));
                    if (!found) send(id, "⏳ <b>Ссылка недоступна</b>\n\nСсылка устарела или уже используется. Откройте вход через Telegram в лаунчере заново, перейдите по новой ссылке и отправьте код с экрана лаунчера.");
                    else { if (ctx?.challengeId !== found[0]) clear(id); context(id, { stage: 'code', challengeId: found[0] }); (codePrompt(id, true)); }
                } else command(id, parsed[1]);
            } else if (msg) {
                if (ctx?.challengeId && !active(c)) { clear(id); send(id, "⏳ <b>Запрос больше не действует</b>\n\nЗапрос истёк или отменён. Начните новый вход через Telegram в лаунчере и отправьте новый код в этот чат."); }
                else if (ctx?.login && ['edit_nickname', 'edit_email', 'password_current', 'password_new', 'password_confirm'].includes(ctx.stage) && linked(id)?.[0] !== ctx.login) { clear(id); send(id, "⚠️ <b>Привязка аккаунта изменилась</b>\n\nТекущее действие остановлено. Откройте /account, чтобы увидеть актуальные данные и выбрать действие заново."); }
                else if (ctx?.stage === 'nickname') {
                    const target = c, error = choose(target, value, id);
                    if (error) send(id, error, back);
                    else { ctx.stage = target.login ? 'link_password' : 'register_password'; c.step = 'awaiting_password'; resumeOnboarding(id, ctx, target); }
                } else if (ctx?.stage === 'nickname_correction') {
                    correctionPrompt(id, c);
                } else if (['link_password', 'password_current'].includes(ctx?.stage)) {
                    const target = c || ctx, login = target.login;
                    if (!passwordAttempt(id)) { log(req, id, 'password_check', { login, category: 'auth', outcome: 'denied', reason: 'Лимит попыток' }); passwordReply(id, ctx, target, "⏳ <b>Слишком много попыток</b>\n\nПодождите минуту, затем введите пароль ещё раз. Если забыли пароль, обратитесь к администратору для восстановления доступа."); }
                    else if (!Object.hasOwn(users, login) || !verifyPassword(raw, users[login].password)) { log(req, id, 'password_check', { login, category: 'auth', outcome: 'failed', reason: 'Неверный пароль' }); passwordReply(id, ctx, target, "⚠️ <b>Неверный пароль</b>\n\nПроверьте раскладку клавиатуры, Caps Lock и пробелы. Отправьте пароль ещё раз отдельным сообщением. Если забыли его, обратитесь к администратору.\n\n🔒 Сообщение с паролем удаляется после обработки."); }
                    else if (ctx.stage === 'link_password') { target.verifiedPasswordHash = users[login].password; confirm(id, ctx, target); }
                    else { ctx.stage = 'password_new'; ctx.previousHash = users[login].password; send(id, ("🔐 <b>Новый пароль</b>\n\nТекущий пароль проверен. Введите новый пароль: 8–128 символов без перевода строки. Затем повторите его для подтверждения.\n\n" + passwordPrivacy), back); }
                } else if (['register_password', 'password_new'].includes(ctx?.stage)) {
                    const target = c || ctx;
                    if (!passwordValid(raw)) passwordReply(id, ctx, target, "⚠️ <b>Пароль не подходит</b>\n\nПароль должен содержать от 8 до 128 символов без перевода строки. Отправьте другой пароль отдельным сообщением — затем его нужно будет повторить.");
                    else { target.passwordHash = hashPassword(raw); ctx.stage = ctx.stage === 'register_password' ? 'register_password_confirm' : 'password_confirm'; passwordReply(id, ctx, target, repeatPassword); }
                } else if (['register_password_confirm', 'password_confirm'].includes(ctx?.stage)) {
                    const target = c || ctx;
                    if (!verifyPassword(raw, target.passwordHash)) passwordReply(id, ctx, target, "⚠️ <b>Пароли не совпадают</b>\n\nПовторите пароль, который задали на предыдущем шаге. Проверьте раскладку, регистр букв и пробелы.\n\nЕсли хотите задать другой пароль, нажмите «Отмена» и начните действие заново. Сообщение с паролем удаляется после обработки.");
                    else if (ctx.stage === 'register_password_confirm') confirm(id, ctx, target);
                    else if (users[ctx.login].password !== ctx.previousHash) { clear(id); send(id, "🔐 <b>Пароль уже изменился</b>\n\nС момента начала действия пароль аккаунта был обновлён. Изменения этого шага не сохранены. Откройте /password и начните заново с актуальным паролем."); }
                    else {
                        users[ctx.login].password = ctx.passwordHash; users[ctx.login].sessionVersion = (users[ctx.login].sessionVersion || 0) + 1;
                        revoke(ctx.login); saveUsers(); log(req, id, 'password_changed', { category: 'account' });
                        enqueueDeletion(id, (state.messages[id] || []).map(m => m.id)); clear(id); send(id, "✅ <b>Пароль изменён</b>\n\nНовый пароль сохранён. Старые сессии завершены — войдите на сайт и в лаунчер заново, используя новый пароль."); account(id);
                    }
                } else if (ctx?.stage === 'edit_nickname' || ctx?.stage === 'edit_email') {
                    const u = users[ctx.login];
                    if (ctx.stage === 'edit_nickname' && (!nickValid(value) || Object.entries(users).some(([key, other]) => key !== ctx.login && other.nickname?.toLowerCase() === value.toLowerCase()))) send(id, "⚠️ <b>Не удалось сохранить ник</b>\n\nНекорректный или занятый ник. Используйте 3–16 латинских букв, цифр или знаков _. Отправьте другой свободный ник.", back);
                    else if (ctx.stage === 'edit_email' && value !== '-' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) send(id, "⚠️ <b>Проверьте email</b>\n\nВведите корректный email, например player@example.com, или отправьте <code>-</code>, чтобы удалить адрес.", back);
                    else if (value.length > 254) send(id, "⚠️ <b>Слишком длинный адрес</b>\n\nEmail должен содержать не более 254 символов. Проверьте адрес и отправьте его ещё раз.", back);
                    else { const field = ctx.stage === 'edit_nickname' ? 'nickname' : 'email'; u[field] = value === '-' ? '' : value; saveUsers(); log(req, id, `${field}_changed`, { category: 'account', target: field === 'nickname' ? value : 'email' }); clear(id); send(id, "✅ <b>Данные сохранены</b>\n\nИзменения уже применены к аккаунту. Актуальные данные показаны в личном кабинете ниже."); account(id); }
                } else if (ctx?.stage === 'code' || /^[A-Fa-f0-9\s-]{6,12}$/.test(value)) enterCode(id, value, ctx);
                else if (ctx?.stage === 'confirm') confirm(id, ctx, c);
                else if (!entry) welcome(id);
                else send(id, "👤 <b>Выберите действие</b>\n\nОткройте /menu или используйте кнопки ниже, чтобы посмотреть аккаунт, изменить данные или управлять сессиями. Для входа в лаунчер отправьте код с его экрана.");
            } else if (cb) {
                let answer = 'Готово', screenSent = false;
                if (/^menu:(register|login|link|unlink|account|nickname|email|password|sessions|revoke|help|cancel)$/.test(cb.data || '')) command(id, cb.data.slice(5));
                else {
                    const match = /^(yes|no|nick|nick_reset|nick_keep):([A-F0-9]{6,8})$/.exec(cb.data || '');
                    const target = match && c?.code === match[2] && verified(c, id) ? c : null;
                    if (target && match[1] === 'no') { target.status = 'rejected'; delete target.passwordHash; delete target.verifiedPasswordHash; clear(id); answer = "Вход отклонён. Для повторного входа получите новый код в лаунчере."; }
                    else if (target && match[1] === 'nick' && !entry && onboardingStages.includes(ctx?.stage) && ctx.stage !== 'nickname') {
                        if (ctx.stage !== 'nickname_correction') ctx.returnStage = ctx.stage;
                        ctx.stage = 'nickname_correction'; correctionPrompt(id, target); screenSent = true;
                    }
                    else if (target && match[1] === 'nick_reset' && !entry && ctx?.stage === 'nickname_correction') {
                        resetChoice(target); target.step = 'awaiting_nickname'; ctx.stage = 'nickname'; delete ctx.returnStage;
                        nicknamePrompt(id); screenSent = true;
                    }
                    else if (target && match[1] === 'nick_keep' && !entry && ctx?.stage === 'nickname_correction') {
                        ctx.stage = ctx.returnStage; delete ctx.returnStage;
                        resumeOnboarding(id, ctx, target); screenSent = true;
                    }
                    else if (target && match[1] === 'yes' && ctx?.stage === 'confirm' && target.step === 'awaiting_confirmation') {
                        const error = commit(id, target); target.status = error ? 'rejected' : 'confirmed';
                        delete target.passwordHash; delete target.verifiedPasswordHash; delete state.conversations[id];
                        answer = error || '✅ Готово! Вход подтверждён. Вернитесь в лаунчер.'; if (!error) account(id);
                    }
                    else if (ctx && ['unlink', 'revoke'].includes(ctx.stage) && cb.data === `${ctx.stage}:${ctx.nonce}` && linked(id)?.[0] === ctx.login && (ctx.stage !== 'unlink' || eligible(ctx.login))) {
                        revoke(ctx.login);
                        if (ctx.stage === 'unlink') {
                            log(req, id, 'telegram_unlinked', { category: 'account' }); delete users[ctx.login].telegramId; delete users[ctx.login].telegramUsername;
                            for (const item of Object.values(state.challenges)) if ((item.login === ctx.login || item.telegramId === id) && ['pending', 'confirmed'].includes(item.status)) item.status = 'cancelled';
                            answer = "✅ Аккаунт отвязан от Telegram. Прогресс сохранён, сессии лаунчера завершены. Для новой привязки получите код в лаунчере.";
                        } else { log(req, id, 'sessions_revoked', { category: 'auth', target: 'launcher' }); answer = "✅ Все сессии лаунчера завершены, включая входы по паролю. Для продолжения игры войдите в лаунчер заново."; }
                        saveUsers(); clear(id);
                    } else if (ctx?.challengeId && !active(c)) { clear(id); answer = "⏳ Запрос истёк или отменён. Получите новый код через вход по Telegram в лаунчере и отправьте его в этот чат."; }
                    else answer = "Эта кнопка больше не действует: запрос недоступен или уже обработан. Откройте /menu и выберите действие заново.";
                    if (!screenSent) {
                        if (!linked(id) && !state.conversations[id]) welcome(id, answer);
                        else send(id, answer);
                    }
                }
                const callbackText = answer.replace(/<\/?(?:b|code)>/g, '');
actions.unshift({ method: 'answerCallbackQuery', body: { callback_query_id: cb.id, text: callbackText.length > 180 ? 'Откройте сообщение бота.' : callbackText } });
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
